import { test } from "node:test";
import assert from "node:assert/strict";
import { quandoUsato } from "../accesso-emergenza";

// `last_login` esce da SQLite in UTC senza fuso: letto come ora locale sbaglierebbe di una o due ore.
test("quandoUsato: la data di SQLite è UTC, non ora locale", () => {
  const atteso = new Date("2026-11-14T20:30:00Z").toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
  assert.equal(quandoUsato("2026-11-14 20:30:00"), atteso);
  assert.equal(quandoUsato("2026-11-14T20:30:00Z"), atteso);
});

test("quandoUsato: niente data, niente testo; una data illeggibile resta com'è", () => {
  assert.equal(quandoUsato(null), "");
  assert.equal(quandoUsato("boh"), "boh");
});
