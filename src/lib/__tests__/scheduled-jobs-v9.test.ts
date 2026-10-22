// Migrazione v9 di scheduled_jobs (topologia fase 2b, Task 2): il CHECK di
// job_type accetta 'hypervisor_sync' (lettura giornaliera degli hypervisor).
//
// Copia esatta della v8 con la guardia sul nuovo valore: qui si prova che un DB
// tenant vero col CHECK della v8 e job dentro passa alla v9 aprendolo con
// getTenantDb, che i job restano identici colonna per colonna, che la v9 su un DB
// già v9 non fa niente e che il job hypervisor_sync non nasce da solo.
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
import {
  closeTenantDb,
  deleteTenantDatabase,
  getTenantDb,
  migrateScheduledJobsV8,
  migrateScheduledJobsV9,
} from "@/lib/db-tenant";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { SCHEDULED_JOB_TYPES } from "@/lib/scheduled-job-types";

const T = "TESTSCHEDJOBSV9";
const T_NUOVO = "TESTSCHEDJOBSV9NUOVO";

after(() => {
  deleteTenantDatabase(T);
  deleteTenantDatabase(T_NUOVO);
  closeHubDb();
  removeTestHubDb();
});

// Il CHECK della v8 com'è in esercizio alla v0.3.279 (cliente A e hub compresi).
const V8_TYPES = [
  "ping_sweep", "snmp_scan", "nmap_scan", "arp_poll", "dns_resolve", "fast_scan", "cleanup",
  "known_host_check", "ad_sync", "anomaly_check", "librenms_sync", "vuln_sync", "wazuh_sync",
  "wazuh_alerts_sync", "mdm_sync", "meshcentral_sync", "unifi_sync",
];
const V8_CHECK = `CHECK(job_type IN (${V8_TYPES.map((t) => `'${t}'`).join(", ")}))`;
const V8_DDL = `CREATE TABLE scheduled_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL ${V8_CHECK},
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

function dbV8(ddl = V8_DDL): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec("CREATE TABLE networks (id INTEGER PRIMARY KEY AUTOINCREMENT, cidr TEXT NOT NULL UNIQUE, name TEXT NOT NULL)");
  db.exec(ddl);
  return db;
}

function oggettiJobs(db: Database.Database): Array<{ type: string; name: string; sql: string | null }> {
  const norm = (sql: string | null) =>
    sql === null ? null : sql.replace(/"/g, "").replace(/\s+/g, " ").replace(/\(\s/g, "(").replace(/\s\)/g, ")").trim();
  return (
    db
      .prepare("SELECT type, name, sql FROM sqlite_master WHERE tbl_name = 'scheduled_jobs' ORDER BY type, name")
      .all() as Array<{ type: string; name: string; sql: string | null }>
  ).map((o) => ({ ...o, sql: norm(o.sql) }));
}

function dbNuovo(): Database.Database {
  const db = new Database(":memory:");
  db.exec(TENANT_SCHEMA_SQL);
  return db;
}

test("schema: il CHECK di scheduled_jobs è SCHEDULED_JOB_TYPES, hypervisor_sync subito dopo i tipi della v8, nessuno tolto", () => {
  const lista = checkList(schemaJobsSql());
  assert.deepEqual(lista, [...SCHEDULED_JOB_TYPES]);
  // Dopo la v9 vengono i tipi delle ricostruzioni seguenti (v10: pulizia_host, hosts/__tests__/pulizia-job.test.ts).
  assert.deepEqual(lista.slice(0, V8_TYPES.length + 1), [...V8_TYPES, "hypervisor_sync"]);
});

test("v9 su un DB col CHECK della v8: stesso elenco dello schema, tabella uguale a una nuova", () => {
  const vecchio = dbV8();
  // La v8 non tocca un DB che ha già unifi_sync: tocca alla v9.
  assert.equal(migrateScheduledJobsV8(vecchio), false);
  assert.equal(migrateScheduledJobsV9(vecchio), true);
  assert.deepEqual(checkList(tableSql(vecchio)), checkList(schemaJobsSql()));

  const nuovo = dbNuovo();
  const info = (db: Database.Database) => db.prepare("PRAGMA table_info(scheduled_jobs)").all();
  const fk = (db: Database.Database) => db.prepare("PRAGMA foreign_key_list(scheduled_jobs)").all();
  assert.deepEqual(info(vecchio), info(nuovo));
  assert.deepEqual(fk(vecchio), fk(nuovo));
  assert.equal(vecchio.pragma("foreign_keys", { simple: true }), 1);
});

test("v9 idempotente: su un DB nuovo e alla seconda passata non tocca niente", () => {
  const nuovo = dbNuovo();
  const prima = tableSql(nuovo);
  assert.equal(migrateScheduledJobsV9(nuovo), false);
  assert.equal(tableSql(nuovo), prima);

  const vecchio = dbV8();
  assert.equal(migrateScheduledJobsV9(vecchio), true);
  const dopo = tableSql(vecchio);
  assert.equal(migrateScheduledJobsV9(vecchio), false);
  assert.equal(tableSql(vecchio), dopo);
});

test("DB tenant vero col CHECK della v8 e job dentro: aperto con getTenantDb passa alla v9, job identici colonna per colonna", () => {
  deleteTenantDatabase(T);
  getTenantDb(T);
  closeTenantDb(T);

  // Riporto il file del tenant alla forma della v8, con job veri dentro.
  const file = path.join(resolveDataDir(), "tenants", `${T}.db`);
  const raw = new Database(file);
  raw.pragma("foreign_keys = OFF");
  raw.exec("DROP TABLE scheduled_jobs");
  raw.exec(V8_DDL);
  raw.exec("CREATE INDEX idx_scheduled_jobs_enabled_next ON scheduled_jobs(enabled, next_run)");
  raw.pragma("foreign_keys = ON");
  const rete = Number(raw.prepare("INSERT INTO networks (cidr, name) VALUES ('198.51.100.0/24', 'prova v9')").run().lastInsertRowid);
  const ins = raw.prepare(
    `INSERT INTO scheduled_jobs (id, network_id, job_type, interval_minutes, last_run, next_run, enabled, config, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  ins.run(3, rete, "snmp_scan", 1440, "2026-10-13 03:00:00", "2026-10-14 03:00:00", 1, "{}", "2026-01-01 00:00:00", "2026-02-02 00:00:00");
  ins.run(8, null, "unifi_sync", 60, "2026-10-14 07:00:00", "2026-10-14 08:00:00", 1, '{"controller_id":1,"cosa":"client"}', "2026-10-13 18:00:00", "2026-10-14 07:00:00");
  ins.run(9, null, "unifi_sync", 1440, null, null, 0, '{"controller_id":1}', "2026-10-13 18:00:00", "2026-10-13 18:00:00");
  ins.run(12, null, "cleanup", 1440, null, null, 1, "{}", "2026-05-05 00:00:00", "2026-05-05 00:00:00");
  // Un job cancellato dopo l'ultimo: gli id non si riusano nemmeno dopo la v9.
  ins.run(30, null, "cleanup", 1440, null, null, 1, "{}", "2026-05-05 00:00:00", "2026-05-05 00:00:00");
  raw.prepare("DELETE FROM scheduled_jobs WHERE id = 30").run();
  const prima = raw.prepare("SELECT * FROM scheduled_jobs ORDER BY id").all();
  assert.equal(prima.length, 4);
  assert.doesNotMatch(tableSql(raw), /hypervisor_sync/);
  raw.close();

  const db = getTenantDb(T);
  assert.deepEqual(db.prepare("SELECT * FROM scheduled_jobs ORDER BY id").all(), prima);
  assert.deepEqual(checkList(tableSql(db)), [...SCHEDULED_JOB_TYPES]);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'scheduled_jobs_v9'").get() as { n: number }).n,
    0,
  );
  assert.ok(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND tbl_name='scheduled_jobs' AND name='idx_scheduled_jobs_enabled_next'").get(),
    "indice idx_scheduled_jobs_enabled_next assente dopo la v9",
  );
  // Tabella e indici uguali, testo compreso, a quelli di un tenant nuovo.
  deleteTenantDatabase(T_NUOVO);
  assert.deepEqual(oggettiJobs(db), oggettiJobs(getTenantDb(T_NUOVO)));
  // Il job hypervisor_sync non si crea da solo.
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM scheduled_jobs WHERE job_type = 'hypervisor_sync'").get() as { n: number }).n,
    0,
  );
  // Ora il CHECK lo accetta; l'id continua dopo l'ultimo mai usato.
  const nuovo = db
    .prepare("INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled) VALUES (NULL, 'hypervisor_sync', 1440, 0)")
    .run();
  assert.equal(Number(nuovo.lastInsertRowid), 31);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check(scheduled_jobs)").all(), []);
  db.prepare("DELETE FROM networks WHERE id = ?").run(rete);
  assert.equal(db.prepare("SELECT 1 FROM scheduled_jobs WHERE id = 3").get(), undefined);
});

