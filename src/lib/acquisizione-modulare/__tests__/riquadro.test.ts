/**
 * Stato del riquadro della scheda (GET /api/devices/[id]/acquisizione, tavola C1 oggetti 1-13): contesto del tenant,
 * nessun segreto nella risposta, prime 5 righe per sezione, modifiche dello snapshot, storico paginato.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d)" node --import tsx --test src/lib/acquisizione-modulare/__tests__/riquadro.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-acquisizione-modulare";

import { encrypt } from "@/lib/crypto";
import * as tenant from "@/lib/db-tenant";
import { snapshotSchema, type AcquisitionSnapshot, type DeviceInterface } from "@/lib/acquisition/schema";
import { salvaSnapshot } from "@/lib/acquisizione-modulare/archivio";
import { applicaSnapshot } from "@/lib/acquisizione-modulare/applica";
import { statoRiquadro } from "@/lib/acquisizione-modulare/riquadro-server";
import { sezioniPerScheda } from "@/lib/acquisizione-modulare/scheda";

const T = "TESTACQRIQUADRO";
const ALTRO = "TESTACQRIQUADRO2";
const SEGRETO = "Segreto-Riquadro-Mai-In-Risposta";
const { withTenant, getTenantDb, deleteTenantDatabase } = tenant;
const AT = "2026-10-22T08:00:00.000Z";
const sez = <D>(data: D, status: "ok" | "partial" | "error" | "skipped" = "ok", warnings: string[] = []) => ({ status, collected_at: AT, sources: ["ssh:show interfaces brief", "snmp:ifTable"], warnings, data });
const iface = (name: string): DeviceInterface => ({ name, if_index: null, description: null, kind: "physical", admin_status: "up", oper_status: "up", speed_bps: 1e9, reported_speed_bps: 1e9, duplex: "full", mtu: null, mac: null, counters: {}, pvid: 1 });

function snap(): AcquisitionSnapshot {
  return snapshotSchema.parse({
    schema_version: "1.0", collector: "hp-procurve", collector_version: "1.0.0", target: "192.0.2.70", collected_at: AT, duration_ms: 6200, status: "partial",
    identity: sez({ manufacturer: "HPE", model: "Aruba 2540", firmware: "YC.16.11.0020", serial_number: "LAB001", hostname: "sw-lab", mac: null, sys_object_id: null, uptime_seconds: null }),
    interfaces: sez(Array.from({ length: 8 }, (_, i) => iface(String(i + 1)))),
    vlans: sez([]), forwarding: sez([{ mac: "02:00:00:00:00:01", vlan_id: 40, fdb_id: null, bridge_port: null, if_index: null, port: "1", status: null }], "partial", ["ROW_OR_BYTE_LIMIT"]),
    neighbors: sez([]), spanning_tree: sez({ enabled: null, protocol: null, ports: [] }), aggregation: sez([]), poe: sez([]), sensors: sez([], "skipped", ["NUMERIC_SENSORS_NOT_IMPLEMENTED"]),
    network: sez({ ipv4_addresses: [], arp: [] }),
  });
}

let dev = 0;
describe("statoRiquadro", () => {
  before(() => {
    withTenant(T, () => {
      const d = getTenantDb(T);
      dev = Number(d.prepare("INSERT INTO network_devices (name, host, device_type, vendor, vendor_subtype, protocol, port) VALUES ('sw-lab', '192.0.2.70', 'switch', 'hp', 'procurve', 'ssh', 22)").run().lastInsertRowid);
      const c = Number(d.prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES ('lettura-switch', 'ssh', ?, ?)").run(encrypt("lab"), encrypt(SEGRETO)).lastInsertRowid);
      d.prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, sort_order, test_status) VALUES (?, ?, 'ssh', 22, 0, 'success')").run(dev, c);
      const s = snap();
      const id = salvaSnapshot(dev, s, { credenziali: { ssh: { credential_id: c, nome: "lettura-switch" } }, utente: { id: 7, nome: "r.admin" } });
      applicaSnapshot(dev, id, s);
    });
    withTenant(ALTRO, () => { getTenantDb(ALTRO); });
  });
  after(() => { deleteTenantDatabase(T); deleteTenantDatabase(ALTRO); });

  it("interruttore spento: lo dice, e propone lo stesso il collector con le credenziali per nome", () => {
    withTenant(T, () => {
      const r = statoRiquadro(dev, null, 1);
      assert.equal(r.status, 200);
      const b = r.body as { accesa: boolean; fonte: { collector: string; credenziali: Record<string, string> } };
      assert.equal(b.accesa, false);
      assert.equal(b.fonte.collector, "hp-procurve");
      assert.deepEqual(b.fonte.credenziali, { ssh: "lettura-switch" });
    });
  });

  it("nessun segreto nella risposta", () => {
    withTenant(T, () => {
      assert.ok(!JSON.stringify(statoRiquadro(dev, null, 1).body).includes(SEGRETO));
    });
  });

  it("snapshot in vista: sezioni con avvisi in parole e codice, prime 5 righe, modifiche fatte", () => {
    withTenant(T, () => {
      const b = statoRiquadro(dev, null, 1).body as { snapshot: { status: string; requested_by_name: string; sezioni: Array<{ chiave: string; righe: number; prime: unknown[]; avvisi: Array<{ codice: string; testo: string | null }>; fonti: string[] }>; modifiche: { totale: number } } };
      assert.equal(b.snapshot.status, "partial");
      assert.equal(b.snapshot.requested_by_name, "r.admin");
      const interfacce = b.snapshot.sezioni.find((s) => s.chiave === "interfaces")!;
      assert.equal(interfacce.righe, 8);
      assert.equal(interfacce.prime.length, 5, "prime 5 righe");
      assert.deepEqual(interfacce.fonti, ["ssh", "snmp"]);
      const mac = b.snapshot.sezioni.find((s) => s.chiave === "forwarding")!;
      assert.deepEqual(mac.avvisi, [{ codice: "ROW_OR_BYTE_LIMIT", testo: "Letta solo in parte: raggiunto il limite di righe." }]);
      assert.ok(b.snapshot.modifiche.totale > 0, "cosa è cambiato nell'apparato");
    });
  });

  it("un apparato di un altro tenant non si vede", () => {
    withTenant(ALTRO, () => {
      assert.equal(statoRiquadro(dev, null, 1).status, 404);
    });
  });

  it("uno snapshot di un altro apparato non si apre per id", () => {
    withTenant(T, () => {
      const altro = Number(getTenantDb(T).prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol) VALUES ('sw-2', '192.0.2.71', 'switch', 'hp', 'ssh')").run().lastInsertRowid);
      const sid = (getTenantDb(T).prepare("SELECT id FROM acquisition_snapshots WHERE device_id = ?").get(dev) as { id: number }).id;
      assert.equal(statoRiquadro(altro, sid, 1).status, 404);
    });
  });

  it("sezioniPerScheda: sezioni opzionali assenti non compaiono", () => {
    const nomi = sezioniPerScheda(snap()).map((s) => s.chiave);
    assert.ok(!nomi.includes("storage") && !nomi.includes("hardware"));
  });
});
