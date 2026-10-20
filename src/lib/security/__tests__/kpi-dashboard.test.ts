/**
 * KPI di sicurezza della dashboard (Riccardo, 20/10), misurati sull'hub prima di scriverli.
 *
 * Revisione del 20/10: gli alert sono raggruppati e sull'hub un gruppo resta aperto per
 * mesi; contato tutto nel giorno dell'ultima occorrenza, dava 41.223 accessi falliti
 * nelle ultime 24 ore contro circa 530. Si riparte ogni gruppo sulla sua durata.
 *
 * Run: node --import tsx --test src/lib/security/__tests__/kpi-dashboard.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { kpiSicurezza, quoteNellIntervallo } from "../kpi-dashboard";

const ORA = new Date("2026-10-20T10:00:00.000Z"); // 12:00 italiane
const iso = (oreFa: number) => new Date(ORA.getTime() - oreFa * 3_600_000).toISOString();

function db(): Database.Database {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE vuln_findings (id INTEGER PRIMARY KEY, host_id INTEGER, cve_id TEXT, nvt_oid TEXT, severity TEXT, scanned_at TEXT);
    CREATE TABLE wazuh_alert_event (id INTEGER PRIMARY KEY, category TEXT, diagnostic INTEGER DEFAULT 0, event_id TEXT, occurrence_count INTEGER, first_seen_at TEXT, last_seen_at TEXT, acknowledged INTEGER DEFAULT 0);
    CREATE TABLE ad_health_runs (id INTEGER PRIMARY KEY, started_at TEXT, status TEXT, score_global INTEGER);
    CREATE TABLE ad_health_findings (id INTEGER PRIMARY KEY, run_id INTEGER, severity TEXT);
  `);
  return d;
}
const alert = (d: Database.Database, evento: string, n: number, daOre: number, aOre: number, x: { diagnostic?: number; acknowledged?: number } = {}) =>
  d.prepare("INSERT INTO wazuh_alert_event (category, diagnostic, event_id, occurrence_count, first_seen_at, last_seen_at, acknowledged) VALUES ('auth_failure', ?, ?, ?, ?, ?, ?)")
    .run(x.diagnostic ?? 0, evento, n, iso(daOre), iso(aOre), x.acknowledged ?? 0);

test("tabelle assenti: tutto null, nessun errore", () => {
  const k = kpiSicurezza(new Database(":memory:"), ORA);
  assert.deepEqual(k, { cve: null, accessi: null, healthAd: null });
});

test("vulnerabilità: CVE o NVT quando la CVE manca, host colpiti anche senza CVE", () => {
  const d = db();
  const ins = d.prepare("INSERT INTO vuln_findings (host_id, cve_id, nvt_oid, severity, scanned_at) VALUES (?, ?, ?, ?, '2026-10-19 16:00:00')");
  ins.run(1, "CVE-1", "o1", "Critical"); ins.run(2, "CVE-1", "o1", "Critical");
  ins.run(3, null, "o9", "Critical");
  ins.run(4, "CVE-3", "o3", "High"); ins.run(4, "CVE-3", "o3", "Log");
  const k = kpiSicurezza(d, ORA);
  assert.deepEqual(k.cve, { critiche: { cve: 2, host: 3 }, alte: { cve: 1, host: 1 }, ultimaScansione: "2026-10-19 16:00:00" });
});

test("ripartizione proporzionale: un gruppo aperto da 100 giorni non finisce tutto nelle ultime 24 ore", () => {
  assert.equal(quoteNellIntervallo({ evento: "4625", n: 100, da: 0, a: 100 }, 90, 100), 10);
  assert.equal(quoteNellIntervallo({ evento: "4625", n: 5, da: 50, a: 50 }, 40, 60), 5);
  const d = db();
  alert(d, "4625", 2400, 24 * 100, 1); // 100 giorni, ~24 al giorno
  const k = kpiSicurezza(d, ORA);
  assert.ok(k.accessi!.falliti24h >= 23 && k.accessi!.falliti24h <= 25, String(k.accessi!.falliti24h));
  assert.ok(k.accessi!.falliti24hPrima >= 23 && k.accessi!.falliti24hPrima <= 25);
});

test("diagnostici esclusi; bloccati 30 giorni; alert da gestire; serie in giorni italiani", () => {
  const d = db();
  alert(d, "4625", 100, 3, 2);
  alert(d, "4625", 9999, 3, 2, { diagnostic: 1 });
  alert(d, "4740", 4, 100, 100);
  alert(d, "4740", 9, 24 * 40, 24 * 40);
  alert(d, "4625", 50, 30, 30, { acknowledged: 1 });
  const k = kpiSicurezza(d, ORA);
  assert.equal(k.accessi?.falliti24h, 100);
  assert.equal(k.accessi?.falliti24hPrima, 50);
  assert.equal(k.accessi?.bloccati30g, 4);
  assert.equal(k.accessi?.daGestire, 3);
  assert.equal(k.accessi?.serie.length, 14);
  assert.equal(k.accessi?.serie.at(-1)?.giorno, "2026-10-20");
  assert.equal(k.accessi?.serie.at(-1)?.falliti, 100);
});

test("un evento alle 00:30 italiane cade nel giorno italiano, non in quello UTC di prima", () => {
  const d = db();
  // 2026-10-19T22:30Z = 20/10 00:30 italiane (ora legale).
  d.prepare("INSERT INTO wazuh_alert_event (diagnostic, event_id, occurrence_count, first_seen_at, last_seen_at) VALUES (0, '4625', 7, '2026-10-19T22:30:00.000Z', '2026-10-19T22:30:00.000Z')").run();
  const k = kpiSicurezza(d, ORA);
  assert.equal(k.accessi?.serie.at(-1)?.falliti, 7);
  assert.equal(k.accessi?.serie.at(-2)?.falliti, 0);
});

test("Health AD: ultima riuscita, rilievi, età; segnala un tentativo fallito più recente", () => {
  const d = db();
  d.prepare("INSERT INTO ad_health_runs (id, started_at, status, score_global) VALUES (1, '2026-07-27T18:42:54.554Z', 'ok', 100)").run();
  const f = d.prepare("INSERT INTO ad_health_findings (run_id, severity) VALUES (1, ?)");
  for (const s of ["Critical", "Critical", "High", "Medium"]) f.run(s);
  assert.deepEqual(kpiSicurezza(d, ORA).healthAd, { critici: 2, alti: 1, punteggio: 100, giorni: 84, ultimoFallito: false });
  d.prepare("INSERT INTO ad_health_runs (id, started_at, status, score_global) VALUES (2, '2026-10-01T10:00:00.000Z', 'error', null)").run();
  assert.equal(kpiSicurezza(d, ORA).healthAd?.ultimoFallito, true);
});
