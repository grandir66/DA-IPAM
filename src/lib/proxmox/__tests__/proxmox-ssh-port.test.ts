// La porta SSH di un hypervisor Proxmox (lettura via SSH, schede vive, prova di connessione). `network_devices.port` è
// la porta dell'API (443/8006): usata per l'SSH, la connessione veniva rifiutata e le schede vive non si leggevano mai.
// Dalla tappa 2 credenziali (T8) la regola sta nel motore (`portaSshApparatoDb`): la porta del primo candidato SSH
// dell'apparato. Un binding fallito non è più un candidato (D10 = (a)): prima la sua porta valeva se veniva prima.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { portaSshApparatoDb } from "@/lib/credentials/resolve";
import type { NetworkDevice } from "@/types";

type B = [protocollo: string, porta: number, esito?: string];

/** Un Proxmox (API sulla 8006) coi suoi binding, in ordine; restituisce la porta SSH scelta. */
function porta(binding: B[]): number {
  const d = new Database(":memory:");
  d.exec(TENANT_SCHEMA_SQL);
  const id = Number(
    d.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol, port) VALUES ('pve', '10.0.0.1', 'hypervisor', 'proxmox', 'api', 8006)")
      .run().lastInsertRowid,
  );
  const ins = d.prepare("INSERT INTO device_credential_bindings (device_id, protocol_type, port, sort_order, test_status) VALUES (?, ?, ?, ?, ?)");
  binding.forEach(([p, port, esito], i) => ins.run(id, p, port, i, esito ?? "untested"));
  const device = d.prepare("SELECT * FROM network_devices WHERE id = ?").get(id) as NetworkDevice;
  const r = portaSshApparatoDb(d, device);
  d.close();
  return r;
}

test("senza credenziali SSH legate: 22, mai la porta dell'API", () => {
  assert.equal(porta([]), 22);
  assert.equal(porta([["api", 8006, "success"], ["api", 443]]), 22);
});

test("la porta della credenziale SSH legata all'apparato; quella provata con successo prima delle altre", () => {
  assert.equal(porta([["api", 8006], ["ssh", 2222]]), 2222);
  assert.equal(porta([["ssh", 2201, "failed"], ["ssh", 2202, "success"]]), 2202);
  assert.equal(porta([["ssh", 2201], ["ssh", 2202]]), 2201, "a pari esito, l'ordine delle credenziali");
  assert.equal(porta([["ssh", 2201, "failed"]]), 22, "un binding fallito non è un candidato");
});

test("una porta non valida nella riga non si usa: 22", () => {
  for (const p of [0, -1, 70000, 22.5]) assert.equal(porta([["ssh", p]]), 22, String(p));
});
