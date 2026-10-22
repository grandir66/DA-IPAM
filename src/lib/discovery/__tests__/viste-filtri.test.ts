/**
 * Discovery più leggibile (analisi del 19/10, F09, approvato da Riccardo): viste per
 * attività, sigle spiegate, filtri rapidi in italiano con le categorie a zero da
 * parte. L'ordine delle 19 colonne di default è una decisione di Riccardo (v0.2.500):
 * «Tutte» è la configurazione di ognuno, le viste la filtrano senza toccarla.
 *
 * Run: node --import tsx --test src/lib/discovery/__tests__/viste-filtri.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { colonneDellaVista, contaPreset, etichettaPreset, GLOSSARIO, prendePreset, VISTE } from "../viste-filtri";

test("«Tutte» è l'ordine dell'utente; una vista dà le sue colonne, con Profilo sempre in testa", () => {
  const mio = ["profilo", "hostname", "ip", "mac"];
  assert.deepEqual(colonneDellaVista("tutte", mio), mio);
  for (const v of Object.keys(VISTE) as (keyof typeof VISTE)[]) {
    const c = colonneDellaVista(v, mio);
    assert.equal(c[0], "profilo", v);
    assert.ok(c.includes("ip") && c.includes("hostname"), v);
  }
  assert.ok(colonneDellaVista("sicurezza", mio).includes("vuln_counts"));
});

test("ogni sigla mostrata di default ha la sua spiegazione", () => {
  for (const id of ["validated_creds", "fp_confidence", "known_host", "ip_assignment", "in_ad", "vuln_max_severity", "vuln_counts", "multihomed"]) {
    assert.ok(GLOSSARIO[id]?.length > 10, id);
  }
});

test("etichette in italiano per i filtri di serie, anche se salvati prima; quelli dell'utente restano come sono", () => {
  assert.equal(etichettaPreset({ filter: "group:print", label: "PRINT", builtin: true }), "Stampanti");
  assert.equal(etichettaPreset({ filter: "group:mobile", label: "MOBILE", builtin: true }), "Smartphone e tablet");
  assert.equal(etichettaPreset({ filter: "group:x", label: "Mio", builtin: false }), "Mio");
});

test("conteggi: MH e Altro contano con la loro regola, non sempre zero", () => {
  const presets = [
    { filter: "group:server", match: ["server"] },
    { filter: "group:multihomed", match: [] },
    { filter: "group:other", match: [] },
  ];
  const hosts = [
    { classification: "server", multihomed: null },
    { classification: "server", multihomed: { peers: [] } },
    { classification: "frigorifero", multihomed: null },
    { classification: null, multihomed: null },
  ];
  assert.equal(contaPreset(presets[0], hosts, presets), 2);
  assert.equal(contaPreset(presets[1], hosts, presets), 1);
  assert.equal(contaPreset(presets[2], hosts, presets), 2);
});

// Revisione del 19/10: un preset di serie rinominato dall'utente teneva la traduzione
// al posto del suo nome; un preset personale (`user:<slug>`) contava le righe ma la
// tabella le scartava tutte (confrontava la classificazione con «user:…»).
test("un preset di serie rinominato dall'utente mostra il nome dell'utente", () => {
  assert.equal(etichettaPreset({ filter: "group:net", label: "Rete mia", builtin: true }), "Rete mia");
  assert.equal(etichettaPreset({ filter: "group:net", label: "NET", builtin: true }), "Altri apparati di rete");
});

test("un preset personale prende le righe della sua lista, nel conteggio e nel filtro", () => {
  const presets = [{ filter: "user:abc", match: ["nas", "storage"] }, { filter: "group:other", match: [] }];
  const h = { classification: "nas", multihomed: null };
  assert.equal(prendePreset(presets[0], h, presets), true);
  assert.equal(prendePreset(presets[0], { classification: "server", multihomed: null }, presets), false);
  assert.equal(contaPreset(presets[0], [h], presets), 1);
});
