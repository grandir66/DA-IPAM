/**
 * Job notturno `pulizia_host` (piano 2026-10-20, Task 5; decisione 4: tutto nasce spento). Zona rossa: è
 * l'unica strada che toglie host del cliente senza che una persona prema «Applica».
 *
 * Si prova: la migrazione v10 di `scheduled_jobs` (il CHECK accetta `pulizia_host`, le righe restano, la
 * seconda passata non fa niente); che il job non nasce da solo; che l'interruttore lo crea una volta sola e
 * spento lo cancella; che il giro archivia i candidati e lascia gli esclusi, salta (e conta) un host che nel
 * frattempo non si può più archiviare, rinvia gli host di una rete in scansione, e su ogni altro guasto si
 * ferma e lancia senza nomi né IP nel messaggio; che il log dice solo numeri; che gira alle 04:00.
 *
 * Run: node --import tsx --test src/lib/hosts/__tests__/pulizia-job.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import path from "node:path";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { resolveDataDir } from "@/lib/data-dir";
import {
  closeTenantDb,
  deleteTenantDatabase,
  getPuliziaHostSchedule,
  getTenantDb,
  migrateScheduledJobsV9,
  migrateScheduledJobsV10,
  setPuliziaHostSchedule,
  withTenant,
} from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { SCHEDULED_JOB_TYPES, PULIZIA_HOST_MINUTES } from "@/lib/scheduled-job-types";
import { runJob } from "@/lib/cron/jobs";
import { intervalToCron } from "@/lib/cron/scheduler";
import { runPuliziaHost } from "@/lib/hosts/pulizia-archivio";
import { prendiRete } from "@/lib/scanner/network-scan-lock";

const T = "PULIZIAJOB2010";
const T_V9 = "PULIZIAJOBV9";

after(() => {
  for (const t of [T, T_V9]) {
    try { closeTenantDb(t); deleteTenantDatabase(t); } catch { /* già tolto */ }
  }
  closeHubDb();
});

beforeEach(() => {
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* non c'era */ }
});

// ── Migrazione v10 ────────────────────────────────────────────────────────────

