/**
 * DATIA MONITORING (13/11/2026): dalla lettura del centro alla pagina del cliente.
 * I dati finti hanno la forma della rotta `famiglie` di DA-Zabbix, coi casi veri visti
 * quel giorno su DTS e Domarc (oggetto col solo ping, oggetto configurato senza dati).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { RispostaFamiglie, RispostaStorico, type ProblemaDelCentro } from "@/lib/zabbix-lettura/api";
import { componiMonitoring, fraseProblema, statoOggetto, testoMisura } from "../monitoring";

const TESTA = { codcli: "12345", cliente: "Esempio", letto_alle: "2026-11-13T09:40:00Z", eta_s: 20, vecchio: false };

function oggetto(hostid: string, nome: string, famiglia: string, extra: Record<string, unknown> = {}) {
  return { hostid, nome, famiglia, disponibilita: "si", dati_affidabili: true, ping: "si", misure_configurate: 5, misure_vive: 5, misure: [], ...extra };
}

function famiglie(host: unknown[], extra: Record<string, unknown> = {}) {
  return RispostaFamiglie.parse({
    ...TESTA,
    famiglie: [
      { codice: "rete", etichetta: "Apparati di rete" },
      { codice: "windows", etichetta: "Windows" },
      { codice: "storage", etichetta: "Storage e NAS" },
      { codice: "altro", etichetta: "Altro" },
    ],
    host,
    tronca: false,
    ...extra,
  });
}

function problema(hostid: string, nome: string, gravita: number, preso = false): ProblemaDelCentro {
  return { eventid: `e${hostid}${gravita}${nome.length}`, hostid, nome, gravita, dal: "2026-11-13T08:00:00Z", preso_in_carico: preso };
}

const BASE = { problemiTroncati: 0, storico: null, etaS: 20, vecchio: false, lettoAlle: TESTA.letto_alle };

test("tutto funziona: la frase lo dice e nessuna famiglia vuota compare", () => {
  const m = componiMonitoring({ ...BASE, famiglie: famiglie([oggetto("1", "sw-1", "rete"), oggetto("2", "srv-1", "windows")]), problemi: [] });
  assert.equal(m.stato, "funziona");
  assert.equal(m.frase, "Tutto funziona: 2 apparati sotto controllo");
  assert.deepEqual(m.famiglie.map((f) => f.codice), ["rete", "windows"]);
  assert.deepEqual(m.totali, { funziona: 2, attenzione: 0, fermo: 0, non_so: 0 });
});

test("fermo è chi non risponde; un problema dalla Media in su è attenzione; sotto non si vede", () => {
  const m = componiMonitoring({
    ...BASE,
    famiglie: famiglie([
      oggetto("1", "sw-1", "rete", { ping: "no" }),
      oggetto("2", "srv-1", "windows"),
      oggetto("3", "srv-2", "windows"),
      oggetto("4", "nas-1", "storage"),
    ]),
    problemi: [
      problema("1", "Unavailable by ICMP ping", 4, true),
      problema("2", "FS [(D:)]: Space is critically low (used > 90%)", 3),
      problema("3", "Interface eth0: Ethernet has changed to lower speed", 2),
    ],
  });
  assert.equal(m.stato, "fermo");
  assert.equal(m.frase, "1 apparato fermo, 1 da tenere d'occhio");
  assert.equal(m.sottofrase, "Gli altri: 2 funzionano");
  const stati = Object.fromEntries(m.famiglie.flatMap((f) => f.oggetti.map((o) => [o.nome, o.stato])));
  assert.deepEqual(stati, { "sw-1": "fermo", "srv-1": "attenzione", "srv-2": "funziona", "nas-1": "funziona" });
  // La famiglia prende lo stato peggiore, e i peggiori stanno in cima all'elenco.
  assert.equal(m.famiglie.find((f) => f.codice === "windows")?.stato, "attenzione");
  assert.equal(m.famiglie.find((f) => f.codice === "windows")?.oggetti[0]?.nome, "srv-1");
  assert.deepEqual(m.problemi.map((p) => [p.nomeOggetto, p.grave, p.presoInCarico, p.frase]), [
    ["sw-1", true, true, "non risponde"],
    ["srv-1", false, false, "spazio quasi finito su D"],
  ]);
  assert.equal(m.problemiNascosti, 1);
});

test("non so è uno stato a sé: lettura vecchia, proxy fermo, nessun segno di vita", () => {
  const vecchia = componiMonitoring({ ...BASE, vecchio: true, famiglie: famiglie([oggetto("1", "sw-1", "rete")]), problemi: [] });
  assert.equal(vecchia.stato, "non_so");
  assert.equal(vecchia.famiglie[0]?.oggetti[0]?.stato, "non_so");
  assert.match(vecchia.frase, /^Non so/);

  const m = componiMonitoring({
    ...BASE,
    famiglie: famiglie([
      oggetto("1", "sw-sede", "rete", { dati_affidabili: false }),
      oggetto("2", "solo-ping", "altro", { disponibilita: "non_so", ping: "si", misure_configurate: 0, misure_vive: 0 }),
      oggetto("3", "muto", "altro", { disponibilita: "non_so", ping: "non_so", misure_configurate: 0, misure_vive: 0 }),
    ]),
    problemi: [],
  });
  const stati = Object.fromEntries(m.famiglie.flatMap((f) => f.oggetti.map((o) => [o.nome, o.stato])));
  assert.deepEqual(stati, { "sw-sede": "non_so", "solo-ping": "funziona", muto: "non_so" });
  assert.equal(m.frase, "1 apparato funziona, di 2 non so");
  // Un «sì» dietro un proxy fermo non diventa mai un «funziona».
  assert.equal(statoOggetto(famiglie([oggetto("9", "x", "rete", { dati_affidabili: false, ping: "si" })]).host[0]!, [], false).stato, "non_so");
});

test("configurato senza dati: risponde ma non manda le misure, e si dice", () => {
  const f = famiglie([oggetto("1", "sql-1", "windows", { misure_configurate: 235, misure_vive: 0 })]);
  assert.deepEqual(statoOggetto(f.host[0]!, [], false), { stato: "attenzione", motivo: "risponde, ma non manda le sue misure" });
});

test("sintesi della famiglia: somme per i conteggi, il peggiore per le percentuali", () => {
  const disco = (valore: number, dettaglio: string) => ({ codice: "disco", etichetta: "Disco più pieno", valore, unita: "%", dettaglio, quanti: 2, vecchio: false });
  const servizi = (valore: number, totale: number) => ({ codice: "servizi_fermi", etichetta: "Servizi fermi", valore, totale, unita: "", vecchio: false });
  const m = componiMonitoring({
    ...BASE,
    famiglie: famiglie([
      oggetto("1", "a", "windows", { misure: [disco(41.5, "C:"), servizi(0, 60), { codice: "cpu", etichetta: "CPU", valore: 12.3, unita: "%", vecchio: false }] }),
      oggetto("2", "b", "windows", { misure: [disco(93.7, "D:"), servizi(3, 85)] }),
    ]),
    problemi: [],
  });
  assert.deepEqual(m.famiglie[0]?.sintesi, [
    { etichetta: "Disco più pieno", valore: "93,7% (D:)" },
    { etichetta: "Servizi fermi", valore: "3 di 145" },
  ]);
  assert.equal(testoMisura({ codice: "porte", etichetta: "Porte attive", valore: 3, totale: 4, unita: "", vecchio: false }), "3 di 4");
  assert.equal(testoMisura({ codice: "temperatura", etichetta: "Disco più caldo", valore: 38, unita: "°C", vecchio: false }), "38 °C");
});

test("storico: minuti di fermo per giorno e percentuale senza fermi", () => {
  const giorni = Array.from({ length: 30 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
  const fermo = giorni.map(() => 0);
  fermo[29] = 432; // un giorno su trenta, 30% del giorno: 1% del mese
  const storico = RispostaStorico.parse({ ...TESTA, giorni, famiglie: {}, minuti: {}, minuti_fermo: { rete: fermo }, tronca: false });
  const m = componiMonitoring({ ...BASE, storico, famiglie: famiglie([oggetto("1", "sw-1", "rete"), oggetto("2", "srv", "windows")]), problemi: [] });
  assert.equal(m.famiglie[0]?.disponibilita30, 99);
  assert.equal(m.famiglie[0]?.fermoPerGiorno?.[29], 432);
  // Una famiglia senza fermi ha 30 zeri e il 100%, non un vuoto.
  assert.equal(m.famiglie[1]?.disponibilita30, 100);
  assert.equal(m.famiglie[1]?.fermoPerGiorno?.length, 30);
  assert.equal(componiMonitoring({ ...BASE, famiglie: famiglie([oggetto("1", "sw-1", "rete")]), problemi: [] }).famiglie[0]?.disponibilita30, null);
});

test("frasi dei problemi: quelle note in italiano, le altre restano com'erano", () => {
  assert.equal(fraseProblema("Interface ether3(Uplink): Link down"), "una porta di rete è scollegata (ether3)");
  assert.equal(fraseProblema('Service "Spooler" (Print Spooler) is not running'), "il servizio «Spooler» è fermo");
  assert.equal(fraseProblema("Zabbix agent is not available (for 3m)"), "l'agente di controllo non manda dati");
  assert.equal(fraseProblema("High memory utilization (>90% for 5m)"), "poca memoria libera");
  assert.equal(fraseProblema("  Qualcosa   di mai visto  "), "Qualcosa di mai visto");
  assert.equal(fraseProblema(""), "problema segnalato");
});

test("una famiglia che il centro non elenca finisce in Altro, non sparisce", () => {
  const m = componiMonitoring({ ...BASE, famiglie: famiglie([oggetto("1", "x", "famiglia-nuova")]), problemi: [] });
  assert.deepEqual(m.famiglie.map((f) => [f.codice, f.oggetti.length]), [["altro", 1]]);
});
