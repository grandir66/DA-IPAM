// Sezioni del menu: l'indirizzo più lungo vince, e nel menu si accende la prima pagina della sezione.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SEZIONI, nomeSezione, sezioneDelPercorso, voceAccesaDallaSezione } from "../sezioni";

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

test("Impostazioni e Config: due sezioni sulla stessa pagina, scelte dal tab", () => {
  const nomi = (n: string) => SEZIONI.find((s) => s.nome === n)?.schede.map((x) => x.etichetta);
  assert.deepEqual(nomi("Impostazioni"), ["Utenti", "Aggiornamenti", "Moduli", "Istanza", "Opzioni", "Schedulazioni", "Notifiche"]);
  assert.deepEqual(nomi("Config"), ["Scansione", "Identificazione", "Alert sicurezza", "HTTPS", "Sistema", "Cosa esce"]);
  assert.equal(nomeSezione("/settings"), "Impostazioni");
  assert.equal(sezioneDelPercorso("/settings")?.scheda.etichetta, "Utenti");
  assert.equal(nomeSezione("/settings", "moduli"), "Impostazioni");
  assert.equal(nomeSezione("/settings", "sistema"), "Config");
  assert.equal(sezioneDelPercorso("/settings", null, "sistema")?.scheda.etichetta, "Sistema");
  assert.equal(nomeSezione("/settings/opzioni", "sistema"), "Impostazioni");
  assert.equal(nomeSezione("/settings/cosa-esce"), "Config");
  // Solo gli amministratori vedono Config: ogni sua scheda è riservata.
  assert.ok(SEZIONI.find((s) => s.nome === "Config")?.schede.every((x) => x.per === "admin"));
});

test("le pagine sotto Impostazioni senza una scheda loro accendono quella da cui ci si arriva", () => {
  assert.equal(sezioneDelPercorso("/settings/mdm")?.scheda.etichetta, "Moduli");
  assert.equal(sezioneDelPercorso("/settings/moduli/wazuh", null, "sistema")?.scheda.etichetta, "Moduli");
  assert.equal(sezioneDelPercorso("/settings/snmp-profiles")?.scheda.etichetta, "Identificazione");
  assert.equal(sezioneDelPercorso("/settings/vault")?.sezione.nome, "Config");
  assert.equal(sezioneDelPercorso("/settings/updates")?.sezione.nome, "Impostazioni");
});
