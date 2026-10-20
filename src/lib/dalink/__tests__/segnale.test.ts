/**
 * Tappa C1, Task 3: il costruttore del segnale di vita verso DA-Link.
 *
 * La scelta di cosa esce vale ALL'ORIGINE (spec NetBird §5.3): un'istanza a «solo
 * stato», o che non ha dichiarato niente, non legge nemmeno i numeri
 * dell'inventario, così un dato bloccato non parte proprio. È la prova di §14:
 * «un'istanza a solo stato non mette mai campi d'inventario nel segnale».
 *
 * Il corpo ha esattamente le chiavi del contratto di DA-Link
 * (`DA-Link/dalink/segnale.py`, classe `Segnale`) e nessun segreto.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { aggiornamentoPerSegnale, costruisciSegnale, type FattiIstanza, type Inventario } from "../segnale";
import { interpretaStatoAggiornamento, STATO_VUOTO } from "@/lib/aggiornamento-stato";

const CFG = { codcli: "99999", nodo: "99999-ipam" };
const FATTI: FattiIstanza = {
  versione: "0.3.281",
  moduli: { edge: true, wazuh: false },
  salute: { edge: "ok", firewall_wt0: "attivo" },
  ultimoErrore: null,
  porte: [443, 22, 22, 6443],
};
const INV: Inventario = { dispositivi: 412, reti: 9, ultima_scansione: "2026-10-15 03:00:00", esito_scansione: "completed" };

const CHIAVI_CONTRATTO = [
  "codcli",
  "inventario",
  "livello",
  "moduli",
  "nodo",
  "porte_netbird",
  "salute",
  "ultimo_errore",
  "versione",
].sort();

function spia(): { leggi: () => Inventario; chiamate: () => number } {
  let n = 0;
  return {
    leggi: () => {
      n += 1;
      return INV;
    },
    chiamate: () => n,
  };
}

test("solo stato: l'inventario non si legge e non esce", () => {
  const s = spia();
  const corpo = costruisciSegnale(CFG, "solo_stato", FATTI, s.leggi);
  assert.equal(s.chiamate(), 0, "a solo stato i numeri non si leggono nemmeno");
  assert.equal(corpo.inventario, null);
  assert.equal(corpo.livello, "solo_stato");
  assert.ok(!JSON.stringify(corpo).includes("412"));
});

test("nessuna scelta dichiarata: come solo stato, e il livello resta non dichiarato", () => {
  const s = spia();
  const corpo = costruisciSegnale(CFG, null, FATTI, s.leggi);
  assert.equal(s.chiamate(), 0);
  assert.equal(corpo.inventario, null);
  assert.equal(corpo.livello, null);
});

test("stato + inventario: i numeri si leggono una volta ed escono", () => {
  const s = spia();
  const corpo = costruisciSegnale(CFG, "stato_inventario", FATTI, s.leggi);
  assert.equal(s.chiamate(), 1);
  assert.deepEqual(corpo.inventario, INV);
});

test("le chiavi sono esattamente quelle del contratto, nessun token", () => {
  const corpo = costruisciSegnale(CFG, "stato_inventario", FATTI, () => INV);
  assert.deepEqual(Object.keys(corpo).sort(), CHIAVI_CONTRATTO);
  assert.deepEqual(Object.keys(corpo.inventario ?? {}).sort(), ["dispositivi", "esito_scansione", "reti", "ultima_scansione"]);
  assert.ok(!/token|dlk_/i.test(JSON.stringify(corpo)));
});

test("il codice cliente è testo, mai numero", () => {
  const corpo = costruisciSegnale(CFG, null, FATTI, () => INV);
  assert.equal(typeof corpo.codcli, "string");
  assert.match(JSON.stringify(corpo), /"codcli":"99999"/);
});

test("porte senza doppioni, ordinate, valide, al massimo 64", () => {
  const molte = Array.from({ length: 100 }, (_, i) => 1000 + i);
  const corpo = costruisciSegnale(CFG, null, { ...FATTI, porte: [443, 22, 22, 0, 70000, -1, 6443, ...molte] }, () => INV);
  assert.deepEqual(corpo.porte_netbird.slice(0, 3), [22, 443, 1000]);
  assert.equal(corpo.porte_netbird.length, 64);
  assert.ok(corpo.porte_netbird.every((p) => Number.isInteger(p) && p >= 1 && p <= 65535));
});

test("ultimo errore tagliato a 500, campi dell'inventario ai limiti del contratto", () => {
  const corpo = costruisciSegnale(
    CFG,
    "stato_inventario",
    { ...FATTI, ultimoErrore: "x".repeat(900) },
    () => ({ dispositivi: 1, reti: 1, ultima_scansione: "9".repeat(40), esito_scansione: "e".repeat(90) }),
  );
  assert.equal(corpo.ultimo_errore?.length, 500);
  assert.equal(corpo.inventario?.ultima_scansione?.length, 32);
  assert.equal(corpo.inventario?.esito_scansione?.length, 64);
});

test("a stato + inventario, numeri illeggibili → inventario null, non un ripiego a zero", () => {
  const corpo = costruisciSegnale(CFG, "stato_inventario", FATTI, () => null);
  assert.equal(corpo.inventario, null);
});

// --- Passo 1d (16/10): lo stato dell'aggiornamento nel segnale ---------------

test("aggiornamento: assente se l'istanza non lo registra (contratto delle istanze vecchie)", () => {
  const s = costruisciSegnale(CFG, null, { ...FATTI, aggiornamento: null }, () => INV);
  assert.equal("aggiornamento" in s, false);
  assert.equal(aggiornamentoPerSegnale(STATO_VUOTO, "dev"), null);
});

test("aggiornamento: solo stato, coi limiti di DA-Link, senza messaggi né avvisi", () => {
  const stato = interpretaStatoAggiornamento({
    commit_avviato: "a".repeat(40),
    ultimo_tentativo: {
      commit: "b".repeat(40),
      iniziato_il: "2026-10-16T10:00:00.000Z",
      finito_il: "2026-10-16T10:04:00.000Z",
      fase: "salute",
      esito: "fallito",
      messaggio: "fase salute: /opt/da-ipam non risponde",
      avvisi: ["un percorso del cliente"],
      tentativi: 2,
    },
    ultimo_successo: { commit: "a".repeat(40), il: "2026-10-15T09:00:00.000Z" },
  });
  const a = aggiornamentoPerSegnale(stato, "dev");
  assert.deepEqual(a, {
    commit_avviato: "a".repeat(40),
    ramo: "dev",
    esito: "fallito",
    fase: "salute",
    commit_tentato: "b".repeat(40),
    tentativi: 2,
    tentativo_iniziato_il: "2026-10-16T10:00:00.000Z",
    tentativo_finito_il: "2026-10-16T10:04:00.000Z",
    ultimo_successo_il: "2026-10-15T09:00:00.000Z",
  });
  const s = costruisciSegnale(CFG, "solo_stato", { ...FATTI, aggiornamento: a }, () => INV);
  assert.deepEqual(s.aggiornamento, a);
  assert.doesNotMatch(JSON.stringify(s), /non risponde|percorso/, "messaggi e avvisi restano sull'istanza");
});

// Analisi del 19/10, F03: DA-Link conosce quattro esiti e scarta il campo intero se
// ne arriva un altro («stato dell'aggiornamento malformato»). Il servizio fermo con la
// build pronta per lui è un giro fermato a metà: «interrotto», fase «avvio».
test("aggiornamento: pronto_non_avviato arriva a DA-Link come interrotto, fase avvio", () => {
  const stato = interpretaStatoAggiornamento({
    commit_avviato: "a".repeat(40),
    ultimo_tentativo: { commit: "b".repeat(40), iniziato_il: "2026-10-19T10:00:00.000Z", fase: "scambio", esito: "pronto_non_avviato", avvisi: [] },
  });
  const a = aggiornamentoPerSegnale(stato, "dev");
  assert.equal(a?.esito, "interrotto");
  assert.equal(a?.fase, "avvio");
});

// Sonde integrate con DA-Link (spec DA-Vul-can 2026-10-20, §8.2): il blocco `edge` è
// additivo. Senza modulo edge non c'è proprio (le chiavi restano quelle di prima); con la
// sonda esce passato dalla lista bianca, mai la risposta della sonda così com'è.
test("edge: assente se il modulo edge non è configurato", () => {
  const corpo = costruisciSegnale(CFG, "solo_stato", { ...FATTI, edge: null }, () => INV);
  assert.ok(!("edge" in corpo));
  assert.deepEqual(Object.keys(corpo).sort(), CHIAVI_CONTRATTO);
});

test("edge: la risposta della sonda esce solo coi campi del contratto", () => {
  const health = {
    ok: true,
    version: "0.8.121",
    scanner_id: "70791-cliente-edge",
    versione_vera: "0.8.121",
    hub: { esito: "errore", motivo: "dns", messaggio: "getaddrinfo da-vulcan.domarc.it" },
    aggiornamento: null,
    disco: { total_gb: 77, free_gb: 1.2 },
  };
  const corpo = costruisciSegnale(CFG, "solo_stato", { ...FATTI, edge: { raggiungibile: true, health } }, () => INV);
  assert.equal(corpo.edge?.raggiungibile, true);
  assert.equal(corpo.edge?.versione_vera, "0.8.121");
  assert.equal(corpo.edge?.hub?.motivo, "dns");
  assert.deepEqual(corpo.edge?.disco, { total_gb: 77, free_gb: 1.2 });
  const testo = JSON.stringify(corpo);
  assert.ok(!testo.includes("scanner_id") && !testo.includes("getaddrinfo"));
});

test("edge: sonda che non risponde → raggiungibile false e gli altri campi null", () => {
  const corpo = costruisciSegnale(CFG, "solo_stato", { ...FATTI, edge: { raggiungibile: false } }, () => INV);
  assert.deepEqual(corpo.edge, { raggiungibile: false, versione_vera: null, hub: null, aggiornamento: null, disco: null });
});
