import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findStaleJobs,
  parseSqlUtc,
  summarizeFreshness,
  type SchedulerJobRow,
} from "@/lib/health/scheduler-freshness";

const NOW = Date.parse("2026-07-16T22:00:00Z");

function row(over: Partial<SchedulerJobRow> = {}): SchedulerJobRow {
  return {
    job_type: "meshcentral_sync",
    interval_minutes: 15,
    last_run: "2026-07-16 21:55:00",
    created_at: "2026-06-01 10:00:00",
    enabled: 1,
    ...over,
  };
}

test("parseSqlUtc tratta 'YYYY-MM-DD HH:MM:SS' come UTC, non come ora locale", () => {
  // La trappola: new Date("2026-07-16 22:15:00") lo interpreta come ora LOCALE.
  // In Italia d'estate sono 2h di sfasamento — abbastanza da mascherare uno
  // stallo o da inventarne uno inesistente.
  assert.equal(parseSqlUtc("2026-07-16 22:15:00"), Date.parse("2026-07-16T22:15:00Z"));
  // Se la timezone e' gia' esplicita va rispettata, non ri-marcata come UTC.
  assert.equal(parseSqlUtc("2026-07-16T22:15:00Z"), Date.parse("2026-07-16T22:15:00Z"));
  assert.equal(parseSqlUtc("2026-07-16T22:15:00+02:00"), Date.parse("2026-07-16T20:15:00Z"));
  assert.equal(parseSqlUtc(null), null);
  assert.equal(parseSqlUtc(""), null);
  assert.equal(parseSqlUtc("non-una-data"), null);
});

test("un job che gira regolarmente non e' stale", () => {
  assert.deepEqual(findStaleJobs([row()], NOW), []);
});

test("tolleranza: un solo giro saltato NON e' stale", () => {
  // interval 15 → soglia = 15*3 + 15 = 60 min. A 20 min di ritardo si tace.
  assert.deepEqual(findStaleJobs([row({ last_run: "2026-07-16 21:40:00" })], NOW), []);
});

test("riproduce l'incidente: scheduler fermo da 11 giorni", () => {
  // Caso reale PX-NAS: i job si sono fermati il 2026-07-05 18:15 UTC (= 20:15
  // CEST) per lo stallo I/O dell'hypervisor, e nessuno se n'e' accorto per 11
  // giorni perche' /api/health guardava solo DB + chiave.
  const stale = findStaleJobs([row({ last_run: "2026-07-05 18:15:00" })], NOW);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].jobType, "meshcentral_sync");
  assert.equal(stale[0].neverRan, false);
  // 11 giorni e ~3.75h di elapsed, meno l'intervallo di 15 min.
  assert.ok(stale[0].overdueMinutes > 11 * 24 * 60, "ritardo di oltre 11 giorni");
});

test("job disabilitato: spento di proposito, non fermo", () => {
  assert.deepEqual(findStaleJobs([row({ enabled: 0, last_run: "2026-01-01 00:00:00" })], NOW), []);
});

test("mai girato: si usa created_at, cosi' uno scheduler mai partito non resta invisibile", () => {
  const stale = findStaleJobs([row({ last_run: null, created_at: "2026-07-01 00:00:00" })], NOW);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].neverRan, true);
  assert.equal(stale[0].lastRun, null);
});

test("job appena creato e mai girato NON e' stale (installazione fresca)", () => {
  // Regressione: /api/health e' un gate degli installer (curl -f su
  // consolidated-installer.sh / edge-installer.sh). Se un job appena seminato
  // risultasse stale, un'installazione pulita potrebbe non completare mai.
  const stale = findStaleJobs([row({ last_run: null, created_at: "2026-07-16 21:59:00" })], NOW);
  assert.deepEqual(stale, []);
});

test("senza alcun riferimento temporale il job non e' giudicabile → ignorato", () => {
  assert.deepEqual(findStaleJobs([row({ last_run: null, created_at: null })], NOW), []);
});

test("intervallo non valido → ignorato invece di dividere per zero", () => {
  assert.deepEqual(findStaleJobs([row({ interval_minutes: 0 })], NOW), []);
  assert.deepEqual(findStaleJobs([row({ interval_minutes: -5 })], NOW), []);
});

test("i job piu' in ritardo vengono per primi", () => {
  const stale = findStaleJobs(
    [
      row({ job_type: "vuln_sync", interval_minutes: 30, last_run: "2026-07-16 18:00:00" }),
      row({ job_type: "fast_scan", interval_minutes: 120, last_run: "2026-07-05 18:00:00" }),
    ],
    NOW,
  );
  assert.equal(stale.length, 2);
  assert.equal(stale[0].jobType, "fast_scan", "il peggiore per primo");
});

test("il riassunto pubblico aggrega e NON espone i nomi dei job", () => {
  // /api/health e' senza auth: un chiamante anonimo deve sapere CHE qualcosa e'
  // fermo e da quanto, non quali job girano ne' per quali tenant.
  const stale = findStaleJobs([row({ last_run: "2026-07-05 18:15:00" })], NOW);
  const s = summarizeFreshness(stale);
  assert.equal(s.ok, false);
  assert.equal(s.staleCount, 1);
  assert.ok(s.worstOverdueMinutes! > 11 * 24 * 60);
  assert.equal(JSON.stringify(s).includes("meshcentral"), false, "nessun nome di job nel payload pubblico");
});

test("tutto sano → riassunto ok", () => {
  const s = summarizeFreshness([]);
  assert.deepEqual(s, { ok: true, staleCount: 0, worstOverdueMinutes: null });
});
