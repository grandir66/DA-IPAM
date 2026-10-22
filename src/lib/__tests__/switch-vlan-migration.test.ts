// Migrazione «VLAN degli switch» (piano 2026-10-22 accorpamento, Task 8, ADR 0029): quattro tabelle nuove
// (switch_vlan, switch_vlan_porte, switch_porta_pvid, switch_vlan_lettura). Additiva, idempotente, in UNA transazione;
// il segno `switch_vlan_v21` dice che lo schema c'è (`done:<data>:v1`), scritto una volta sola.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { closeHubDb } from "@/lib/db-hub";
import { chiudiMigrazioneSwitchVlanFallita, deleteTenantDatabase, getTenantDb, migrateSchedaMikrotik, migrateSwitchVlan, schemaSwitchVlanPresente } from "@/lib/db-tenant";
import { DDL_SWITCH_VLAN_V1, SEGNO_SWITCH_VLAN, TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { leggiSegno } from "@/lib/credentials/segni-t2";

const T = "TESTSWITCHVLANMIG";
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

const NOMI = DDL_SWITCH_VLAN_V1.map(([n]) => n).sort();
const tabella = (db: Database.Database, n: string): boolean => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(n);
const schema = (db: Database.Database): string[] =>
  (db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all() as Array<{ type: string; name: string; sql: string | null }>)
    .map((r) => `${r.type} ${r.name} ${r.sql ?? ""}`);

/** Un tenant com'era prima: lo schema attuale (con le tabelle della scheda MikroTik) senza le quattro tabelle. */
function vecchio(): Database.Database {
  const db = new Database(":memory:");
  db.exec(TENANT_SCHEMA_SQL);
  migrateSchedaMikrotik(db);
  for (const n of NOMI) assert.equal(tabella(db, n), false, `${n} non deve esserci prima`);
  return db;
}

test("DB vuoto: quattro tabelle e segno; la seconda volta niente, segno identico; nient'altro cambia", () => {
  const db = vecchio();
  const prima = schema(db);
  assert.deepEqual([...migrateSwitchVlan(db)].sort(), NOMI);
  assert.equal(schemaSwitchVlanPresente(db), true);
  const segno = db.prepare("SELECT value, updated_at FROM tenant_settings WHERE key = ?").get(SEGNO_SWITCH_VLAN) as { value: string };
  assert.match(segno.value, /^done:\d{4}-\d{2}-\d{2}:v1$/);
  assert.deepEqual(migrateSwitchVlan(db), [], "seconda chiamata: niente");
  assert.deepEqual(db.prepare("SELECT value, updated_at FROM tenant_settings WHERE key = ?").get(SEGNO_SWITCH_VLAN), segno, "il segno non si riscrive");
  // Lo schema di prima resta com'era: in più solo le quattro tabelle (e i loro indici automatici della chiave primaria).
  const dopo = schema(db).filter((r) => !NOMI.some((n) => r.includes(` ${n} `) || r.includes(`sqlite_autoindex_${n}_`)));
  assert.deepEqual(dopo, prima);
  assert.deepEqual(db.pragma("integrity_check"), [{ integrity_check: "ok" }]);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
});

test("una tabella c'è già: si aggiungono solo le altre tre", () => {
  const db = vecchio();
  db.exec(DDL_SWITCH_VLAN_V1[0][1]);
  db.prepare("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, enabled) VALUES (1, 'SW-1', '192.0.2.1', 'switch', 'other', 'snmp_v2', 1)").run();
  db.prepare("INSERT INTO switch_vlan (device_id, vlan_id, nome) VALUES (1, 10, 'rete-a')").run();
  assert.deepEqual([...migrateSwitchVlan(db)].sort(), NOMI.filter((n) => n !== DDL_SWITCH_VLAN_V1[0][0]));
  assert.deepEqual(db.prepare("SELECT device_id, vlan_id, nome FROM switch_vlan").all(), [{ device_id: 1, vlan_id: 10, nome: "rete-a" }], "le righe di prima restano");
});

test("in transazione: se una tabella non si crea, niente a metà, niente segno; poi il segno dice errore", () => {
  const db = vecchio();
  // Una vista col nome della terza tabella: la sua CREATE TABLE fallisce dopo le prime due.
  db.exec("CREATE VIEW switch_porta_pvid AS SELECT 1 AS x");
  assert.throws(() => migrateSwitchVlan(db));
  assert.equal(tabella(db, "switch_vlan"), false);
  assert.equal(tabella(db, "switch_vlan_porte"), false);
  assert.equal(leggiSegno(db, SEGNO_SWITCH_VLAN), null);
  chiudiMigrazioneSwitchVlanFallita(db, "X", new Error("table switch_porta_pvid already exists"));
  assert.match(String(leggiSegno(db, SEGNO_SWITCH_VLAN)), /^errore:/);
  assert.equal(schemaSwitchVlanPresente(db), false);
});

test("migrazione fallita ma schema completo (un altro processo ha vinto la corsa): il segno resta done, non errore", () => {
  const db = vecchio();
  migrateSwitchVlan(db);
  db.prepare("DELETE FROM tenant_settings WHERE key = ?").run(SEGNO_SWITCH_VLAN);
  chiudiMigrazioneSwitchVlanFallita(db, "X", new Error("table switch_vlan already exists"));
  assert.match(String(leggiSegno(db, SEGNO_SWITCH_VLAN)), /^done:.*:v1$/);
  assert.equal(schemaSwitchVlanPresente(db), true);
});

test("all'apertura del tenant: quattro tabelle, segno done:…:v1, riaprendo niente cambia", () => {
  const d = getTenantDb(T);
  for (const n of NOMI) assert.ok(tabella(d, n), n);
  assert.match(String(leggiSegno(d, SEGNO_SWITCH_VLAN)), /^done:\d{4}-\d{2}-\d{2}:v1$/);
  assert.equal(schemaSwitchVlanPresente(d), true);
  assert.deepEqual(migrateSwitchVlan(d), []);
});
