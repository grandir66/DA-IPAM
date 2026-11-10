/**
 * Il giro «Servizi di rete» all'avvio parte solo se l'ultimo è vecchio (10/11/2026): un riavvio
 * non è un motivo per riprovare tutti gli host. Quel giorno una ventina di riavvii hanno rifatto
 * ogni volta le prove senza credenziali sui DC, che la sera hanno smesso di rispondere all'hub.
 * Run: node --import tsx --test src/lib/servizi-rete/__tests__/giro-all-avvio.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { giroDovuto, INTERVALLO_GIRO_MS } from "../job";

const ADESSO = Date.parse("2026-11-10T20:00:00Z");

test("mai fatto, o data illeggibile: il giro è dovuto", () => {
  assert.equal(giroDovuto(null, ADESSO), true);
  assert.equal(giroDovuto("", ADESSO), true);
  assert.equal(giroDovuto("non una data", ADESSO), true);
});

test("ultimo giro recente: un riavvio non lo rifà", () => {
  assert.equal(giroDovuto("2026-11-10T19:17:00Z", ADESSO), false);
  // la forma di SQLite, in UTC
  assert.equal(giroDovuto("2026-11-10 19:17:00", ADESSO), false);
});

test("ultimo giro più vecchio dell'intervallo: si rifà", () => {
  assert.equal(giroDovuto(new Date(ADESSO - INTERVALLO_GIRO_MS).toISOString(), ADESSO), true);
  assert.equal(giroDovuto("2026-11-10 13:00:00", ADESSO), true);
});
