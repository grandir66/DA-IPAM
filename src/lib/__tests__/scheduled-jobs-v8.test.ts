// Migrazione v8 di scheduled_jobs (tappa 2 UniFi, Task 6): il CHECK di job_type
// accetta 'unifi_sync'.
//
// Lo schema (db-tenant-schema.ts) e la migrazione (db-tenant.ts) derivano dalla
// stessa costante, SCHEDULED_JOB_TYPES: qui si prova che dicono la stessa cosa e
// che un DB tenant vero col CHECK della v7 e righe dentro passa alla v8 aprendolo
// con getTenantDb, senza perdere niente. Il job unifi_sync non si crea da solo.
//
// Hub isolato importato per primo (il perché sta in support/hub-isolato); i
// tenant stanno in DA_INVENT_DATA_DIR: lanciare con una cartella di prova.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import path from "node:path";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { closeHubDb } from "@/lib/db-hub";
import { resolveDataDir } from "@/lib/data-dir";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, migrateScheduledJobsV8 } from "@/lib/db-tenant";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { SCHEDULED_JOB_TYPES, type ScheduledJobType } from "@/lib/scheduled-job-types";
import type { ScheduledJob, ScheduledJobInput } from "@/types";

const T = "TESTSCHEDJOBSV8";

after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

// Il tipo TypeScript deriva dalla stessa costante: se divergono, tsc si ferma qui.
type Uguali<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const tipoJob: Uguali<ScheduledJob["job_type"], ScheduledJobType> = true;
const tipoInput: Uguali<ScheduledJobInput["job_type"], ScheduledJobType> = true;

// Il CHECK della v7 com'è scritto in db-tenant.ts: la forma dei DB tenant in
// esercizio prima di questa tappa (DTS compreso).
const V7_TYPES = [
  "ping_sweep", "snmp_scan", "nmap_scan", "arp_poll", "dns_resolve", "fast_scan", "cleanup",
  "known_host_check", "ad_sync", "anomaly_check", "librenms_sync", "vuln_sync", "wazuh_sync",
  "wazuh_alerts_sync", "mdm_sync", "meshcentral_sync",
];
const V7_CHECK = `CHECK(job_type IN (${V7_TYPES.map((t) => `'${t}'`).join(", ")}))`;
const V7_DDL = `CREATE TABLE scheduled_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL ${V7_CHECK},
  interval_minutes INTEGER NOT NULL DEFAULT 60,
  last_run TEXT,
  next_run TEXT,
  enabled INTEGER DEFAULT 1,
  config TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
)`;

