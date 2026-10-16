// T3 Task 10 (spec §13.4.6, §13.8.3 punti 8-10, §13.9, §13.7.2 passo 10): i testi del pannello dei dettagli per cavo.
// Dati inventati, con la forma dei tipi di model-types.ts (il modello che li riempie arriva col Task 6).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INVITO_STELLA, membroInParole, nomeDelGenere, sceltoInParole, testoStellaSenzaCollegamento, partenzeScartate, righeDalleVm, stellaNonApplicabile, testoAnomalia, testoStellaDiPrima, titoloPerche,
} from "@/lib/topology/cavi/pannello";
import { LINK_ATTRS_DEFAULT, type MapLink } from "@/lib/topology/model-types";
import type { TreeResult } from "@/lib/topology/tree";

const NOMI: Record<string, string> = { "dev:1": "router 1", "dev:2": "core 1", "dev:3": "accesso A", "dev:4": "accesso B", "dev:5": "core 2" };
const nomeDi = (id: string): string => NOMI[id] ?? id;

function link(a: string, b: string, over: Partial<MapLink> = {}): MapLink {
  return {
    id: `l:${a}|${b}`, a, aPort: "p1", b, bPort: "p2", source: "lldp", sources: ["lldp"], uplinkFrom: null,
    lastSeen: null, daysUnseen: null, stale: false, ...LINK_ATTRS_DEFAULT, ...over,
  };
}
/** router 1 → core 1 → accesso A → accesso B; la partenza «core 1» è raggiungibile da «router 1». */
function albero(): TreeResult {
  const l12 = link("dev:1", "dev:2"), l23 = link("dev:2", "dev:3"), l34 = link("dev:3", "dev:4");
  return {
    roots: ["dev:1"],
    children: new Map([["dev:1", ["dev:2"]], ["dev:2", ["dev:3"]], ["dev:3", ["dev:4"]], ["dev:4", []]]),
    via: new Map([["dev:2", l12], ["dev:3", l23], ["dev:4", l34]]),
    links: [l12, l23, l34],
  };
}

test("il titolo di «Perché questo …» usa la parola del genere; senza genere o senza parola, «collegamento»", () => {
  assert.equal(titoloPerche("cavo"), "Perché questo cavo");
  assert.equal(titoloPerche("tunnel"), "Perché questo tunnel");
  assert.equal(titoloPerche("radio"), "Perché questo ponte radio");
  assert.equal(titoloPerche("fascio"), "Perché questo fascio");
  assert.equal(titoloPerche(undefined), "Perché questo collegamento");
  assert.equal(titoloPerche("senza_fili"), "Perché questo collegamento");
  assert.equal(titoloPerche("contrazione"), "Perché questo collegamento");
  assert.equal(nomeDelGenere("radio"), "ponte radio");
  assert.equal(nomeDelGenere(undefined), "cavo");
});

test("★ non applicabile: l'altro capo si raggiunge solo passando dal nodo stesso (§13.8.3 punto 10)", () => {
  const t = albero();
  // ★ scelta per «accesso A» sul cavo verso «accesso B», che sta sotto «accesso A»: il cavo non può fargli da padre.
  const l = link("dev:3", "dev:4", { id: "l:x", primary: "user", primaryFor: "dev:3", redundant: true });
  assert.equal(stellaNonApplicabile(l, t, nomeDi), "★ non applicabile: accesso B si raggiunge solo passando da accesso A");
  // ★ usata: è il collegamento con cui il nodo è appeso.
  assert.equal(stellaNonApplicabile({ ...t.via.get("dev:3")!, primary: "user", primaryFor: "dev:3" }, t, nomeDi), null);
  // ★ su un altro cavo che non è sotto il nodo: applicabile, niente da dire.
  assert.equal(stellaNonApplicabile(link("dev:3", "dev:1", { id: "l:y", primary: "user", primaryFor: "dev:3", redundant: true }), t, nomeDi), null);
  // Nessuna ★.
  assert.equal(stellaNonApplicabile(link("dev:3", "dev:4", { id: "l:z", redundant: true }), t, nomeDi), null);
});

