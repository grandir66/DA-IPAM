/**
 * Migrazione v11 di `scheduled_jobs` e tabella degli esiti (piano 2026-10-22 scansione automatica, Task 1).
 * Zona rossa: la v11 ricostruisce la tabella dei job nei DB dei clienti.
 *
 * Si prova: il CHECK della v10 rifiuta `apparati_scelti`, dopo la v11 lo accetta; le righe restano identiche colonna
 * per colonna, il contatore AUTOINCREMENT non scende, l'indice c'è; la seconda passata non fa niente; se la copia non
 * riesce la tabella resta com'era; un tenant vero col CHECK della v10 passa alla v11 aprendolo; un tenant nuovo ha già
 * CHECK, tabella `job_apparati_esiti`, il suo indice e il segno `apparati_scelti_v21`; nessun job nasce da solo.
 *
 * Run: node --import tsx --test src/lib/__tests__/scheduled-jobs-v11.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import path from "node:path";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { resolveDataDir } from "@/lib/data-dir";
import { closeHubDb } from "@/lib/db-hub";
import {
  closeTenantDb,
  deleteTenantDatabase,
  getTenantDb,
  migraApparatiScelti,
  migrateScheduledJobsV10,
  migrateScheduledJobsV11,
} from "@/lib/db-tenant";
import { SEGNO_APPARATI_SCELTI, TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { leggiSegno } from "@/lib/credentials/segni-t2";
import { SCHEDULED_JOB_TYPES } from "@/lib/scheduled-job-types";

const T = "TESTSCHEDJOBSV11";
const T_NUOVO = "TESTSCHEDJOBSV11NUOVO";

after(() => {
  for (const t of [T, T_NUOVO]) {
    try { closeTenantDb(t); deleteTenantDatabase(t); } catch { /* già tolto */ }
  }
  closeHubDb();
});

