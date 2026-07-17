import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isRateLimited,
  clearRateLimit,
  recordFailedAttempt,
  checkRateLimit,
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
