// Gli apparati appena aggiunti restano visibili, con lo stato provvisorio detto, fino alla lettura che li contiene.
process.env.ENCRYPTION_KEY ||= "chiave-di-prova-del-pannello-zabbix";
import { test } from "node:test";
import assert from "node:assert/strict";
import { HostDelCentro, OggettoDiFamiglia } from "../api";
import { elencoApparati, piuVecchioDelCentro, type ApparatoElenco } from "../apparati";
import { TESTO_PROVVISORIO, conProvvisori } from "../provvisori";

const host = (hostid: string, nome: string, ip: string) =>
  HostDelCentro.parse({ hostid, nome, host: nome, ip: [ip], disponibilita: { complessiva: "si", interfacce: [] }, dati_affidabili: true });
const ogg = (hostid: string, nome: string) =>
  OggettoDiFamiglia.parse({ hostid, nome, famiglia: "switch", disponibilita: "si", dati_affidabili: true, ping: "si", misure_configurate: 1, misure_vive: 1, misure: [] });

const IPAM = [{ id: 9, ip: "192.0.2.9", nome: "sw-nuovo", classificazione: "switch", altri: null }];
const prima = elencoApparati({ host: [], famiglie: [], problemi: [], vecchio: false, ipam: IPAM });
const riga = prima[0] as ApparatoElenco;

test("dopo l'aggiunta la riga che sparisce dalla lettura si rimette com'era, col segno provvisorio", () => {
  const p = new Map([[riga.chiave, riga]]);
  // Il centro non ha ancora né l'host né la riga: la lettura è vuota.
  const vuota = conProvvisori([], p);
  assert.equal(vuota.elenco.length, 1);
  assert.equal(vuota.elenco[0]?.provvisorio, TESTO_PROVVISORIO);
  assert.equal(vuota.elenco[0]?.nome, "sw-nuovo");
  assert.deepEqual(vuota.superati, []);
  // Ancora «da aggiungere» nella lettura: una riga sola, col segno.
  const ancora = conProvvisori(prima, p);
  assert.equal(ancora.elenco.length, 1);
  assert.equal(ancora.elenco[0]?.provvisorio, TESTO_PROVVISORIO);
});

test("la lettura che contiene l'apparato chiude il provvisorio, senza doppioni", () => {
  const letti = elencoApparati({ host: [host("5", "sw-nuovo", "192.0.2.9")], famiglie: [ogg("5", "sw-nuovo")], problemi: [], vecchio: false, ipam: IPAM });
  const r = conProvvisori(letti, new Map([[riga.chiave, riga]]));
  assert.deepEqual(r.superati, [riga.chiave]);
  assert.deepEqual(r.elenco.map((a) => [a.chiave, a.provvisorio]), [["z:5", undefined]]);
});

test("l'abbinamento per nome prova hostname e nome personale, come fa il centro prima di aggiungere", () => {
  // In DA-IPAM il nome mostrato è il personale; in Zabbix l'host si chiama come l'hostname: il centro lo riconosce.
  const riga = { id: 3, ip: "192.0.2.30", nome: "Ufficio 2", hostname: "SRV-FILE", nomePersonale: "Ufficio 2", classificazione: "server_linux", altri: null };
  const e = elencoApparati({ host: [host("7", "srv-file", "192.0.2.77")], famiglie: [ogg("7", "srv-file")], problemi: [], vecchio: false, ipam: [riga] });
  assert.deepEqual(e.map((a) => a.chiave), ["z:7"]);
  // Senza il nome grezzo l'apparato restava «da aggiungere» (il difetto del 26/11).
  const senza = elencoApparati({ host: [host("7", "srv-file", "192.0.2.77")], famiglie: [ogg("7", "srv-file")], problemi: [], vecchio: false, ipam: [{ ...riga, hostname: null, nomePersonale: null }] });
  assert.deepEqual(senza.map((a) => a.chiave), ["z:7", "i:3"]);
});

test("versione dell'agente e segni nuovi: i campi assenti non fanno niente", () => {
  assert.equal(piuVecchioDelCentro("6.4.12", "7.0"), true);
  assert.equal(piuVecchioDelCentro("7.0.4", "7.0.9"), false);
  assert.equal(piuVecchioDelCentro("7.0.4", "7.2.1"), true);
  assert.equal(piuVecchioDelCentro("7.0.4", null), false);
  assert.equal(piuVecchioDelCentro(null, "7.0"), false);
  assert.equal(piuVecchioDelCentro("strano", "7.0"), false);
  // Un centro non aggiornato non manda i campi: nessun segno, nessuna versione.
  const vecchio = OggettoDiFamiglia.parse({ hostid: "1", nome: "x", famiglia: "altro" });
  assert.equal(vecchio.famiglia_forzata, false);
  assert.equal(vecchio.agente_versione, null);
  const nuovo = OggettoDiFamiglia.parse({ hostid: "1", nome: "x", famiglia_forzata: true, agente_versione: "7.0.4" });
  assert.equal(nuovo.famiglia_forzata, true);
  assert.equal(nuovo.agente_versione, "7.0.4");
  const e = elencoApparati({ host: [host("1", "x", "192.0.2.1")], famiglie: [nuovo], problemi: [], vecchio: false, ipam: [{ id: 1, ip: "192.0.2.1", nome: "Altro nome", classificazione: null, altri: null }] });
  // Il centro dice «forzata» anche per il tag messo da DA-IPAM all'aggiunta: stessa famiglia della classificazione = non è «a mano».
  assert.deepEqual([e[0]?.famigliaForzata, e[0]?.agenteVersione, e[0]?.nomeIpam], [false, "7.0.4", "Altro nome"]);
  const diversa = elencoApparati({ host: [host("1", "x", "192.0.2.1")], famiglie: [{ ...nuovo, famiglia: "wifi" }], problemi: [], vecchio: false, ipam: [{ id: 1, ip: "192.0.2.1", nome: "Altro nome", classificazione: null, altri: null }] });
  assert.equal(diversa[0]?.famigliaForzata, true);
});
