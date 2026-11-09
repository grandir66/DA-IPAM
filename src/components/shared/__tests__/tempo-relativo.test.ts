import { test } from "node:test";
import assert from "node:assert/strict";
import { testoRelativo } from "@/components/shared/console";

const ora = new Date("2026-11-09T22:00:00Z");
const fa = (ms: number) => new Date(ora.getTime() - ms);

test("tempo relativo: adesso, minuti, ore, giorni, poi data", () => {
  assert.equal(testoRelativo(fa(10_000), ora), "adesso");
  assert.equal(testoRelativo(fa(5 * 60_000), ora), "5 min fa");
  assert.equal(testoRelativo(fa(60 * 60_000), ora), "1 ora fa");
  assert.equal(testoRelativo(fa(3 * 3600_000), ora), "3 ore fa");
  assert.equal(testoRelativo(fa(2 * 86400_000), ora), "2 giorni fa");
  assert.equal(testoRelativo(fa(1 * 86400_000), ora), "1 giorno fa");
  // oltre una settimana: la data, non «N giorni fa»
  assert.match(testoRelativo(fa(40 * 86400_000), ora), /\d{2}\/\d{2}\/\d{4}/);
});

test("una data nel futuro non dà numeri negativi", () => {
  assert.match(testoRelativo(new Date(ora.getTime() + 3600_000), ora), /\d{2}\/\d{2}/);
});
