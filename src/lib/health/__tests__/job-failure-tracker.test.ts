import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALARM_REPEAT_MINUTES,
  createFailureState,
  findFailingJobs,
  findTenantOutages,
  markContextCorruption,
  recordOutcome,
  shouldEmitAlarm,
  summarizeFailures,
  tenantOfKey,
} from "@/lib/health/job-failure-tracker";

const NOW = Date.parse("2026-09-02T18:15:00Z");
const MIN = 60_000;

function failNTimes(state: ReturnType<typeof createFailureState>, key: string, n: number, at = NOW) {
  for (let i = 0; i < n; i++) {
    recordOutcome(state, key, { ok: false, error: "Job #20 non trovato" }, at + i * MIN);
  }
}

test("tenantOfKey estrae il tenant dalla chiave 'tenant:jobId'", () => {
  assert.equal(tenantOfKey("70791:20"), "70791");
  // I codici tenant possono contenere lettere: si taglia sull'ULTIMO ':'.
  assert.equal(tenantOfKey("70791a:7"), "70791a");
  assert.equal(tenantOfKey("senza-due-punti"), "senza-due-punti");
});

test("un job che gira bene non risulta in fallimento", () => {
  const s = createFailureState();
  recordOutcome(s, "70791:20", { ok: true }, NOW);
  assert.deepEqual(findFailingJobs(s), []);
  assert.equal(summarizeFailures(s).ok, true);
});

test("sotto soglia non si segnala nulla: due fallimenti possono essere un caso", () => {
  const s = createFailureState();
  failNTimes(s, "70791:20", 2);
  assert.deepEqual(findFailingJobs(s), []);
});

test("dal terzo fallimento consecutivo il job e' in serie", () => {
  const s = createFailureState();
  failNTimes(s, "70791:20", 3);
  const failing = findFailingJobs(s);
  assert.equal(failing.length, 1);
  assert.equal(failing[0].consecutiveFailures, 3);
  assert.equal(failing[0].tenantCode, "70791");
  assert.equal(failing[0].lastError, "Job #20 non trovato");
});

test("un successo azzera la serie: il guasto risolto non resta appeso", () => {
  const s = createFailureState();
  failNTimes(s, "70791:20", 5);
  recordOutcome(s, "70791:20", { ok: true }, NOW + 10 * MIN);
  assert.deepEqual(findFailingJobs(s), []);
  assert.equal(summarizeFailures(s).ok, true);
});

test("piu' job dello stesso tenant in serie = guasto sistemico", () => {
  // E' la firma del 2026-09-02: non un'integrazione rotta, il processo.
  const s = createFailureState();
  for (const id of [2, 7, 15, 20]) failNTimes(s, `70791:${id}`, 3);
  const outages = findTenantOutages(s);
  assert.equal(outages.length, 1);
  assert.deepEqual(outages[0], { tenantCode: "70791", jobCount: 4 });
});

test("due job rotti su tenant DIVERSI non sono un guasto sistemico", () => {
  const s = createFailureState();
  failNTimes(s, "70791:19", 4);   // meshcentral_sync rotto per conto suo
  failNTimes(s, "70791a:7", 4);
  assert.deepEqual(findTenantOutages(s), []);
  assert.equal(findFailingJobs(s).length, 2);
});

test("l'allarme scatta una volta e poi tace per un'ora: il canale non va reso rumore", () => {
  const s = createFailureState();
  failNTimes(s, "70791:20", 3);
  assert.equal(shouldEmitAlarm(s, "70791:20", NOW), true, "primo allarme");
  assert.equal(shouldEmitAlarm(s, "70791:20", NOW + MIN), false, "un minuto dopo: zitto");
  assert.equal(
    shouldEmitAlarm(s, "70791:20", NOW + ALARM_REPEAT_MINUTES * MIN + 1),
    true,
    "passata l'ora si ripete",
  );
});

test("dopo un successo l'allarme puo' riscattare subito al guasto successivo", () => {
  const s = createFailureState();
  failNTimes(s, "70791:20", 3);
  assert.equal(shouldEmitAlarm(s, "70791:20", NOW), true);
  recordOutcome(s, "70791:20", { ok: true }, NOW + MIN);
  failNTimes(s, "70791:20", 3, NOW + 2 * MIN);
  assert.equal(shouldEmitAlarm(s, "70791:20", NOW + 5 * MIN), true);
});

test("il contesto corrotto e' un danno di processo: non si azzera da solo", () => {
  const s = createFailureState();
  markContextCorruption(s, { tenantCode: "70791", seen: null }, NOW);
  assert.equal(summarizeFailures(s).contextCorrupted, true);
  // Anche con tutti i job tornati verdi, resta segnato: serve un riavvio.
  recordOutcome(s, "70791:20", { ok: true }, NOW + 60 * MIN);
  assert.equal(summarizeFailures(s).ok, false);
  assert.equal(summarizeFailures(s).contextCorrupted, true);
});

test("della corruzione si conserva la PRIMA occorrenza, non l'ultima", () => {
  const s = createFailureState();
  markContextCorruption(s, { tenantCode: "70791", seen: null }, NOW);
  markContextCorruption(s, { tenantCode: "70791a", seen: "DEFAULT" }, NOW + 5 * MIN);
  assert.equal(s.contextCorruption?.tenantCode, "70791");
  assert.equal(s.contextCorruption?.atMs, NOW);
});

test("la vista per /api/health e' solo aggregata: nessun nome di job ne' tenant", () => {
  // L'endpoint e' pubblico: i codici tenant non devono uscire da qui.
  const s = createFailureState();
  for (const id of [2, 7, 15]) failNTimes(s, `70791:${id}`, 4);
  const health = summarizeFailures(s);
  assert.deepEqual(health, {
    ok: false,
    failingJobs: 3,
    worstStreak: 4,
    tenantOutages: 1,
    contextCorrupted: false,
  });
  assert.equal(JSON.stringify(health).includes("70791"), false);
});