function checkList(sql: string): string[] {
  const m = /CHECK\s*\(\s*job_type\s+IN\s*\(([^)]*)\)\s*\)/i.exec(sql);
  assert.ok(m, `CHECK di job_type non trovato in: ${sql}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

function tableSql(db: Database.Database, name = "scheduled_jobs"): string {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?").get(name) as
    | { sql: string }
    | undefined;
  assert.ok(row, `tabella ${name} assente`);
  return row.sql;
}

function schemaJobsSql(): string {
  const m = /CREATE TABLE IF NOT EXISTS scheduled_jobs \(([\s\S]*?)\n\);/.exec(TENANT_SCHEMA_SQL);
  assert.ok(m, "scheduled_jobs non trovata in TENANT_SCHEMA_SQL");
  return m[0];
}

/** DB in memoria con la sola tabella networks (per la FK) e scheduled_jobs della v7. */
function dbV7(ddl = V7_DDL): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec("CREATE TABLE networks (id INTEGER PRIMARY KEY AUTOINCREMENT, cidr TEXT NOT NULL UNIQUE, name TEXT NOT NULL)");
  db.exec(ddl);
  return db;
}

function dbNuovo(): Database.Database {
  const db = new Database(":memory:");
  db.exec(TENANT_SCHEMA_SQL);
  return db;
}

test("schema: il CHECK di scheduled_jobs è esattamente SCHEDULED_JOB_TYPES, unifi_sync compreso", () => {
  assert.equal(tipoJob && tipoInput, true);
  const lista = checkList(schemaJobsSql());
  assert.deepEqual(lista, [...SCHEDULED_JOB_TYPES]);
  assert.ok(lista.includes("unifi_sync"));
  // La v8 aggiunge e non toglie: ogni tipo della v7 resta accettato, altrimenti
  // la copia delle righe esistenti fallirebbe.
  assert.deepEqual(
    [...SCHEDULED_JOB_TYPES].filter((t) => t !== "unifi_sync").sort(),
    [...V7_TYPES].sort(),
  );
});

test("v8 su un DB col CHECK della v7: stesso elenco dello schema, tabella uguale a una nuova", () => {
  const vecchio = dbV7();
  assert.equal(migrateScheduledJobsV8(vecchio), true);
  assert.deepEqual(checkList(tableSql(vecchio)), checkList(schemaJobsSql()));

  const nuovo = dbNuovo();
  const info = (db: Database.Database) => db.prepare("PRAGMA table_info(scheduled_jobs)").all();
  const fk = (db: Database.Database) => db.prepare("PRAGMA foreign_key_list(scheduled_jobs)").all();
  assert.deepEqual(info(vecchio), info(nuovo));
  assert.deepEqual(fk(vecchio), fk(nuovo));
  assert.equal(vecchio.pragma("foreign_keys", { simple: true }), 1);
});

test("v8 idempotente: su un DB nuovo e alla seconda passata non tocca niente", () => {
  const nuovo = dbNuovo();
  const prima = tableSql(nuovo);
  assert.equal(migrateScheduledJobsV8(nuovo), false);
  assert.equal(tableSql(nuovo), prima);

  const vecchio = dbV7();
  assert.equal(migrateScheduledJobsV8(vecchio), true);
  assert.equal(migrateScheduledJobsV8(vecchio), false);
});

test("DB tenant vero col CHECK della v7 e righe dentro: aperto con getTenantDb passa alla v8 senza perdere niente", () => {
  deleteTenantDatabase(T);
  getTenantDb(T);
  closeTenantDb(T);

  // Riporto il file del tenant alla forma della v7, con righe vere dentro.
  const file = path.join(resolveDataDir(), "tenants", `${T}.db`);
  const raw = new Database(file);
  raw.pragma("foreign_keys = OFF");
  raw.exec("DROP TABLE scheduled_jobs");
  raw.exec(V7_DDL);
  raw.exec("CREATE INDEX idx_scheduled_jobs_enabled_next ON scheduled_jobs(enabled, next_run)");
  raw.pragma("foreign_keys = ON");
  const rete = Number(raw.prepare("INSERT INTO networks (cidr, name) VALUES ('10.98.0.0/24', 'prova v8')").run().lastInsertRowid);
  const ins = raw.prepare(
    `INSERT INTO scheduled_jobs (id, network_id, job_type, interval_minutes, last_run, next_run, enabled, config, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  ins.run(3, rete, "known_host_check", 15, "2026-10-12 08:00:00", "2026-10-12 08:15:00", 1, '{"soglia":2}', "2026-01-01 00:00:00", "2026-02-02 00:00:00");
  ins.run(7, null, "wazuh_alerts_sync", 30, null, null, 0, "{}", "2026-03-03 00:00:00", "2026-03-04 00:00:00");
  ins.run(42, null, "meshcentral_sync", 60, "2026-10-11 23:00:00", null, 1, "{}", "2026-04-04 00:00:00", "2026-04-05 00:00:00");
  // Un job cancellato dopo l'ultimo: gli id non si riusano nemmeno dopo la v8.
  ins.run(50, null, "cleanup", 1440, null, null, 1, "{}", "2026-05-05 00:00:00", "2026-05-05 00:00:00");
  raw.prepare("DELETE FROM scheduled_jobs WHERE id = 50").run();
  const prima = raw.prepare("SELECT * FROM scheduled_jobs ORDER BY id").all();
  assert.equal(prima.length, 3);
  assert.doesNotMatch(tableSql(raw), /unifi_sync/);
  raw.close();

  const db = getTenantDb(T);
  assert.deepEqual(db.prepare("SELECT * FROM scheduled_jobs ORDER BY id").all(), prima);
  assert.deepEqual(checkList(tableSql(db)), [...SCHEDULED_JOB_TYPES]);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'scheduled_jobs_v8'").get() as { n: number }).n,
    0,
  );
  // Indice ricreato subito, non al riavvio successivo.
  assert.ok(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND tbl_name='scheduled_jobs' AND name='idx_scheduled_jobs_enabled_next'").get(),
    "indice idx_scheduled_jobs_enabled_next assente dopo la v8",
  );
  // Il job unifi_sync non si crea da solo.
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM scheduled_jobs WHERE job_type = 'unifi_sync'").get() as { n: number }).n,
    0,
  );
  // Ora il CHECK lo accetta; l'id continua dopo l'ultimo mai usato.
  const nuovo = db
    .prepare("INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled) VALUES (NULL, 'unifi_sync', 60, 0)")
    .run();
  assert.equal(Number(nuovo.lastInsertRowid), 51);
  // La FK verso networks è ancora viva: cancellare la rete cancella il suo job.
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check(scheduled_jobs)").all(), []);
  db.prepare("DELETE FROM networks WHERE id = ?").run(rete);
  assert.equal(db.prepare("SELECT 1 FROM scheduled_jobs WHERE id = 3").get(), undefined);
});

