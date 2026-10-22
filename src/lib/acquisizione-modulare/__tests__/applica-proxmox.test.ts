/**
 * Applicazione di uno snapshot `proxmox-ve`: nodi e VM nello stesso `last_proxmox_scan_result` della scansione di oggi,
 * una riga «inventario» nelle modifiche, ripetizione senza effetti; gli snapshot di altri collector non toccano la colonna.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d)" node --import tsx --test src/lib/acquisizione-modulare/__tests__/applica-proxmox.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as tenant from "@/lib/db-tenant";
import { applicaSnapshot } from "@/lib/acquisizione-modulare/applica";
import { salvaSnapshot } from "@/lib/acquisizione-modulare/archivio";
import { FIXTURE } from "@/lib/acquisition/__tests__/contratto-fixture";

const T = "TESTACQAPPLICAPVE";
const { withTenant, getTenantDb, deleteTenantDatabase } = tenant;
let dev = 0, altro = 0;
const d = () => getTenantDb(T);
const risultato = (id: number) => (d().prepare("SELECT last_proxmox_scan_result AS r FROM network_devices WHERE id = ?").get(id) as { r: string | null }).r;

describe("applicaSnapshot – Proxmox", () => {
  before(() => {
    withTenant(T, () => {
      dev = Number(d().prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol, port) VALUES ('pve-lab', '192.0.2.90', 'hypervisor', 'proxmox', 'ssh', 22)").run().lastInsertRowid);
      altro = Number(d().prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol, port) VALUES ('nas-lab', '192.0.2.40', 'nas', 'qnap', 'ssh', 22)").run().lastInsertRowid);
    });
  });
  after(() => deleteTenantDatabase(T));

  it("scrive nodi e VM, una riga d'inventario, e ripetere non cambia niente", async () => {
    const { snapshot } = await FIXTURE["proxmox-ve"].normale();
    await withTenant(T, async () => {
      assert.equal(risultato(dev), null);
      const id = salvaSnapshot(dev, snapshot, { credenziali: {}, utente: null });
      applicaSnapshot(dev, id, snapshot);
      const r = JSON.parse(risultato(dev)!) as { hosts: unknown[]; vms: Array<{ vmid: number }> };
      assert.equal(r.hosts.length, 1);
      assert.deepEqual(r.vms.map(v => v.vmid), [100, 101, 200]);
      const righe = d().prepare("SELECT campo, dopo FROM acquisition_changes WHERE device_id = ? AND destinazione = 'inventario'").all(dev);
      assert.deepEqual(righe, [{ campo: "nodi e VM", dopo: "1 nodi, 3 VM" }]);
      const prima = risultato(dev);
      const id2 = salvaSnapshot(dev, snapshot, { credenziali: {}, utente: null });
      applicaSnapshot(dev, id2, snapshot);
      assert.equal(risultato(dev), prima, "stesso snapshot: stessa colonna");
      assert.equal(d().prepare("SELECT COUNT(*) AS n FROM acquisition_changes WHERE device_id = ? AND destinazione = 'inventario'").get(dev) && (d().prepare("SELECT COUNT(*) AS n FROM acquisition_changes WHERE device_id = ? AND destinazione = 'inventario'").get(dev) as { n: number }).n, 1);
    });
  });

  it("uno snapshot di un altro collector non tocca la colonna Proxmox", async () => {
    const { snapshot } = await FIXTURE["qnap-nas"].normale();
    await withTenant(T, async () => {
      applicaSnapshot(altro, salvaSnapshot(altro, snapshot, { credenziali: {}, utente: null }), snapshot);
      assert.equal(risultato(altro), null);
    });
  });
});