test("seconda partenza scartata: una riga per partenza, con la testa e il padre (§13.8.3 punto 9)", () => {
  const t = albero();
  assert.deepEqual(
    partenzeScartate({ savedRoots: ["dev:1", "dev:3"], tree: t }, nomeDi),
    ["accesso A è raggiungibile da router 1: sta nell'albero sotto core 1"],
  );
  assert.deepEqual(partenzeScartate({ savedRoots: ["dev:1"], tree: t }, nomeDi), []);
  // Una partenza che non è nella mappa non ha un padre da dire.
  assert.deepEqual(partenzeScartate({ savedRoots: ["dev:1", "dev:9"], tree: t }, nomeDi), []);
});

test("il testo dell'anomalia nei dettagli è quello di D2, con i nomi e le porte (§13.8.3 punto 8)", () => {
  const t = testoAnomalia({ nodo: "dev:5", padre: "dev:3", porta: "p11", altri: ["dev:3", "dev:4"] }, nomeDi);
  assert.equal(t.titolo, "core che esce da uno switch di accesso");
  assert.equal(
    t.testo,
    "Il percorso attivo di core 2 passa da accesso A (porta p11). core 2 ha cavi anche verso accesso A e accesso B, che stanno allo stesso livello di accesso A. " +
      "Di solito i core stanno sopra gli accessi: controlla le priorità dello spanning tree, o il cavo fra i due core.",
  );
  // Tre altri: «A, B e C»; la porta non nota si dice.
  assert.match(testoAnomalia({ nodo: "dev:5", padre: "dev:3", porta: "", altri: ["dev:1", "dev:2", "dev:4"] }, nomeDi).testo, /\(porta non nota\).*verso router 1, core 1 e accesso B,/);
});

test("la ★ di prima dice che vale per il cavo migliore e invita a scegliere", () => {
  assert.equal(
    testoStellaDiPrima(),
    "★ scelta prima che le linee fossero per cavo: ora vale per il cavo migliore fra questi due apparati. Scegli il cavo",
  );
  assert.ok(testoStellaDiPrima().endsWith(INVITO_STELLA));
});

test("«visto dalle VM anche su …»: la porta, l'altro capo e quante VM", () => {
  assert.deepEqual(
    righeDalleVm([{ altro: "dev:3", porta: "p7", vm: 3 }, { altro: "dev:4", porta: "p9", vm: 1 }], nomeDi),
    ["visto dalle VM anche su p7 di accesso A (3 VM)", "visto dalle VM anche su p9 di accesso B (1 VM)"],
  );
  assert.deepEqual(righeDalleVm([], nomeDi), []);
});

test("un membro di un fascio in parole: le porte, la velocità, lo stato quando non inoltra", () => {
  assert.equal(membroInParole({ aPort: "p1", bPort: "p2", stato: "inoltra", velocitaMbps: 25000 }), "p1 ↔ p2 · 25G");
  assert.equal(membroInParole({ aPort: "p1", bPort: "", stato: null, velocitaMbps: null }), "p1 ↔ porta non nota");
  assert.equal(membroInParole({ aPort: "p3", bPort: "p4", stato: "giu", velocitaMbps: 25000 }), "p3 ↔ p4 · cavo giù");
  assert.equal(membroInParole({ aPort: "p3", bPort: "p4", stato: "bloccato", velocitaMbps: 1000 }), "p3 ↔ p4 · 1G · bloccato");
  assert.equal(membroInParole({ aPort: "p3", bPort: "p4", stato: "riserva_bond", velocitaMbps: 1000 }), "p3 ↔ p4 · 1G · riserva");
});

test("il collegamento scelto di una porta in parole: la parola del genere e l'altro capo", () => {
  assert.equal(sceltoInParole({ linea: "l:1", verso: "dev:2", genere: "cavo" }, nomeDi), "cavo verso core 1");
  assert.equal(sceltoInParole({ linea: "l:1", verso: "dev:3", genere: "radio" }, nomeDi), "ponte radio verso accesso A");
  assert.equal(sceltoInParole({ linea: "l:1", verso: "seg:1:2", genere: "segmento" }, nomeDi), "segmento verso seg:1:2");
  assert.equal(sceltoInParole({ linea: "l:1", verso: "dev:3", genere: "senza_fili" }, nomeDi), "collegamento senza fili verso accesso A");
});

test("una ★ senza nessun cavo fra i due apparati lo dice, e comincia con «★ senza collegamento»", () => {
  assert.equal(testoStellaSenzaCollegamento("core 1", "accesso A", 0), "★ senza collegamento: fra core 1 e accesso A oggi non c'è nessun cavo");
  assert.equal(testoStellaSenzaCollegamento("core 1", "accesso A", 2), null);
});
