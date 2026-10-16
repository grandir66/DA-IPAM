import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isRateLimited,
  clearRateLimit,
  recordFailedAttempt,
  checkRateLimit,
  loginLockState,
  LOGIN_FREE_ATTEMPTS,
  LOGIN_BASE_COOLDOWN_MS,
  LOGIN_MAX_COOLDOWN_MS,
  LOGIN_WINDOW_MS,
} from "@/lib/rate-limit";

const WINDOW = 15 * 60 * 1000;
const MAX = 5;

/** Chiave unica per test: lo store e' un modulo condiviso in-memory. */
let n = 0;
const k = () => `test:login:${++n}`;

test("isRateLimited NON consuma tentativi: 100 letture non bloccano nessuno", () => {
  const key = k();
  for (let i = 0; i < 100; i++) {
    assert.equal(isRateLimited(key, MAX, WINDOW), false);
  }
});

test("REGRESSIONE: 5 login RIUSCITI non devono bloccare l'utente", () => {
  // Il bug reale (2026-07-17, appliance 99.50): auth.ts usava checkRateLimit(),
  // che registra un timestamp a OGNI chiamata — anche quando la password era
  // corretta. Bastavano 5 accessi legittimi in 15 minuti per chiudere fuori
  // l'utente, che leggeva "credenziali errate" e si convinceva di aver
  // dimenticato la password.
  const key = k();
  for (let i = 0; i < 5; i++) {
    assert.equal(isRateLimited(key, MAX, WINDOW), false, `login riuscito n.${i + 1}`);
    clearRateLimit(key); // come fa auth.ts dopo una password corretta
  }
  assert.equal(isRateLimited(key, MAX, WINDOW), false, "il 6° accesso deve passare");
});

test("solo i FALLIMENTI riempiono il contatore; al 5° scatta il blocco", () => {
  const key = k();
  for (let i = 0; i < 4; i++) {
    recordFailedAttempt(key);
    assert.equal(isRateLimited(key, MAX, WINDOW), false, `dopo ${i + 1} fallimenti si puo' riprovare`);
  }
  recordFailedAttempt(key); // 5°
  assert.equal(isRateLimited(key, MAX, WINDOW), true, "al 5° fallimento si blocca");
});

test("REGRESSIONE: un fallimento non deve contare DOPPIO", () => {
  // Prima del fix un tentativo errato ne registrava due (checkRateLimit +
  // recordFailedAttempt): la soglia reale scendeva da 5 a ~3 errori.
  const key = k();
  recordFailedAttempt(key);
  recordFailedAttempt(key);
  recordFailedAttempt(key);
  assert.equal(
    isRateLimited(key, MAX, WINDOW),
    false,
    "3 password sbagliate non devono bastare a bloccare (la soglia e' 5)",
  );
});

test("password indovinata al 5° tentativo: clearRateLimit sblocca subito", () => {
  const key = k();
  for (let i = 0; i < 4; i++) recordFailedAttempt(key);
  assert.equal(isRateLimited(key, MAX, WINDOW), false);
  clearRateLimit(key); // 5° tentativo: password corretta
  for (let i = 0; i < 4; i++) recordFailedAttempt(key);
  assert.equal(isRateLimited(key, MAX, WINDOW), false, "i vecchi fallimenti non si accumulano dopo un successo");
});

test("il blocco e' per-utente: un attacco su un account non ne chiude fuori altri", () => {
  const victim = k();
  const other = k();
  for (let i = 0; i < 6; i++) recordFailedAttempt(victim);
  assert.equal(isRateLimited(victim, MAX, WINDOW), true);
  assert.equal(isRateLimited(other, MAX, WINDOW), false);
});

test("fuori dalla finestra temporale il blocco decade", () => {
  const key = k();
  for (let i = 0; i < 6; i++) recordFailedAttempt(key);
  assert.equal(isRateLimited(key, MAX, WINDOW), true);
  // Finestra di 0 ms: nessun timestamp e' "recente" → non bloccato.
  assert.equal(isRateLimited(key, MAX, 0), false, "scaduta la finestra si puo' riprovare");
});