test("v9: le colonne si copiano per nome, non per posizione", () => {
  const ddl = `CREATE TABLE scheduled_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_type TEXT NOT NULL ${V8_CHECK},
    network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
    config TEXT DEFAULT '{}',
    enabled INTEGER DEFAULT 1,
    interval_minutes INTEGER NOT NULL DEFAULT 60,
    next_run TEXT,
    last_run TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  )`;
  const db = dbV8(ddl);
  db.prepare(
    `INSERT INTO scheduled_jobs (id, network_id, job_type, interval_minutes, last_run, next_run, enabled, config, created_at, updated_at)
     VALUES (9, NULL, 'unifi_sync', 120, 'L', 'N', 0, '{"controller_id":2}', 'C', 'U')`,
  ).run();
  assert.equal(migrateScheduledJobsV9(db), true);
  assert.deepEqual(db.prepare("SELECT * FROM scheduled_jobs").get(), {
    id: 9,
    network_id: null,
    job_type: "unifi_sync",
    interval_minutes: 120,
    last_run: "L",
    next_run: "N",
    enabled: 0,
    config: '{"controller_id":2}',
    created_at: "C",
    updated_at: "U",
  });
});

test("v9: se la copia non riesce la tabella resta com'era, righe comprese", () => {
  const db = dbV8();
  db.prepare("INSERT INTO scheduled_jobs (network_id, job_type) VALUES (NULL, 'cleanup')").run();
  db.pragma("ignore_check_constraints = ON");
  db.prepare("INSERT INTO scheduled_jobs (network_id, job_type) VALUES (NULL, 'job_sparito')").run();
  db.pragma("ignore_check_constraints = OFF");
  const prima = tableSql(db);

  assert.throws(() => migrateScheduledJobsV9(db), /CHECK constraint failed/);
  assert.equal(tableSql(db), prima);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM scheduled_jobs").get() as { n: number }).n, 2);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'scheduled_jobs_v9'").get() as { n: number }).n,
    0,
  );
  assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
});