// Il CHECK della v9 com'è in esercizio alla v0.3.322 (hub e cliente A).
const V9_TYPES = [
  "ping_sweep", "snmp_scan", "nmap_scan", "arp_poll", "dns_resolve", "fast_scan", "cleanup",
  "known_host_check", "ad_sync", "anomaly_check", "librenms_sync", "vuln_sync", "wazuh_sync",
  "wazuh_alerts_sync", "mdm_sync", "meshcentral_sync", "unifi_sync", "hypervisor_sync",
];
const V9_DDL = `CREATE TABLE scheduled_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK(job_type IN (${V9_TYPES.map((t) => `'${t}'`).join(", ")})),
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

function tableSql(db: Database.Database): string {
  return (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scheduled_jobs'").get() as { sql: string }).sql;
}

function dbV9(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec("CREATE TABLE networks (id INTEGER PRIMARY KEY AUTOINCREMENT, cidr TEXT NOT NULL UNIQUE, name TEXT NOT NULL)");
  db.exec(V9_DDL);
  return db;
}

test("tipi: pulizia_host in coda, dopo i tipi della v9 che restano tutti", () => {
  assert.deepEqual([...SCHEDULED_JOB_TYPES], [...V9_TYPES, "pulizia_host"]);
  assert.equal(PULIZIA_HOST_MINUTES, 1440);
});

test("v10 su un DB col CHECK della v9: accetta pulizia_host, righe identiche, seconda passata ferma", () => {
  const db = dbV9();
  db.prepare("INSERT INTO scheduled_jobs (id, network_id, job_type, interval_minutes, last_run, enabled, config) VALUES (4, NULL, 'hypervisor_sync', 1440, '2026-10-19 03:00:00', 1, '{}')").run();
  db.prepare("INSERT INTO scheduled_jobs (id, network_id, job_type, interval_minutes, enabled, config) VALUES (7, NULL, 'cleanup', 1440, 0, '{\"x\":1}')").run();
  const prima = db.prepare("SELECT * FROM scheduled_jobs ORDER BY id").all();
  assert.throws(() => db.prepare("INSERT INTO scheduled_jobs (network_id, job_type) VALUES (NULL, 'pulizia_host')").run(), /CHECK constraint failed/);

  // La v9 non tocca un DB che ha già hypervisor_sync: tocca alla v10.
  assert.equal(migrateScheduledJobsV9(db), false);
  assert.equal(migrateScheduledJobsV10(db), true);
  assert.deepEqual(checkList(tableSql(db)), [...SCHEDULED_JOB_TYPES]);
  assert.deepEqual(db.prepare("SELECT * FROM scheduled_jobs ORDER BY id").all(), prima);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_scheduled_jobs_enabled_next'").get());
  assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
  const nuovo = db.prepare("INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes) VALUES (NULL, 'pulizia_host', 1440)").run();
  assert.equal(Number(nuovo.lastInsertRowid), 8, "l'id continua dopo l'ultimo");

  const dopo = tableSql(db);
  assert.equal(migrateScheduledJobsV10(db), false);
  assert.equal(tableSql(db), dopo);
});

test("v10 su un DB nuovo non fa niente: lo schema ha già pulizia_host", () => {
  const db = new Database(":memory:");
  db.exec(TENANT_SCHEMA_SQL);
  const prima = tableSql(db);
  assert.equal(migrateScheduledJobsV10(db), false);
  assert.equal(tableSql(db), prima);
});

test("DB tenant vero col CHECK della v9: aperto con getTenantDb passa alla v10, job intatti, nessun pulizia_host creato", () => {
  deleteTenantDatabase(T_V9);
  getTenantDb(T_V9);
  closeTenantDb(T_V9);
  const raw = new Database(path.join(resolveDataDir(), "tenants", `${T_V9}.db`));
  raw.pragma("foreign_keys = OFF");
  raw.exec("DROP TABLE scheduled_jobs");
  raw.exec(V9_DDL);
  raw.exec("CREATE INDEX idx_scheduled_jobs_enabled_next ON scheduled_jobs(enabled, next_run)");
  raw.pragma("foreign_keys = ON");
  raw.prepare("INSERT INTO scheduled_jobs (id, network_id, job_type, interval_minutes, enabled, config) VALUES (5, NULL, 'hypervisor_sync', 1440, 1, '{}')").run();
  const prima = raw.prepare("SELECT * FROM scheduled_jobs ORDER BY id").all();
  raw.close();

  const db = getTenantDb(T_V9);
  assert.deepEqual(checkList(tableSql(db)), [...SCHEDULED_JOB_TYPES]);
  assert.deepEqual(db.prepare("SELECT * FROM scheduled_jobs ORDER BY id").all(), prima);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'scheduled_jobs_v10'").get(), undefined);
  assert.equal(db.prepare("SELECT 1 FROM scheduled_jobs WHERE job_type = 'pulizia_host'").get(), undefined);
});

// ── Spento di default, interruttore ───────────────────────────────────────────

const righeJob = () =>
  getTenantDb(T).prepare("SELECT id, network_id, interval_minutes, enabled, config FROM scheduled_jobs WHERE job_type = 'pulizia_host' ORDER BY id").all() as
    Array<{ id: number; network_id: number | null; interval_minutes: number; enabled: number; config: string }>;

test("un tenant nuovo non ha il job pulizia_host: spento", () => {
  withTenant(T, () => {
    assert.deepEqual(righeJob(), []);
    assert.deepEqual(getPuliziaHostSchedule(), { enabled: false, jobId: null, lastRun: null });
  });
});

test("interruttore: acceso due volte = una riga (1440 minuti, config {}); spento = riga cancellata", () => {
  withTenant(T, () => {
    setPuliziaHostSchedule(true);
    setPuliziaHostSchedule(true);
    const righe = righeJob();
    assert.equal(righe.length, 1);
    assert.deepEqual({ ...righe[0], id: 0 }, { id: 0, network_id: null, interval_minutes: 1440, enabled: 1, config: "{}" });
    assert.deepEqual(getPuliziaHostSchedule(), { enabled: true, jobId: righe[0].id, lastRun: null });

    // Spento dalla pagina dei job (enabled = 0) e riacceso dall'interruttore: stessa riga, di nuovo accesa.
    getTenantDb(T).prepare("UPDATE scheduled_jobs SET enabled = 0, interval_minutes = 60 WHERE id = ?").run(righe[0].id);
    assert.equal(getPuliziaHostSchedule().enabled, false);
    setPuliziaHostSchedule(true);
    assert.deepEqual(righeJob(), [{ ...righe[0] }]);

    setPuliziaHostSchedule(false);
    assert.deepEqual(righeJob(), []);
    assert.deepEqual(getPuliziaHostSchedule(), { enabled: false, jobId: null, lastRun: null });
  });
});

test("lo scheduler mette pulizia_host alle 04:00, gli altri giornalieri restano alle 03:00", () => {
  assert.equal(intervalToCron(1440, "pulizia_host"), "0 4 * * *");
  assert.equal(intervalToCron(1440, "hypervisor_sync"), "0 3 * * *");
  assert.equal(intervalToCron(1440), "0 3 * * *");
  assert.equal(intervalToCron(2880, "pulizia_host"), "0 4 */2 * *");
  assert.equal(intervalToCron(60, "pulizia_host"), "0 */1 * * *", "sotto il giorno l'ora fissa non conta");
});

// ── Il giro ───────────────────────────────────────────────────────────────────

let reti = 0;
function nuovaRete(d: Database.Database): { id: number; prefisso: string } {
  reti += 1;
  const prefisso = `10.${150 + reti}.0`;
  const id = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES (?, ?)").run(`${prefisso}.0/24`, `r${reti}`).lastInsertRowid);
  return { id, prefisso };
}

/** Un host come lo scrive la scansione, assente da `giorni`. */
function host(d: Database.Database, rete: number, ip: string, o: { custom_name?: string; giorni?: number } = {}): number {
  return Number(d.prepare(`INSERT INTO hosts (network_id, ip, hostname, custom_name, status, first_seen, last_seen)
      VALUES (?, ?, ?, ?, 'offline', datetime('now', '-200 days'), datetime('now', ?))`)
    .run(rete, ip, `pc-${ip.split(".").at(-1)}`, o.custom_name ?? null, `-${o.giorni ?? 100} days`).lastInsertRowid);
}

const inHosts = (d: Database.Database, id: number) => d.prepare("SELECT 1 FROM hosts WHERE id = ?").get(id) !== undefined;
const archiviatoDa = (d: Database.Database, id: number) =>
  (d.prepare("SELECT archiviato_da FROM hosts_archivio WHERE host_id_originale = ?").get(id) as { archiviato_da: string } | undefined)?.archiviato_da;

/** Le righe che `fn` scrive con console.info, e il suo risultato (o l'errore). */
function conLog<R>(fn: () => R): { righe: string[]; esito?: R; errore?: unknown } {
  const righe: string[] = [];
  const originale = console.info;
  console.info = (...a: unknown[]) => { righe.push(a.map(String).join(" ")); };
  try {
    return { righe, esito: fn() };
  } catch (errore) {
    return { righe, errore };
  } finally {
    console.info = originale;
  }
}

test("runJob del job: archivia il candidato (da «job»), lascia l'escluso, cancella l'archivio scaduto, log solo numeri", async () => {
  await withTenant(T, async () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    const candidato = host(d, rete.id, `${rete.prefisso}.10`);
    const escluso = host(d, rete.id, `${rete.prefisso}.11`, { custom_name: "Stampante Anna" });
    // Una riga d'archivio di 91 giorni fa: il giro la cancella.
    d.prepare("INSERT INTO hosts_archivio (host_id_originale, network_id, ip, nome, motivo, istantanea, archiviato_da, archiviato_il) VALUES (9999, ?, ?, 'vecchio', 'assente', '{}', 'anna', datetime('now', '-91 days'))")
      .run(rete.id, `${rete.prefisso}.99`);
    setPuliziaHostSchedule(true);
    const { jobId } = getPuliziaHostSchedule();
    assert.ok(jobId);

    const righe: string[] = [];
    const originale = console.info;
    console.info = (...a: unknown[]) => { righe.push(a.map(String).join(" ")); };
    let esito: Awaited<ReturnType<typeof runJob>> | undefined;
    try {
      esito = await runJob(jobId);
    } finally {
      console.info = originale;
    }
    assert.equal(esito?.esito, "eseguito");
    assert.ok(!inHosts(d, candidato), "il candidato è tolto da hosts");
    assert.equal(archiviatoDa(d, candidato), "job");
    assert.ok(inHosts(d, escluso), "l'host col nome scritto a mano resta");
    assert.equal(archiviatoDa(d, escluso), undefined);
    assert.equal(d.prepare("SELECT 1 FROM hosts_archivio WHERE nome = 'vecchio'").get(), undefined, "archivio scaduto cancellato");

    const log = righe.join("\n");
    assert.match(log, /\[Scheduler\] pulizia_host: 1 archiviati, 1 cancellati dall'archivio/);
    assert.doesNotMatch(log, new RegExp(rete.prefisso.replace(/\./g, "\\.")), "nessun IP nel log");
    assert.doesNotMatch(log, /pc-1|Stampante|vecchio/, "nessun nome nel log");
  });
});

test("un host che a metà giro non si può più archiviare (tornato online) si salta e si conta; gli altri si archiviano", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    const a = host(d, rete.id, `${rete.prefisso}.10`);
    const b = host(d, rete.id, `${rete.prefisso}.11`);
    const c = host(d, rete.id, `${rete.prefisso}.12`);
    // Mentre si archivia a, b torna online (come lo scriverebbe la scansione).
    d.exec(`CREATE TEMP TRIGGER prova_torna AFTER INSERT ON hosts_archivio WHEN NEW.host_id_originale = ${a}
      BEGIN UPDATE hosts SET status = 'online', last_seen = datetime('now') WHERE id = ${b}; END`);
    try {
      const { esito, errore, righe } = conLog(() => runPuliziaHost());
      assert.equal(errore, undefined);
      assert.deepEqual(esito, { archiviati: 2, nonPiuArchiviabili: 1, rinviati: 0, cancellatiDallArchivio: 0 });
      assert.match(righe.join("\n"), /2 archiviati, 0 cancellati dall'archivio, 1 non più archiviabili/);
    } finally {
      d.exec("DROP TRIGGER IF EXISTS prova_torna");
    }
    assert.ok(!inHosts(d, a) && !inHosts(d, c));
    assert.ok(inHosts(d, b), "b resta, online");
  });
});

test("ogni altro guasto ferma il giro e lancia, senza nomi né IP nel messaggio; i già archiviati restano", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    const a = host(d, rete.id, `${rete.prefisso}.10`);
    const b = host(d, rete.id, `${rete.prefisso}.11`);
    const c = host(d, rete.id, `${rete.prefisso}.12`);
    const scaduta = Number(d.prepare("INSERT INTO hosts_archivio (host_id_originale, network_id, ip, nome, motivo, istantanea, archiviato_da, archiviato_il) VALUES (9999, ?, ?, 'vecchio', 'assente', '{}', 'anna', datetime('now', '-91 days'))")
      .run(rete.id, `${rete.prefisso}.99`).lastInsertRowid);
    d.exec(`CREATE TEMP TRIGGER prova_guasto BEFORE DELETE ON hosts WHEN OLD.id = ${b} BEGIN SELECT RAISE(ABORT, 'guasto di prova'); END`);
    try {
      const { errore } = conLog(() => runPuliziaHost());
      assert.ok(errore instanceof Error, "il giro lancia: lo scheduler lo conta fra i falliti");
      assert.match(errore.message, new RegExp(`host #${b}`));
      assert.match(errore.message, /guasto di prova/);
      assert.match(errore.message, /1 archiviati prima del guasto, 2 ancora fra gli host/);
      assert.doesNotMatch(errore.message, /10\.\d+\.0\.\d+|pc-1/, "niente IP né nomi: finisce nel journal");
    } finally {
      d.exec("DROP TRIGGER IF EXISTS prova_guasto");
    }
    assert.ok(!inHosts(d, a), "a archiviato davvero");
    assert.ok(inHosts(d, b) && inHosts(d, c), "b e c ancora in hosts");
    assert.ok(d.prepare("SELECT 1 FROM hosts_archivio WHERE id = ?").get(scaduta), "dopo un guasto l'archivio non si cancella");
  });
});