test("checkRateLimit CONSUMA un tentativo a ogni chiamata (il footgun, documentato)", () => {
  // Comportamento intenzionale per limitare azioni costose; e' proprio il motivo
  // per cui il login NON deve usarla.
  const key = k();
  for (let i = 0; i < MAX; i++) {
    assert.equal(checkRateLimit(key, MAX, WINDOW), true, `chiamata n.${i + 1} consentita`);
  }
  assert.equal(checkRateLimit(key, MAX, WINDOW), false, "esaurita la soglia senza alcun fallimento");
});

// ── Backoff INCREMENTALE del login (loginLockState) ──
// Sostituisce il blocco "muto" a 15 min: cooldown crescente e visibile.

test("backoff login: i primi LOGIN_FREE_ATTEMPTS fallimenti non bloccano", () => {
  const key = k();
  for (let i = 0; i < LOGIN_FREE_ATTEMPTS; i++) {
    recordFailedAttempt(key);
    assert.equal(loginLockState(key).locked, false, `dopo ${i + 1} fallimenti niente blocco`);
  }
});

test("backoff login: al superamento della soglia si blocca, entro il cooldown base", () => {
  const key = k();
  for (let i = 0; i <= LOGIN_FREE_ATTEMPTS; i++) recordFailedAttempt(key); // FREE+1 fallimenti
  const st = loginLockState(key);
  assert.equal(st.locked, true, "al superamento della soglia si blocca");
  assert.ok(
    st.retryAfterSec > 0 && st.retryAfterSec <= LOGIN_BASE_COOLDOWN_MS / 1000,
    `retryAfterSec (${st.retryAfterSec}) entro il cooldown base (${LOGIN_BASE_COOLDOWN_MS / 1000}s)`,
  );
});

test("backoff login: il cooldown CRESCE a ogni ulteriore fallimento (incrementale)", () => {
  const key = k();
  for (let i = 0; i <= LOGIN_FREE_ATTEMPTS; i++) recordFailedAttempt(key); // primo blocco
  const s1 = loginLockState(key).retryAfterSec;
  recordFailedAttempt(key); // un fallimento in più
  const s2 = loginLockState(key).retryAfterSec;
  assert.ok(s2 > s1, `il cooldown deve crescere: ${s2}s > ${s1}s`);
});

test("backoff login: il cooldown è limitato a LOGIN_MAX_COOLDOWN_MS", () => {
  const key = k();
  for (let i = 0; i < 40; i++) recordFailedAttempt(key); // moltissimi fallimenti
  const st = loginLockState(key);
  assert.equal(st.locked, true);
  assert.ok(
    st.retryAfterSec <= LOGIN_MAX_COOLDOWN_MS / 1000,
    `retryAfterSec (${st.retryAfterSec}s) non supera il tetto (${LOGIN_MAX_COOLDOWN_MS / 1000}s)`,
  );
});

test("backoff login: passato il cooldown, retryAfterSec torna a 0", () => {
  const key = k();
  for (let i = 0; i <= LOGIN_FREE_ATTEMPTS; i++) recordFailedAttempt(key);
  // Molto dopo qualunque cooldown, ma ancora entro la finestra di memoria.
  const st = loginLockState(key, Date.now() + LOGIN_MAX_COOLDOWN_MS + 1000);
  assert.equal(st.locked, false, "trascorso il cooldown si può riprovare");
  assert.equal(st.retryAfterSec, 0);
});

test("backoff login: oltre LOGIN_WINDOW_MS la storia dei fallimenti si azzera", () => {
  const key = k();
  for (let i = 0; i < 10; i++) recordFailedAttempt(key);
  const st = loginLockState(key, Date.now() + LOGIN_WINDOW_MS + 1000);
  assert.equal(st.fails, 0, "oltre la finestra i fallimenti non contano più");
  assert.equal(st.locked, false);
});

test("backoff login: un login riuscito (clearRateLimit) sblocca subito", () => {
  const key = k();
  for (let i = 0; i < 10; i++) recordFailedAttempt(key);
  assert.equal(loginLockState(key).locked, true);
  clearRateLimit(key);
  assert.equal(loginLockState(key).locked, false, "dopo il successo niente blocco");
});
