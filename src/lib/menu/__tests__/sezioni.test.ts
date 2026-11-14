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
  const tutte = SEZIONI.flatMap((s) => s.schede.map((x) => `${x.href}#${x.ancora ?? ""}?${x.tab ?? ""}`));
  assert.equal(new Set(tutte).size, tutte.length);
  assert.equal(sezioneDelPercorso("/discoveryx"), null);
});

test("le tre parti passive stanno nella fila in alto e si scelgono con l'àncora", () => {
  assert.equal(sezioneDelPercorso("/arp-table/trunk")?.scheda.etichetta, "Passiva · Sicurezza");
  assert.equal(sezioneDelPercorso("/arp-table/trunk", "reti")?.scheda.etichetta, "Passiva · VLAN e apparati");
  assert.equal(sezioneDelPercorso("/arp-table/trunk", "annunci")?.scheda.etichetta, "Passiva · Annunci");
  assert.equal(sezioneDelPercorso("/arp-table/trunk", "boh")?.scheda.etichetta, "Passiva · Sicurezza");
  assert.equal(voceAccesaDallaSezione("/arp-table/trunk", "/servizi-rete"), true);
});

test("Impostazioni: una fila sola, le fondamentali in testa, Opzioni e Schedulazioni dentro", () => {
  const imp = SEZIONI.find((s) => s.nome === "Impostazioni");
  assert.deepEqual(imp?.schede.slice(0, 6).map((x) => x.etichetta), ["Utenti", "Aggiornamenti", "Moduli", "Istanza", "Opzioni", "Schedulazioni"]);
  assert.equal(sezioneDelPercorso("/settings", null, "moduli")?.scheda.etichetta, "Moduli");
  assert.equal(sezioneDelPercorso("/settings")?.scheda.etichetta, "Utenti");
  assert.equal(sezioneDelPercorso("/settings/opzioni")?.scheda.etichetta, "Opzioni");
  assert.equal(sezioneDelPercorso("/settings/schedulazioni", null, "moduli")?.scheda.etichetta, "Schedulazioni");
  // Le pagine sotto Impostazioni senza una scheda loro (MDM, Vault, un modulo) tengono la fila, senza cambiare scheda.
  assert.equal(sezioneDelPercorso("/settings/mdm")?.sezione.nome, "Impostazioni");
  assert.equal(voceAccesaDallaSezione("/settings/cosa-esce", "/settings"), true);
});

test("Impostazioni: le secondarie stanno sotto «Avanzate», che si accende quando ne è aperta una", () => {
  const imp = SEZIONI.find((s) => s.nome === "Impostazioni");
  assert.deepEqual(imp?.schede.map((x) => x.etichetta), ["Utenti", "Aggiornamenti", "Moduli", "Istanza", "Opzioni", "Schedulazioni", "Avanzate"]);
  const sistema = sezioneDelPercorso("/settings", null, "sistema");
  assert.equal(sistema?.scheda.etichetta, "Avanzate");
  assert.equal(sistema?.figlia?.etichetta, "Sistema");
  assert.equal(sezioneDelPercorso("/settings/cosa-esce")?.figlia?.etichetta, "Cosa esce");
  assert.equal(sezioneDelPercorso("/settings", null, "moduli")?.figlia, undefined);
});
