/**
 * Filtri dal tasto destro e filtro «dati acquisiti» della Discovery (Riccardo, 29/10).
 *
 * Run: node --import tsx --test src/lib/discovery/__tests__/filtri-valore.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggiungiFiltroValore, colonnaFiltrabile, passaFiltriValore, passaFiltroAcquisizione,
  togliFiltroValore, valoreLeggibile, type FiltroValore,
} from "../filtri-valore";

const riga: Record<string, string> = { classification: "server", hostname: "", vendor: "Dell Inc." };
const testo = (c: string) => riga[c] ?? "";

test("«mostra solo» tiene le righe con quel valore, «escludi» le toglie", () => {
  assert.equal(passaFiltriValore([{ colonna: "classification", valore: "server", escludi: false }], testo), true);
  assert.equal(passaFiltriValore([{ colonna: "classification", valore: "switch", escludi: false }], testo), false);
  assert.equal(passaFiltriValore([{ colonna: "classification", valore: "server", escludi: true }], testo), false);
  assert.equal(passaFiltriValore([{ colonna: "classification", valore: "switch", escludi: true }], testo), true);
});

test("più filtri valgono tutti insieme; nessun filtro lascia passare tutto", () => {
  assert.equal(passaFiltriValore([], testo), true);
  const f: FiltroValore[] = [
    { colonna: "classification", valore: "server", escludi: false },
    { colonna: "vendor", valore: "Dell Inc.", escludi: true },
  ];
  assert.equal(passaFiltriValore(f, testo), false);
});

test("il valore vuoto si filtra come gli altri (righe senza nome)", () => {
  assert.equal(passaFiltriValore([{ colonna: "hostname", valore: "", escludi: false }], testo), true);
  assert.equal(valoreLeggibile(""), "(vuoto)");
  assert.equal(valoreLeggibile("—"), "(vuoto)");
  assert.equal(valoreLeggibile("a".repeat(60), 10), `${"a".repeat(9)}…`);
});

test("lo stesso filtro aggiunto due volte resta uno solo, con l'ultima scelta", () => {
  let f = aggiungiFiltroValore([], { colonna: "vendor", valore: "Dell Inc.", escludi: false });
  f = aggiungiFiltroValore(f, { colonna: "vendor", valore: "Dell Inc.", escludi: true });
  assert.deepEqual(f, [{ colonna: "vendor", valore: "Dell Inc.", escludi: true }]);
  assert.deepEqual(togliFiltroValore(f, 0), []);
});

test("«Profilo» non si filtra per valore", () => {
  assert.equal(colonnaFiltrabile("profilo"), false);
  assert.equal(colonnaFiltrabile("ip"), true);
});

test("filtro dati acquisiti: tutti, solo acquisiti, solo senza", () => {
  assert.equal(passaFiltroAcquisizione("", {}), true);
  assert.equal(passaFiltroAcquisizione("acquisiti", { device_acquired: true }), true);
  assert.equal(passaFiltroAcquisizione("acquisiti", { device_acquired: false }), false);
  assert.equal(passaFiltroAcquisizione("acquisiti", {}), false);
  assert.equal(passaFiltroAcquisizione("non_acquisiti", {}), true);
  assert.equal(passaFiltroAcquisizione("non_acquisiti", { device_acquired: true }), false);
});
