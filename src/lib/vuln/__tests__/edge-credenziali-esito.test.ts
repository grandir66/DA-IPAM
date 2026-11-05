/**
 * Le credenziali si rimandano alla sonda solo se serve: farlo accende Greenbone (72729, 05/11/2026).
 *
 * Run: node --import tsx --test src/lib/vuln/__tests__/edge-credenziali-esito.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { serveRimandare, type EdgeCredenzialiSonda } from "@/lib/vuln/edge-credenziali-esito";

const ADESSO = Date.parse("2026-11-06T12:00:00Z");
const vuota = (esito_il: string | null): EdgeCredenzialiSonda => ({ ssh: null, smb: null, snmp: null, esito_il, falliti: [] });

test("sonda vecchia: mai, cancellerebbe i legami", () => {
  assert.equal(serveRimandare(["snmp"], { ssh: null, smb: null, snmp: null }, ADESSO), false);
  assert.equal(serveRimandare(["snmp"], undefined, ADESSO), false);
});

test("legame mancante e nessun tentativo: si manda", () => {
  assert.equal(serveRimandare(["snmp"], vuota(null), ADESSO), true);
});

test("legame presente: niente", () => {
  const sonda = { ...vuota(null), snmp: { id: "a", name: "x" } };
  assert.equal(serveRimandare(["snmp"], sonda, ADESSO), false);
});

test("tentativo di meno di un giorno fa: si aspetta", () => {
  assert.equal(serveRimandare(["snmp"], vuota("2026-11-06 01:00:00"), ADESSO), false);
});

test("tentativo di più di un giorno fa: si riprova", () => {
  assert.equal(serveRimandare(["snmp"], vuota("2026-11-05 11:00:00"), ADESSO), true);
});

test("data illeggibile: non si accende niente", () => {
  assert.equal(serveRimandare(["snmp"], vuota("ieri"), ADESSO), false);
});

test("lo slot AD non conta: non sta in Greenbone", () => {
  assert.equal(serveRimandare(["ad"], vuota(null), ADESSO), false);
});
