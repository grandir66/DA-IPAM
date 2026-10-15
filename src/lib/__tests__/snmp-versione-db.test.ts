/**
 * Versione SNMP per apparato nel DB tenant (2026-10-15): colonne nuove,
 * idempotenti, NULL di default; la discovery scrive solo se cambia e mai sopra
 * una versione fissata a mano. Incidente: DTS 15/10, AP che rispondono solo in v1.
 */
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, migrateSnmpVersione, registraVersioneSnmpRilevata, withTenant } from "@/lib/db-tenant";

const T = "TESTSNMPVERS";
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

test("migrazione: aggiunge le due colonne una volta sola, righe esistenti a NULL / 0", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE network_devices (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, host TEXT NOT NULL, device_type TEXT NOT NULL, vendor TEXT NOT NULL, protocol TEXT NOT NULL)");
  db.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol) VALUES ('AP-1', '192.0.2.4', 'access_point', 'ubiquiti', 'snmp_v2')").run();
  assert.deepEqual(migrateSnmpVersione(db), ["network_devices.snmp_version", "network_devices.snmp_version_fissata"]);
  assert.deepEqual(migrateSnmpVersione(db), [], "la seconda volta non fa niente");
  assert.deepEqual(db.prepare("SELECT snmp_version, snmp_version_fissata FROM network_devices").get(), { snmp_version: null, snmp_version_fissata: 0 });
  assert.throws(() => db.prepare("UPDATE network_devices SET snmp_version = '3'").run(), /CHECK/);
});

test("registraVersioneSnmpRilevata: scrive se cambia, tace se uguale, non tocca la versione fissata", () => {
  getTenantDb(T);
  withTenant(T, () => {
    const db = getTenantDb(T);
    const id = Number(db.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol) VALUES ('AP-1', '192.0.2.4', 'access_point', 'ubiquiti', 'snmp_v2')").run().lastInsertRowid);
    const leggi = () => db.prepare("SELECT snmp_version, snmp_version_fissata FROM network_devices WHERE id = ?").get(id);

    assert.deepEqual(leggi(), { snmp_version: null, snmp_version_fissata: 0 }, "nasce non rilevata");
    assert.deepEqual(registraVersioneSnmpRilevata(id, "1"), { prima: null });
    assert.deepEqual(leggi(), { snmp_version: "1", snmp_version_fissata: 0 });
    assert.equal(registraVersioneSnmpRilevata(id, "1"), undefined, "uguale: non riscrive");
    assert.deepEqual(registraVersioneSnmpRilevata(id, "2c"), { prima: "1" });

    db.prepare("UPDATE network_devices SET snmp_version = '1', snmp_version_fissata = 1 WHERE id = ?").run(id);
    assert.equal(registraVersioneSnmpRilevata(id, "2c"), undefined, "fissata a mano: la discovery non la cambia");
    assert.deepEqual(leggi(), { snmp_version: "1", snmp_version_fissata: 1 });
    assert.equal(registraVersioneSnmpRilevata(99999, "1"), undefined, "apparato che non c'è");
  });
});
