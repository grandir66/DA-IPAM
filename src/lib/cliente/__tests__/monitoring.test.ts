/**
 * DATIA MONITORING (13/11/2026): dalla lettura del centro alla pagina del cliente.
 * I dati finti hanno la forma della rotta `famiglie` di DA-Zabbix, coi casi veri visti
 * quel giorno su DTS e Domarc (oggetto col solo ping, oggetto configurato senza dati).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { RispostaFamiglie, RispostaStorico, type ProblemaDelCentro } from "@/lib/zabbix-lettura/api";
import { componiMonitoring, fraseProblema, mediana, statoOggetto, testoMisura } from "../monitoring";

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
  // Casi veri di Domarc del 13/11 che prima uscivano in inglese o col nome del disco tagliato.
  assert.equal(
    fraseProblema("Network Generic Device: Interface 0/11(Port 11): Ethernet has changed to lower speed than it was before"),
    "una porta di rete va più lenta del solito (0/11)",
  );
  assert.equal(fraseProblema("FS [User Disk(C:)]: Space is critically low (used > 90%)"), "spazio quasi finito su C");
  assert.equal(fraseProblema("FS [GESTIONALE(E:)]: Space is low"), "spazio quasi finito su E");
  assert.equal(fraseProblema(""), "problema segnalato");
});

test("lo stesso problema ripetuto sull'oggetto si dice una volta, col conto", () => {
  // Su DA-PX05 (Domarc, 13/11) «has been restarted» usciva quattro volte, una per macchina.
  const m = componiMonitoring({
    ...BASE,
    famiglie: famiglie([oggetto("1", "px-05", "altro")]),
    problemi: [
      problema("1", "Host has been restarted (uptime < 10m)", 3, true),
      { ...problema("1", "Host has been restarted (uptime < 10m)", 3), dal: "2026-11-13T06:00:00Z" },
      problema("1", "Lack of available memory", 3),
    ],
  });
  assert.deepEqual(m.problemi.map((p) => [p.frase, p.quante, p.presoInCarico, p.dal]), [
    ["è stato riavviato", 2, false, "2026-11-13T06:00:00Z"],
    ["poca memoria libera", 1, false, "2026-11-13T08:00:00Z"],
  ]);
  assert.equal(m.problemiRaggruppati, 1);
});

test("una famiglia che il centro non elenca finisce in Altro, non sparisce", () => {
  const m = componiMonitoring({ ...BASE, famiglie: famiglie([oggetto("1", "x", "famiglia-nuova")]), problemi: [] });
  assert.deepEqual(m.famiglie.map((f) => [f.codice, f.oggetti.length]), [["altro", 1]]);
});

// ── 13/11/2026: apparati e famiglie nascosti, nomi per il cliente, KPI ──

function storicoLungo(perHost: Record<string, Partial<Record<"fermo" | "minuti" | "aperti" | "gravi" | "chiusi" | "durata_chiusi", number[]>> & { chiusure?: Array<[number, number]> }>) {
  const giorni_lunghi = Array.from({ length: 60 }, (_, i) => `2026-${String(9 + Math.floor(i / 30)).padStart(2, "0")}-${String((i % 30) + 1).padStart(2, "0")}`);
  const zero = () => Array.from({ length: 60 }, () => 0);
  const per_host = Object.fromEntries(
    Object.entries(perHost).map(([h, v]) => [h, { fermo: zero(), minuti: zero(), aperti: zero(), gravi: zero(), chiusi: zero(), durata_chiusi: zero(), ...v }]),
  );
  return RispostaStorico.parse({ ...TESTA, giorni: giorni_lunghi.slice(30), famiglie: {}, minuti: {}, minuti_fermo: {}, giorni_lunghi, per_host, tronca: false });
}
const ad = (giorno: number, valore: number) => Array.from({ length: 60 }, (_, i) => (i === giorno ? valore : 0));

test("un apparato nascosto sparisce del tutto: elenco, conti, frase, problemi, KPI", () => {
  const impostazioni = { famiglieNascoste: new Set<string>(), hostNascosti: new Set(["2"]), nomi: new Map([["1", "Router principale"]]) };
  const m = componiMonitoring({
    ...BASE,
    impostazioni,
    storico: storicoLungo({ "2": { aperti: ad(59, 9), fermo: ad(59, 600) } }),
    famiglie: famiglie([oggetto("1", "DA-RT-CORE", "rete"), oggetto("2", "srv-nascosto", "windows", { ping: "no" })]),
    problemi: [problema("2", "Unavailable by ICMP ping", 4)],
  });
  assert.deepEqual(m.famiglie.map((f) => f.oggetti.map((o) => o.nome)), [["Router principale"]]);
  assert.equal(m.frase, "Tutto funziona: 1 apparato sotto controllo");
  assert.deepEqual([m.problemi.length, m.problemiNascosti], [0, 0]);
  assert.deepEqual(m.kpi.incidenti, { corrente: 0, precedente: 0 });
  assert.equal(m.kpi.disponibilita?.corrente, 100);
  // Il pannello di gestione invece vede tutto, col nome di Zabbix e quello per il cliente.
  const tutti = m.gestione.flatMap((f) => f.oggetti);
  assert.deepEqual(tutti.map((o) => [o.hostid, o.nomeZabbix, o.nomeCliente, o.visibile]), [
    ["1", "DA-RT-CORE", "Router principale", true],
    ["2", "srv-nascosto", null, false],
  ]);
});

test("una famiglia nascosta toglie i suoi apparati, e resta nel pannello di gestione", () => {
  const impostazioni = { famiglieNascoste: new Set(["altro"]), hostNascosti: new Set<string>(), nomi: new Map<string, string>() };
  const m = componiMonitoring({ ...BASE, impostazioni, famiglie: famiglie([oggetto("1", "sw", "rete"), oggetto("9", "cam", "altro")]), problemi: [] });
  assert.deepEqual(m.famiglie.map((f) => f.codice), ["rete"]);
  assert.deepEqual(m.gestione.map((f) => [f.codice, f.visibile]), [["rete", true], ["altro", false]]);
});

test("KPI: mese contro mese prima, tempo medio di soluzione, settimane, spazio e scadenza", () => {
  const m = componiMonitoring({
    ...BASE,
    storico: storicoLungo({
      "1": { aperti: ad(45, 3), gravi: ad(45, 1), chiusi: ad(45, 2), durata_chiusi: ad(45, 200), fermo: ad(59, 1440) },
      "2": { aperti: ad(10, 5), chiusi: ad(10, 4), durata_chiusi: ad(10, 120) },
    }),
    famiglie: famiglie([
      oggetto("1", "srv-a", "windows", { misure: [{ codice: "disco", etichetta: "Disco più pieno", valore: 93.7, unita: "%", dettaglio: "C:", vecchio: false }] }),
      oggetto("2", "nas", "storage", { misure: [{ codice: "volume", etichetta: "Volume più pieno", valore: 61, unita: "%", dettaglio: "/volume1", vecchio: false }] }),
      oggetto("3", "cert", "altro", { misure: [{ codice: "scadenza", etichetta: "Giorni alla scadenza", valore: 44, unita: "giorni", vecchio: false }] }),
    ]),
    problemi: [],
  });
  assert.deepEqual(m.kpi.incidenti, { corrente: 3, precedente: 5 });
  assert.deepEqual(m.kpi.soluzioneMin, { corrente: 100, precedente: 30 });
  // Un giorno intero di fermo su un apparato, su 3 apparati e 30 giorni: 1 su 90 giorni-apparato.
  assert.equal(m.kpi.disponibilita?.corrente, 98.9);
  assert.equal(m.kpi.disponibilita?.precedente, 100);
  assert.deepEqual(m.kpi.scadenza, { giorni: 44, oggetto: "cert" });
  assert.deepEqual(m.spazio.map((x) => [x.nome, x.valore]), [["srv-a", 93.7], ["nas", 61]]);
  assert.equal(m.serie?.giorni.length, 30);
  assert.equal(m.serie?.disponibilita[29], 66.7);
  assert.deepEqual(m.serie?.settimane.map((w) => [w.gravi, w.medi]), [[0, 0], [1, 2], [0, 0], [0, 0]]);
});

test("senza i conti per apparato (centro vecchio) i KPI dello storico non si inventano", () => {
  const m = componiMonitoring({ ...BASE, famiglie: famiglie([oggetto("1", "sw", "rete")]), problemi: [] });
  assert.deepEqual([m.kpi.disponibilita, m.kpi.incidenti, m.kpi.soluzioneMin, m.serie], [null, null, null, null]);
});

test("tempo di soluzione: la mediana delle chiusure, che i pochi problemi lunghi non spostano", () => {
  assert.deepEqual([mediana([]), mediana([5]), mediana([10, 20]), mediana([3, 1, 2])], [null, 5, 15, 2]);
  const m = componiMonitoring({
    ...BASE,
    // Mese: 10, 20, 30 minuti e un NAS fermo 3 settimane. La media direbbe più di 2 giorni; la mediana 25 minuti.
    storico: storicoLungo({
      "1": { chiusure: [[40, 10], [41, 20], [50, 30]], chiusi: ad(40, 3), durata_chiusi: ad(40, 60) },
      "2": { chiusure: [[55, 30240]], chiusi: ad(55, 1), durata_chiusi: ad(55, 30240) },
    }),
    famiglie: famiglie([oggetto("1", "a", "rete"), oggetto("2", "nas", "storage")]),
    problemi: [],
  });
  assert.equal(m.kpi.soluzioneMin?.corrente, 25);
  assert.equal(m.kpi.soluzioneMin?.precedente, null);
});
