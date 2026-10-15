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
import { costruisciSegnale, type FattiIstanza, type Inventario } from "../segnale";

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
