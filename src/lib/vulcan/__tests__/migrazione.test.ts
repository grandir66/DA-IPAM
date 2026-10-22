/**
 * A-IPAM, Task 2: la migrazione della coda verso DA-Vul-can (`vulcan_coda_v21`).
 *
 * Additiva, idempotente, in UNA transazione; CREATE solo nella migrazione (lo schema
 * di TENANT_SCHEMA_SQL non la conosce); segno `done:<data>:v1` scritto una volta
 * sola; se fallisce il tenant si apre lo stesso, segno `errore:…` e
 * `schemaVulcanPresente` = false (chi accoda lo sa invece di scrivere a vuoto).
 *
 * Cartella dati isolata: `support/data-dir-isolata` va importato PER PRIMO.
 */
import "@/lib/__tests__/support/data-dir-isolata";
import path from "node:path";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { resolveDataDir } from "@/lib/data-dir";
import { closeHubDb } from "@/lib/db-hub";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, migrateVulcanCoda, schemaVulcanPresente } from "@/lib/db-tenant";
import { SEGNO_VULCAN, TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { leggiSegno, scriviSegno } from "@/lib/credentials/segni-t2";

const T = "VULCANMIG";
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
});

const OGGETTI = ["vulcan_coda", "vulcan_stato", "idx_vulcan_coda_attesa"];

function nomi(db: Database.Database): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%vulcan%' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
}

function dbSchema(): Database.Database {
  const db = new Database(":memory:");
  db.exec(TENANT_SCHEMA_SQL);
  return db;
}

test("lo schema base non crea la coda: nasce solo nella migrazione", () => {
  assert.deepEqual(nomi(dbSchema()), []);
});

test("DB senza coda: crea tabelle e indice in una volta, segno done:<data>:v1", () => {
  const db = dbSchema();
  assert.deepEqual(migrateVulcanCoda(db), OGGETTI);
  assert.deepEqual(nomi(db), [...OGGETTI].sort());
  assert.match(leggiSegno(db, SEGNO_VULCAN) ?? "", /^done:\d{4}-\d{2}-\d{2}:v1$/);
  assert.equal(schemaVulcanPresente(db), true);
});

test("seconda esecuzione: niente cambia, segno invariato", () => {
  const db = dbSchema();
  migrateVulcanCoda(db);
  scriviSegno(db, SEGNO_VULCAN, "done:2026-10-01:v1");
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name LIKE '%vulcan%' ORDER BY name").all();
  assert.deepEqual(migrateVulcanCoda(db), []);
  assert.equal(leggiSegno(db, SEGNO_VULCAN), "done:2026-10-01:v1");
  assert.deepEqual(db.prepare("SELECT sql FROM sqlite_master WHERE name LIKE '%vulcan%' ORDER BY name").all(), sql);
});

test("un oggetto omonimo che non è una tabella fa fallire tutto (ROLLBACK), mai a metà", () => {
  const db = dbSchema();
  db.exec("CREATE VIEW vulcan_stato AS SELECT 1 AS id");
  assert.throws(() => migrateVulcanCoda(db), /vulcan_stato/);
  assert.deepEqual(nomi(db), ["vulcan_stato"]); // la coda non è nata da sola
  assert.equal(leggiSegno(db, SEGNO_VULCAN), null);
  assert.equal(schemaVulcanPresente(db), false);
});

test("tenant nuovo aperto con getTenantDb: coda, indice e segno; riga nel journal", () => {
  deleteTenantDatabase(T);
  const righe: string[] = [];
  const info = console.info;
  console.info = (...a: unknown[]) => righe.push(a.map(String).join(" "));
  let db: Database.Database;
  try {
    db = getTenantDb(T);
  } finally {
    console.info = info;
  }
  assert.deepEqual(nomi(db), [...OGGETTI].sort());
  assert.match(leggiSegno(db, SEGNO_VULCAN) ?? "", /^done:\d{4}-\d{2}-\d{2}:v1$/);
  assert.equal(schemaVulcanPresente(db), true);
  assert.ok(righe.some((r) => r.includes(`[db-tenant] ${T}: coda vulcan, aggiunto vulcan_coda, vulcan_stato, idx_vulcan_coda_attesa`)), righe.join("\n"));
  closeTenantDb(T);
});

test("tenant riaperto: nessuna riga nel journal, segno invariato", () => {
  const db0 = getTenantDb(T);
  scriviSegno(db0, SEGNO_VULCAN, "done:2026-10-01:v1");
  closeTenantDb(T);
  const righe: string[] = [];
  const info = console.info;
  console.info = (...a: unknown[]) => righe.push(a.map(String).join(" "));
  let db: Database.Database;
  try {
    db = getTenantDb(T);
  } finally {
    console.info = info;
  }
  assert.equal(leggiSegno(db, SEGNO_VULCAN), "done:2026-10-01:v1");
  assert.ok(!righe.some((r) => r.includes("coda vulcan")));
  closeTenantDb(T);
});

test("tenant con un oggetto che blocca la migrazione: si apre lo stesso, segno errore:, schema assente", () => {
  deleteTenantDatabase(T);
  getTenantDb(T);
  closeTenantDb(T);
  const raw = new Database(path.join(resolveDataDir(), "tenants", `${T}.db`));
  raw.exec("DROP TABLE vulcan_coda");
  raw.exec("DROP TABLE vulcan_stato");
  raw.exec(`DELETE FROM tenant_settings WHERE key = '${SEGNO_VULCAN}'`);
  raw.exec("CREATE VIEW vulcan_stato AS SELECT 1 AS id");
  raw.close();

  const err = console.error;
  const errori: string[] = [];
  console.error = (...a: unknown[]) => errori.push(a.map(String).join(" "));
  let db: Database.Database;
  try {
    db = getTenantDb(T);
  } finally {
    console.error = err;
  }
  assert.match(leggiSegno(db, SEGNO_VULCAN) ?? "", /^errore:.*vulcan_stato/);
  assert.equal(schemaVulcanPresente(db), false);
  assert.ok(!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'vulcan_coda'").get());
  assert.ok(errori.some((r) => r.includes("coda vulcan fallita")), errori.join("\n"));
  assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
  closeTenantDb(T);
});