// Il CHECK della v10 com'è in esercizio alla v0.9.860 (hub e cliente A).
const V10_TYPES = [
  "ping_sweep", "snmp_scan", "nmap_scan", "arp_poll", "dns_resolve", "fast_scan", "cleanup",
  "known_host_check", "ad_sync", "anomaly_check", "librenms_sync", "vuln_sync", "wazuh_sync",
  "wazuh_alerts_sync", "mdm_sync", "meshcentral_sync", "unifi_sync", "hypervisor_sync", "pulizia_host",
];
const V10_DDL = `CREATE TABLE scheduled_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK(job_type IN (${V10_TYPES.map((t) => `'${t}'`).join(", ")})),
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

function seq(db: Database.Database): number | undefined {
  return (db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'scheduled_jobs'").get() as { seq: number } | undefined)?.seq;
}

function dbV10(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec("CREATE TABLE networks (id INTEGER PRIMARY KEY AUTOINCREMENT, cidr TEXT NOT NULL UNIQUE, name TEXT NOT NULL)");
  db.exec(V10_DDL);
  db.exec("CREATE INDEX idx_scheduled_jobs_enabled_next ON scheduled_jobs(enabled, next_run)");
  return db;
}

test("tipi: apparati_scelti in coda, dopo i tipi della v10 che restano tutti", () => {
  assert.deepEqual([...SCHEDULED_JOB_TYPES], [...V10_TYPES, "apparati_scelti"]);
  const m = /CREATE TABLE IF NOT EXISTS scheduled_jobs \(([\s\S]*?)\n\);/.exec(TENANT_SCHEMA_SQL);
  assert.ok(m, "scheduled_jobs non trovata in TENANT_SCHEMA_SQL");
  assert.deepEqual(checkList(m[0]), [...SCHEDULED_JOB_TYPES]);
});

test("v11 su un DB col CHECK della v10: accetta apparati_scelti, righe identiche, contatore e indice, seconda passata ferma", () => {
  const db = dbV10();
  const rete = Number(db.prepare("INSERT INTO networks (cidr, name) VALUES ('198.51.100.0/24', 'prova v11')").run().lastInsertRowid);
  const ins = db.prepare(
    `INSERT INTO scheduled_jobs (id, network_id, job_type, interval_minutes, last_run, next_run, enabled, config, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  ins.run(3, rete, "snmp_scan", 1440, "2026-10-21 03:00:00", "2026-10-22 03:00:00", 1, "{}", "2026-01-01 00:00:00", "2026-02-02 00:00:00");
  ins.run(5, null, "pulizia_host", 1440, null, null, 0, "{}", "2026-10-20 10:00:00", "2026-10-20 10:00:00");
  ins.run(9, null, "unifi_sync", 60, "2026-10-22 07:00:00", "2026-10-22 08:00:00", 1, '{"controller_id":1,"cosa":"client"}', "C", "U");
  // Un job cancellato dopo l'ultimo: gli id non si riusano nemmeno dopo la v11.
  ins.run(40, null, "cleanup", 1440, null, null, 1, "{}", "C", "U");
  db.prepare("DELETE FROM scheduled_jobs WHERE id = 40").run();
  const prima = db.prepare("SELECT * FROM scheduled_jobs ORDER BY id").all();
  const seqPrima = seq(db);
  assert.equal(seqPrima, 40);
  assert.throws(
    () => db.prepare("INSERT INTO scheduled_jobs (network_id, job_type) VALUES (NULL, 'apparati_scelti')").run(),
    /CHECK constraint failed/,
  );

  // La v10 non tocca un DB che ha già pulizia_host: tocca alla v11.
  assert.equal(migrateScheduledJobsV10(db), false);
  assert.equal(migrateScheduledJobsV11(db), true);
  assert.deepEqual(checkList(tableSql(db)), [...SCHEDULED_JOB_TYPES]);
  assert.deepEqual(db.prepare("SELECT * FROM scheduled_jobs ORDER BY id").all(), prima);
  assert.ok((seq(db) ?? 0) >= seqPrima, "il contatore AUTOINCREMENT non scende");
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_scheduled_jobs_enabled_next'").get());
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'scheduled_jobs_v11'").get() as { n: number }).n, 0);
  assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check(scheduled_jobs)").all(), []);
  assert.equal(db.pragma("integrity_check", { simple: true }), "ok");

  const nuovo = db
    .prepare("INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled, config) VALUES (NULL, 'apparati_scelti', 240, 1, '{}')")
    .run();
  assert.equal(Number(nuovo.lastInsertRowid), 41, "l'id continua dopo l'ultimo mai usato");
  // La chiave esterna verso networks vale ancora.
  db.prepare("DELETE FROM networks WHERE id = ?").run(rete);
  assert.equal(db.prepare("SELECT 1 FROM scheduled_jobs WHERE id = 3").get(), undefined);

  const dopo = tableSql(db);
  assert.equal(migrateScheduledJobsV11(db), false);
  assert.equal(tableSql(db), dopo);
});

test("v11 su un DB nuovo non fa niente: lo schema ha già apparati_scelti", () => {
  const db = new Database(":memory:");
  db.exec(TENANT_SCHEMA_SQL);
  const prima = tableSql(db);
  assert.equal(migrateScheduledJobsV11(db), false);
  assert.equal(tableSql(db), prima);
});

test("v11: se la copia non riesce la tabella resta com'era, righe comprese, e foreign_keys torna acceso", () => {
  const db = dbV10();
  db.prepare("INSERT INTO scheduled_jobs (network_id, job_type) VALUES (NULL, 'cleanup')").run();
  db.pragma("ignore_check_constraints = ON");
  db.prepare("INSERT INTO scheduled_jobs (network_id, job_type) VALUES (NULL, 'job_sparito')").run();
  db.pragma("ignore_check_constraints = OFF");
  const prima = tableSql(db);

  assert.throws(() => migrateScheduledJobsV11(db), /CHECK constraint failed/);
  assert.equal(tableSql(db), prima);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM scheduled_jobs").get() as { n: number }).n, 2);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'scheduled_jobs_v11'").get() as { n: number }).n, 0);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_scheduled_jobs_enabled_next'").get());
  assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
});