test("gli host di una rete in scansione si rinviano alla notte dopo; le altre reti si puliscono", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const occupata = nuovaRete(d);
    const libera = nuovaRete(d);
    const x = host(d, occupata.id, `${occupata.prefisso}.10`);
    const y = host(d, libera.id, `${libera.prefisso}.10`);
    const rilascia = prendiRete(T, occupata.id, { scanId: "prova", scanType: "ping_sweep" });
    try {
      const { esito, righe } = conLog(() => runPuliziaHost());
      assert.deepEqual(esito, { archiviati: 1, nonPiuArchiviabili: 0, rinviati: 1, cancellatiDallArchivio: 0 });
      assert.match(righe.join("\n"), /1 rinviati \(rete in scansione\)/);
    } finally {
      rilascia();
    }
    assert.ok(inHosts(d, x), "rete in scansione: non si tocca");
    assert.ok(!inHosts(d, y));
    assert.deepEqual(conLog(() => runPuliziaHost()).esito, { archiviati: 1, nonPiuArchiviabili: 0, rinviati: 0, cancellatiDallArchivio: 0 });
    assert.ok(!inHosts(d, x), "a scansione finita si archivia");
  });
});

test("senza contesto tenant il giro lancia, non ripiega su DEFAULT", () => {
  assert.throws(() => runPuliziaHost(), /contesto tenant/i);
});
