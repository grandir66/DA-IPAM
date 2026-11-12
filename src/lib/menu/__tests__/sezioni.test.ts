// Sezioni del menu: l'indirizzo più lungo vince, e nel menu si accende la prima pagina della sezione.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SEZIONI, sezioneDelPercorso, voceAccesaDallaSezione } from "../sezioni";

test("«Reti dal trunk» è della sezione Rete, «Tabella ARP» di Topologia", () => {
  assert.equal(sezioneDelPercorso("/arp-table/trunk")?.sezione.nome, "Rete");
  assert.equal(sezioneDelPercorso("/arp-table")?.sezione.nome, "Topologia");
  assert.equal(sezioneDelPercorso("/arp-table")?.scheda.etichetta, "Tabella ARP");
});

test("«Sorgenti» e «VA dall'Edge» non si confondono con la pagina che le contiene", () => {
  assert.equal(sezioneDelPercorso("/dhcp/sources")?.scheda.etichetta, "Sorgenti");
  assert.equal(sezioneDelPercorso("/vulnerabilities/scansioni")?.sezione.nome, "Scansioni");
  assert.equal(sezioneDelPercorso("/vulnerabilities"), null);
});

test("nel menu si accende la prima pagina della sezione, non le altre voci", () => {
  assert.equal(voceAccesaDallaSezione("/arp-table", "/topology"), true);
  assert.equal(voceAccesaDallaSezione("/controllo-classificazione", "/discovery"), true);
  assert.equal(voceAccesaDallaSezione("/vulnerabilities/scansioni", "/vulnerabilities"), false);
  assert.equal(voceAccesaDallaSezione("/vulnerabilities/scansioni", "/scans"), true);
  assert.equal(voceAccesaDallaSezione("/networks/3", "/networks"), null);
});

test("un indirizzo sta in una sezione sola e nessuna scheda è doppia", () => {
  const tutte = SEZIONI.flatMap((s) => s.schede.map((x) => x.href));
  assert.equal(new Set(tutte).size, tutte.length);
  assert.equal(sezioneDelPercorso("/discoveryx"), null);
});