test("migraApparatiScelti: tabella, indice e segno; la seconda passata non aggiunge niente e non riscrive il segno", () => {
  const db = new Database(":memory:");
  db.exec(TENANT_SCHEMA_SQL);
  assert.deepEqual(migraApparatiScelti(db), ["idx_job_apparati_esiti_device"]);
  const segno = leggiSegno(db, SEGNO_APPARATI_SCELTI);
  assert.match(segno ?? "", /^done:\d{4}-\d{2}-\d{2}:v1$/);
  assert.deepEqual(migraApparatiScelti(db), []);
  assert.equal(leggiSegno(db, SEGNO_APPARATI_SCELTI), segno);
  // Una riga per job e apparato: la seconda scrittura sullo stesso paio sostituisce.
  const ins = db.prepare("INSERT OR REPLACE INTO job_apparati_esiti (job_id, device_id, giro_il, stato, letture, motivo) VALUES (?, ?, ?, ?, ?, ?)");
  ins.run(1, 7, "2026-10-22 06:00:00", "ok", '{"info":{"stato":"letto"}}', null);
  ins.run(1, 7, "2026-10-22 10:00:00", "escluso", "{}", "TOLTO");
  assert.deepEqual(db.prepare("SELECT job_id, device_id, giro_il, stato, letture, motivo FROM job_apparati_esiti").all(), [
    { job_id: 1, device_id: 7, giro_il: "2026-10-22 10:00:00", stato: "escluso", letture: "{}", motivo: "TOLTO" },
  ]);
  assert.equal(
    (db.prepare("SELECT letture FROM job_apparati_esiti").get() as { letture: string }).letture,
    "{}",
  );
});

test("migraApparatiScelti su un DB senza la tabella (schema di ieri): la crea", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE tenant_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)");
  assert.deepEqual(migraApparatiScelti(db), ["job_apparati_esiti", "idx_job_apparati_esiti_device"]);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='job_apparati_esiti'").get());
});

test("DB tenant vero col CHECK della v10 e job dentro: aperto con getTenantDb passa alla v11, job identici, segno scritto", () => {
  deleteTenantDatabase(T);
  getTenantDb(T);
  closeTenantDb(T);

  // Riporto il file del tenant alla forma della v10, senza la tabella degli esiti, con job veri dentro.
  const file = path.join(resolveDataDir(), "tenants", `${T}.db`);
  const raw = new Database(file);
  raw.pragma("foreign_keys = OFF");
  raw.exec("DROP TABLE scheduled_jobs");
  raw.exec("DROP TABLE IF EXISTS job_apparati_esiti");
  raw.exec(`DELETE FROM tenant_settings WHERE key = '${SEGNO_APPARATI_SCELTI}'`);
  raw.exec(V10_DDL);
  raw.exec("CREATE INDEX idx_scheduled_jobs_enabled_next ON scheduled_jobs(enabled, next_run)");
  raw.pragma("foreign_keys = ON");
  const ins = raw.prepare(
    `INSERT INTO scheduled_jobs (id, network_id, job_type, interval_minutes, last_run, next_run, enabled, config, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  ins.run(2, null, "arp_poll", 60, "2026-10-22 07:00:00", "2026-10-22 08:00:00", 1, "{}", "C", "U");
  ins.run(6, null, "pulizia_host", 1440, null, null, 0, "{}", "C", "U");
  const prima = raw.prepare("SELECT * FROM scheduled_jobs ORDER BY id").all();
  assert.doesNotMatch(tableSql(raw), /apparati_scelti/);
  raw.close();

  const db = getTenantDb(T);
  assert.deepEqual(db.prepare("SELECT * FROM scheduled_jobs ORDER BY id").all(), prima);
  assert.deepEqual(checkList(tableSql(db)), [...SCHEDULED_JOB_TYPES]);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='job_apparati_esiti'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_job_apparati_esiti_device'").get());
  assert.match(leggiSegno(db, SEGNO_APPARATI_SCELTI) ?? "", /^done:\d{4}-\d{2}-\d{2}:v1$/);
  // Il job apparati_scelti non si crea da solo.
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM scheduled_jobs WHERE job_type = 'apparati_scelti'").get() as { n: number }).n, 0);
  assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
});

test("tenant nuovo: CHECK con apparati_scelti, tabella degli esiti col suo indice, segno scritto", () => {
  deleteTenantDatabase(T_NUOVO);
  const db = getTenantDb(T_NUOVO);
  assert.deepEqual(checkList(tableSql(db)), [...SCHEDULED_JOB_TYPES]);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_job_apparati_esiti_device'").get());
  assert.match(leggiSegno(db, SEGNO_APPARATI_SCELTI) ?? "", /^done:\d{4}-\d{2}-\d{2}:v1$/);
});
