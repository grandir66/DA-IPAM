// src/lib/topology/__tests__/map-screen.test.ts
/**
 * La mappa a schermo nei due orientamenti (spec §12.2) e le ridondanze a richiesta (spec §12.5):
 * scelta delle maniglie, verso delle ridondanze, «Adatta» in larghezza, centratura, «+ altri N»,
 * quali linee si disegnano e il «⇄ N» di ogni riquadro. Dati inventati.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ELENCO_KEY, FIT_MAX, FIT_MIN, HANDLE_ATT, HANDLE_IN, HANDLE_IN_DX, HANDLE_IN_GIU, HANDLE_IN_LR, HANDLE_OUT, HANDLE_OUT_LR, HANDLE_OUT_SU, HANDLE_OUT_SX, LR_TRUNK,
  attraversa, candidatiLati, centerViewport, elencoAperto, fitWidthViewport, labelBoxes, latiVicini, lineHandles, lineaAlbero, lrLabelMaxWidth, maniglieLati,
  moreAttachedAt, ostacoli, percorso, printHref, pulsanteElenco, redundancyCounts, redundantEnds, redundantLabelAt, rettangoli, salvaElenco, siGuardano,
  troncoPossibile, visibleEdges,
} from "@/lib/topology/map-screen";
import type { LayoutResult } from "@/lib/topology/tree-layout";
import { ATT_INDENT, ATT_MAX, ATT_ROW } from "@/lib/topology/tree-layout-consts";

test("id delle maniglie fissi (le linee salvate e la stampa li danno per scontati)", () => {
  assert.equal(HANDLE_IN, "su");
  assert.equal(HANDLE_OUT, "giu");
  assert.equal(HANDLE_IN_LR, "sx");
  assert.equal(HANDLE_OUT_LR, "dx");
  assert.equal(HANDLE_ATT, "fondo");
});

test("maniglie: in orizzontale si esce dal fondo e si entra dall'alto, in verticale da destra a sinistra", () => {
  assert.deepEqual(lineHandles("tb"), { source: "giu", target: "su" });
  assert.deepEqual(lineHandles("lr"), { source: "dx", target: "sx" });
});

test("ridondanza: in verticale va dal riquadro più a sinistra a quello più a destra, qualunque sia l'ordine", () => {
  const a = { id: "dev:9", x: 600, y: 40 }, b = { id: "dev:2", x: 40, y: 900 };
  assert.deepEqual(redundantEnds("lr", a, b), ["dev:2", "dev:9"]);
  assert.deepEqual(redundantEnds("lr", b, a), ["dev:2", "dev:9"]);
});

test("ridondanza: in orizzontale scende dal riquadro più in alto (come prima)", () => {
  const a = { id: "dev:9", x: 600, y: 40 }, b = { id: "dev:2", x: 40, y: 900 };
  assert.deepEqual(redundantEnds("tb", a, b), ["dev:9", "dev:2"]);
  assert.deepEqual(redundantEnds("tb", b, a), ["dev:9", "dev:2"]);
});

test("ridondanza nella stessa colonna (verticale): dal più in alto; a pari posto decide l'id, sempre uguale", () => {
  const a = { id: "dev:5", x: 300, y: 500 }, b = { id: "dev:4", x: 300, y: 100 };
  assert.deepEqual(redundantEnds("lr", a, b), ["dev:4", "dev:5"]);
  const c = { id: "dev:7", x: 300, y: 100 }, d = { id: "dev:3", x: 300, y: 100 };
  assert.deepEqual(redundantEnds("lr", c, d), ["dev:3", "dev:7"]);
  assert.deepEqual(redundantEnds("lr", d, c), ["dev:3", "dev:7"]);
});

test("«Adatta» in verticale: zoom = larghezza del riquadro della mappa / larghezza della disposizione, in cima a sinistra", () => {
  assert.deepEqual(fitWidthViewport(2608, 1900), { x: 0, y: 0, zoom: 1900 / 2608 });
});

test("«Adatta» in verticale: mai sotto 0,25 né sopra 1", () => {
  assert.equal(FIT_MIN, 0.25);
  assert.equal(FIT_MAX, 1);
  assert.equal(fitWidthViewport(13000, 1280).zoom, 0.25);
  assert.equal(fitWidthViewport(800, 1920).zoom, 1);
  // Senza misure (riquadro non ancora reso, disposizione vuota): 100 %, non NaN né Infinity.
  assert.equal(fitWidthViewport(0, 1920).zoom, 1);
  assert.equal(fitWidthViewport(2000, 0).zoom, 1);
});

test("centratura: in orizzontale la testa in mezzo in alto; in verticale a sinistra e a metà altezza", () => {
  const head = { x: 1000, y: 40, w: 200, h: 44 };
  assert.deepEqual(centerViewport("tb", head, { width: 1600, height: 800 }), { x: 800 - 1100, y: 10, zoom: 1 });
  const lr = { x: 40, y: 1500, w: 200, h: 44 };
  assert.deepEqual(centerViewport("lr", lr, { width: 1600, height: 800 }), { x: -20, y: 400 - 1522, zoom: 1 });
});

test("centratura in verticale: una testa vicina alla cima non lascia una fascia vuota sopra la mappa", () => {
  const head = { x: 40, y: 40, w: 200, h: 44 };
  assert.equal(centerViewport("lr", head, { width: 1600, height: 800 }).y, 10);
});

test("«+ altri N»: in orizzontale accanto al riquadro, in verticale sotto l'ultimo attaccato col rientro", () => {
  const box = { x: 100, y: 200, w: 180, h: 44 };
  assert.deepEqual(moreAttachedAt("tb", box), { x: 100 + 180 + 14, y: 200 + ATT_MAX * ATT_ROW });
  // L'ultimo attaccato (il quarto) sta a y + h + 4 + 3 × ATT_ROW: «+ altri N» subito sotto.
  assert.deepEqual(moreAttachedAt("lr", box), { x: 100 + ATT_INDENT, y: 200 + 44 + 4 + ATT_MAX * ATT_ROW });
});

test("etichetta di una linea in verticale: sta fra il tronco e il figlio, mai sopra il genitore", () => {
  // Genitore che finisce a 300, figlio che comincia a 390 (90 px fra le colonne).
  assert.equal(lrLabelMaxWidth(300, 390), 390 - (300 + LR_TRUNK) - 8);
  // Figlio spostato a mano vicino o dietro al genitore: almeno 40 px, va a capo.
  assert.equal(lrLabelMaxWidth(300, 280), 40);
});

test("«Stampa»: apre la pagina di stampa della mappa che si guarda", () => {
  assert.equal(printHref("auto", null), "/topology/stampa?mappa=auto");
  assert.equal(printHref("auto", 7), "/topology/stampa?mappa=auto");
  assert.equal(printHref("passo", 12), "/topology/stampa?mappa=12");
  assert.equal(printHref("passo", null), null);
});

// ─── Ridondanze a richiesta (spec §12.5) ───
const L = (id: string, a: string, b: string, redundant: boolean) => ({ id, a, b, redundant });
const links = [
  L("p1", "dev:1", "dev:2", false),
  L("p2", "dev:1", "dev:3", false),
  L("r1", "dev:3", "dev:2", true),
  L("r2", "dev:4", "dev:2", true),
  L("r3", "dev:4", "dev:3", true),
];
const ids = (xs: Array<{ id: string }>) => xs.map((x) => x.id);

test("visibleEdges: di base nessuna ridondanza, i principali sempre", () => {
  assert.deepEqual(ids(visibleEdges(links, { showAll: false, selected: null })), ["p1", "p2"]);
});

test("visibleEdges: con un riquadro scelto, solo le sue ridondanze (dalle due parti)", () => {
  assert.deepEqual(ids(visibleEdges(links, { showAll: false, selected: "dev:2" })), ["p1", "p2", "r1", "r2"]);
  assert.deepEqual(ids(visibleEdges(links, { showAll: false, selected: "dev:4" })), ["p1", "p2", "r2", "r3"]);
  // Un riquadro senza ridondanze: solo i principali.
  assert.deepEqual(ids(visibleEdges(links, { showAll: false, selected: "dev:1" })), ["p1", "p2"]);
});

test("visibleEdges: con «Mostra ridondanze» tutte, scelto o no", () => {
  assert.deepEqual(ids(visibleEdges(links, { showAll: true, selected: null })), ["p1", "p2", "r1", "r2", "r3"]);
  assert.deepEqual(ids(visibleEdges(links, { showAll: true, selected: "dev:1" })), ["p1", "p2", "r1", "r2", "r3"]);
});

test("redundancyCounts: «⇄ N» conta le ridondanze di ogni riquadro, da tutte e due le parti; chi non ne ha non c'è", () => {
  const c = redundancyCounts(links);
  assert.equal(c.get("dev:2"), 2);
  assert.equal(c.get("dev:3"), 2);
  assert.equal(c.get("dev:4"), 2);
  assert.equal(c.has("dev:1"), false);
  assert.equal(c.size, 3);
});

// Task 5 (visto a schermo sulla copia del cliente A): con «Mostra ridondanze» 6 parole «ridondanza» su 8
// stavano a metà della linea sopra un riquadro o sotto il gruppo degli AP, e si leggeva «…nza».
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("parola della ridondanza: a metà se lì non c'è niente", () => {
  const pts = [{ x: 0, y: 0 }, { x: 400, y: 0 }];
  assert.deepEqual(redundantLabelAt(pts, { w: 80, h: 16 }, []), { x: 200, y: 0 });
});

test("parola della ridondanza: si sposta lungo la linea fuori dai riquadri, mai sopra uno", () => {
  // Un gradino che passa dietro a un riquadro proprio a metà percorso.
  const pts = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 400 }, { x: 600, y: 400 }];
  const box = { x: 250, y: 150, w: 120, h: 100 };
  const size = { w: 90, h: 16 };
  const at = redundantLabelAt(pts, size, [box]);
  assert.equal(overlaps({ x: at.x - size.w / 2, y: at.y - size.h / 2, ...size }, box), false);
  // Sta sulla linea: sul tratto verticale x=300, o su uno dei due orizzontali.
  assert.ok(at.x === 300 || at.y === 0 || at.y === 400, JSON.stringify(at));
  // Il più vicino possibile a metà (la metà del percorso è a y=200 sul tratto verticale).
  assert.equal(at.x, 300);
});

test("parola della ridondanza: se tutto il percorso è coperto resta a metà (non sparisce)", () => {
  const pts = [{ x: 0, y: 0 }, { x: 200, y: 0 }];
  assert.deepEqual(redundantLabelAt(pts, { w: 60, h: 16 }, [{ x: -50, y: -50, w: 300, h: 100 }]), { x: 100, y: 0 });
});

test("riquadri da evitare: riquadri con la riga delle porte sopra, gruppi degli AP, attaccati", () => {
  const boxes = labelBoxes(
    [
      { x: 10, y: 100, w: 170, h: 44, role: "box" as const },
      { x: 10, y: 160, w: 160, h: 18, role: "attached" as const },
    ],
    [{ x: 300, y: 0, w: 316, h: 120 }],
  );
  assert.deepEqual(boxes, [
    { x: 10, y: 82, w: 170, h: 62 },
    { x: 10, y: 160, w: 160, h: 18 },
    { x: 300, y: 0, w: 316, h: 120 },
  ]);
});

// ─── Lato più vicino (spec §13.10.1, vincolo 5 di Riccardo, 14/10) ───
// Oggi una ridondanza esce sempre dal lato destro del riquadro più a sinistra ed entra dal sinistro dell'altro
// (`redundantEnds`): fra due riquadri della stessa colonna fa il giro. I candidati sono coppie di lati che si guardano.

const R = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

test("maniglie nuove con id fissi; quelle di oggi restano", () => {
  assert.deepEqual([HANDLE_OUT_SU, HANDLE_OUT_SX, HANDLE_IN_GIU, HANDLE_IN_DX], ["s-su", "s-sx", "t-giu", "t-dx"]);
  assert.deepEqual(maniglieLati({ da: "dx", a: "sx" }), { source: "dx", target: "sx" });
  assert.deepEqual(maniglieLati({ da: "giu", a: "su" }), { source: "giu", target: "su" });
  assert.deepEqual(maniglieLati({ da: "su", a: "giu" }), { source: "s-su", target: "t-giu" });
  assert.deepEqual(maniglieLati({ da: "sx", a: "dx" }), { source: "s-sx", target: "t-dx" });
});

test("candidati: B a destra alla stessa altezza → solo i lati affacciati, percorso dritto", () => {
  const a = R(0, 0, 100, 40), b = R(200, 0, 100, 40);
  assert.deepEqual(candidatiLati(a, b, "lr"), [{ da: "dx", a: "sx" }]);
  assert.deepEqual(percorso(a, "dx", b, "sx"), [{ x: 100, y: 20 }, { x: 200, y: 20 }]);
});

test("candidati: prima l'asse col vuoto maggiore, poi l'altro, poi le due «L» (a pari lunghezza nell'ordine)", () => {
  const a = R(0, 0, 100, 40), b = R(150, 200, 100, 40); // vuoto orizzontale 50, verticale 160
  assert.deepEqual(candidatiLati(a, b, "lr"), [{ da: "giu", a: "su" }, { da: "dx", a: "sx" }, { da: "dx", a: "su" }, { da: "giu", a: "sx" }]);
  assert.deepEqual(percorso(a, "giu", b, "su"), [{ x: 50, y: 40 }, { x: 50, y: 120 }, { x: 200, y: 120 }, { x: 200, y: 200 }]);
  assert.deepEqual(percorso(a, "dx", b, "su"), [{ x: 100, y: 20 }, { x: 200, y: 20 }, { x: 200, y: 200 }]);
});

test("candidati: a pari vuoto vince l'asse dell'orientamento", () => {
  const a = R(0, 0, 100, 40), b = R(150, 90, 100, 40); // 50 e 50
  assert.deepEqual(candidatiLati(a, b, "lr").slice(0, 2), [{ da: "dx", a: "sx" }, { da: "giu", a: "su" }]);
  assert.deepEqual(candidatiLati(a, b, "tb").slice(0, 2), [{ da: "giu", a: "su" }, { da: "dx", a: "sx" }]);
});

test("latiVicini: il primo candidato che non attraversa un riquadro; se tutti attraversano, il più corto", () => {
  const a = R(0, 0, 100, 40), b = R(300, 200, 100, 40);
  const o1 = R(180, 100, 40, 40); // sul gradino della «Z» orizzontale e sul tratto della «Z» verticale
  assert.deepEqual(latiVicini(a, b, "lr", []), { da: "dx", a: "sx" });
  assert.deepEqual(latiVicini(a, b, "lr", [o1]), { da: "dx", a: "su" });
  const o2 = R(340, 60, 30, 40), o3 = R(30, 100, 40, 40); // chiudono anche le due «L»
  assert.deepEqual(latiVicini(a, b, "lr", [o1, o2, o3]), { da: "dx", a: "sx" }); // 400 px contro 430 e 460
  assert.equal(attraversa(percorso(a, "dx", b, "sx"), [o1]), true);
  assert.equal(attraversa(percorso(a, "dx", b, "su"), [o1]), false);
});

test("riquadri sovrapposti (non dovrebbe succedere): nessun candidato, i lati di oggi", () => {
  const a = R(0, 0, 100, 40), b = R(50, 10, 100, 40);
  assert.deepEqual(candidatiLati(a, b, "lr"), []);
  assert.deepEqual(latiVicini(a, b, "lr", []), { da: "dx", a: "sx" });
  assert.deepEqual(latiVicini(a, b, "tb", []), { da: "giu", a: "su" });
});

test("C10: fra due riquadri della stessa colonna i lati di oggi fanno il giro, quelli scelti no", () => {
  const s = R(0, 0, 200, 44), t = R(0, 100, 200, 44);
  assert.equal(siGuardano(s, "dx", t, "sx"), false);
  const l = latiVicini(s, t, "lr", []);
  assert.deepEqual(l, { da: "giu", a: "su" });
  assert.equal(siGuardano(s, l.da, t, l.a), true);
});

test("ostacoli: tutti i riquadri tranne i due capi", () => {
  const r = [{ id: "dev:1", ...R(0, 0, 10, 10) }, { id: "dev:2", ...R(20, 0, 10, 10) }, { id: "apg:dev:1", ...R(40, 0, 10, 10) }];
  assert.deepEqual(ostacoli(r, ["dev:1", "dev:2"]), [R(40, 0, 10, 10)]);
});

test("rettangoli: i riquadri con il loro id; i gruppi degli AP come «apg:‹padre›»", () => {
  const layout: LayoutResult = {
    nodes: new Map([["dev:1", { id: "dev:1", x: 0, y: 0, w: 100, h: 40, role: "box", parent: null }]]),
    apGroups: [{ parent: "dev:1", x: 120, y: 0, w: 316, h: 60, count: 4 }],
    moreAttached: new Map(), vmChips: [], width: 436, height: 60, expired: [], orientation: "lr",
  };
  assert.deepEqual(rettangoli(layout), [{ id: "dev:1", ...R(0, 0, 100, 40) }, { id: "apg:dev:1", ...R(120, 0, 316, 60) }]);
  // Gli ostacoli di una linea fra il riquadro e un altro: il gruppo degli AP resta, i due capi no.
  assert.deepEqual(ostacoli(rettangoli(layout), ["dev:1", "dev:2"]), [R(120, 0, 316, 60)]);
});

test("linee dell'albero: restano a tronco; un figlio spostato a mano dall'altra parte usa il lato più vicino", () => {
  const padre = R(0, 0, 200, 44);
  assert.equal(troncoPossibile("lr", padre, R(304, 100, 180, 44)), true);
  assert.deepEqual(lineaAlbero("lr", padre, R(304, 100, 180, 44), []), { tronco: true });
  assert.deepEqual(lineaAlbero("lr", padre, R(0, 200, 180, 44), []), { tronco: false, lati: { da: "giu", a: "su" } });
  const p2 = R(100, 100, 200, 44);
  assert.deepEqual(lineaAlbero("tb", p2, R(100, 300, 200, 44), []), { tronco: true });
  assert.deepEqual(lineaAlbero("tb", p2, R(100, 0, 200, 44), []), { tronco: false, lati: { da: "su", a: "giu" } });
});

// Spec §13.10.2 (vincolo 6 di Riccardo): l'elenco a sinistra si chiude per lasciare spazio alla mappa; la scelta si ricorda
// per chi guarda, come la barra dei dettagli, e una memoria che non si legge (navigazione privata) non rompe la pagina.
test("elenco: si ricorda per chi guarda; senza memoria leggibile resta aperto; una scrittura che fallisce non rompe niente", () => {
  assert.equal(ELENCO_KEY, "da-ipam.topologia.elenco");
  assert.equal(elencoAperto(() => null), true);
  assert.equal(elencoAperto(() => "chiuso"), false);
  assert.equal(elencoAperto(() => "aperto"), true);
  assert.equal(elencoAperto(() => { throw new Error("SecurityError"); }), true);
  const scritti: string[] = [];
  salvaElenco((v) => scritti.push(v), false);
  salvaElenco((v) => scritti.push(v), true);
  assert.deepEqual(scritti, ["chiuso", "aperto"]);
  assert.doesNotThrow(() => salvaElenco(() => { throw new Error("QuotaExceeded"); }, true));
});

test("pulsante dell'elenco: «◂ Elenco» aperto, «Elenco ▸» chiuso; in passo passo dice a che serve aprirlo", () => {
  assert.equal(pulsanteElenco(true, false).etichetta, "◂ Elenco");
  assert.equal(pulsanteElenco(false, false).etichetta, "Elenco ▸");
  assert.equal(pulsanteElenco(false, true).titolo, "Apre l'elenco per trascinare gli oggetti sulla mappa");
  assert.match(pulsanteElenco(true, true).titolo, /Chiude l'elenco/);
});