test("v8: le colonne si copiano per nome, non per posizione", () => {
  // Stesse colonne della v7, in un altro ordine.
  const ddl = `CREATE TABLE scheduled_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_type TEXT NOT NULL ${V7_CHECK},
    network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
    config TEXT DEFAULT '{}',
    enabled INTEGER DEFAULT 1,
    interval_minutes INTEGER NOT NULL DEFAULT 60,
    next_run TEXT,
    last_run TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  )`;
  const db = dbV7(ddl);
  db.prepare(
    `INSERT INTO scheduled_jobs (id, network_id, job_type, interval_minutes, last_run, next_run, enabled, config, created_at, updated_at)
     VALUES (9, NULL, 'ad_sync', 120, 'L', 'N', 0, '{"x":1}', 'C', 'U')`,
  ).run();
  assert.equal(migrateScheduledJobsV8(db), true);
  assert.deepEqual(db.prepare("SELECT * FROM scheduled_jobs").get(), {
    id: 9,
    network_id: null,
    job_type: "ad_sync",
    interval_minutes: 120,
    last_run: "L",
    next_run: "N",
    enabled: 0,
    config: '{"x":1}',
    created_at: "C",
    updated_at: "U",
  });
});

test("v8: se la copia non riesce la tabella resta com'era, righe comprese", () => {
  const db = dbV7();
  db.prepare("INSERT INTO scheduled_jobs (network_id, job_type) VALUES (NULL, 'cleanup')").run();
  // Una riga che il CHECK nuovo non accetta (scritta saltando il CHECK).
  db.pragma("ignore_check_constraints = ON");
  db.prepare("INSERT INTO scheduled_jobs (network_id, job_type) VALUES (NULL, 'job_sparito')").run();
  db.pragma("ignore_check_constraints = OFF");
  const prima = tableSql(db);

  assert.throws(() => migrateScheduledJobsV8(db), /CHECK constraint failed/);
  assert.equal(tableSql(db), prima);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM scheduled_jobs").get() as { n: number }).n, 2);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'scheduled_jobs_v8'").get() as { n: number }).n,
    0,
  );
  assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
});
