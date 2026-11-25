import { test } from "node:test";
import assert from "node:assert/strict";
import { erroriElencoUtente, puoEntrareDa } from "../indirizzi-utente";

test("senza elenco si entra da ovunque, anche con l'indirizzo non letto: chi non usa la funzione non cambia", () => {
  assert.equal(puoEntrareDa([], "203.0.113.9"), true);
  assert.equal(puoEntrareDa([], null), true);
});

test("con un elenco entra solo chi è dentro, NetBird sempre, e un indirizzo non letto mai", () => {
  const elenco = ["192.0.2.0/24", "198.51.100.14", "2001:db8::7"];
  assert.equal(puoEntrareDa(elenco, "192.0.2.31"), true);
  assert.equal(puoEntrareDa(elenco, "198.51.100.14"), true);
  assert.equal(puoEntrareDa(elenco, "2001:db8::7"), true);
  assert.equal(puoEntrareDa(elenco, "100.107.33.131"), true, "NetBird/DA-Link è la via dei tecnici");
  assert.equal(puoEntrareDa(elenco, "198.51.100.15"), false);
  assert.equal(puoEntrareDa(elenco, "203.0.113.9"), false);
  assert.equal(puoEntrareDa(elenco, "2001:db8::8"), false);
  assert.equal(puoEntrareDa(elenco, null), false, "senza indirizzo non si può dire che è ammesso");
  assert.equal(puoEntrareDa(elenco, ""), false);
});

test("un elenco con voci che non sono indirizzi non si salva", () => {
  assert.deepEqual(erroriElencoUtente(["192.0.2.1", "192.0.2.0/24"]), []);
  assert.equal(erroriElencoUtente(["0.0.0.0/0"]).length, 1);
  assert.equal(erroriElencoUtente(["tutti"]).length, 1);
  assert.equal(erroriElencoUtente(["192.0.2.1", "192.0.2.1"]).length, 1);
  assert.equal(erroriElencoUtente(Array.from({ length: 40 }, (_, i) => `192.0.2.${i + 1}`)).length, 1);
});
