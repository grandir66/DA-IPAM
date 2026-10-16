import { test } from "node:test";
import assert from "node:assert/strict";
import { edgeLook } from "@/lib/topology/edge-look";
import { LINK_ATTRS_DEFAULT, type MapLink, type MapNode, type TopologyModel } from "@/lib/topology/model-types";
import { GREY, INK, PAPER, edgeLabelAt, parolaLineaSpostata, printStrokes, puntiLineaAlbero, redundantCables, stepPoints, wrapLabel } from "@/lib/topology/print-draw";
import { buildPrintView } from "@/lib/topology/print-view";
import { drawableLinks, labelBoxes, latiVicini, percorso, redundancyCounts } from "@/lib/topology/map-screen";
import { CHAR_W } from "@/lib/topology/tree-layout-consts";
import type { LayoutNode } from "@/lib/topology/tree-layout";
import type { TreeResult } from "@/lib/topology/tree";

// Dati inventati con la forma vera (spec topologia §12.3, §12.5, §11.4).
function link(over: Partial<MapLink> = {}): MapLink {
  return {
    id: "link:dev:1|dev:2", a: "dev:1", aPort: "Port 1", b: "dev:2", bPort: "eth0", source: "lldp", sources: ["lldp"],
    uplinkFrom: null, lastSeen: null, daysUnseen: null, stale: false, ...LINK_ATTRS_DEFAULT, ...over,
  };
}
function node(id: string, type: string, name = id): MapNode {
  const [k, n] = id.split(":");
  return {
    id, kind: k === "dev" ? "device" : "host", refId: Number(n), name, type, mgmtIp: null,
    fusedHostIds: [], addresses: [], aliases: [], siteId: null, rackId: null, siteProposed: false, hidden: false, vendor: null,
  };
}
function model(nodes: MapNode[], links: MapLink[] = []): TopologyModel {
  return {
    nodes, links, sites: [], promote: [], unmatched: [], isolated: [], suspicious: [], withoutSite: [],
    counts: {} as TopologyModel["counts"], portClients: [], clientCount: {}, canonical: {}, vms: [],
  };
}

test("linea a gradini: in verticale dal lato destro del genitore al lato sinistro del figlio", () => {
  const p = stepPoints("lr", { x: 40, y: 100, w: 200, h: 44 }, { x: 330, y: 300, w: 180, h: 44 });
  // Il gradino corre a LR_TRUNK (14 px) dal genitore, come a schermo (Task 5: a metà fra le colonne la
  // scritta «1G · ⚡ 1,7 W», più lunga del braccio, stava a cavallo del tronco).
  assert.deepEqual(p, [{ x: 240, y: 122 }, { x: 254, y: 122 }, { x: 254, y: 322 }, { x: 330, y: 322 }]);
  // Alla stessa altezza: un tratto solo.
  assert.equal(stepPoints("lr", { x: 40, y: 100, w: 200, h: 44 }, { x: 330, y: 100, w: 180, h: 44 }).length, 2);
});

test("linea a gradini: in orizzontale dal fondo del genitore alla cima del figlio", () => {
  const p = stepPoints("tb", { x: 100, y: 40, w: 200, h: 44 }, { x: 400, y: 140, w: 180, h: 44 });
  assert.deepEqual(p, [{ x: 200, y: 84 }, { x: 200, y: 112 }, { x: 490, y: 112 }, { x: 490, y: 140 }]);
  assert.deepEqual(edgeLabelAt("tb", p), { x: 486, y: 109, anchor: "end" });
  assert.deepEqual(edgeLabelAt("lr", [{ x: 0, y: 0 }, { x: 50, y: 10 }]), { x: 46, y: 6, anchor: "end" });
  // Figlio proprio sotto il genitore (linea dritta): la scritta a metà della linea, non sul riquadro del genitore.
  const straight = stepPoints("tb", { x: 100, y: 40, w: 200, h: 44 }, { x: 100, y: 200, w: 200, h: 44 });
  assert.equal(straight.length, 2);
  assert.deepEqual(edgeLabelAt("tb", straight), { x: 196, y: 146, anchor: "end" });
});

test("in stampa le linee sono nere o grigie, con lo spessore della velocità; mai il solo colore", () => {
  const plain = printStrokes(edgeLook(link({ speedMbps: 10000 }), { inTree: true }));
  assert.deepEqual(plain, [{ color: INK, width: 6, dash: null, cap: "butt" }]);
  // Non vista: grigia E tratteggiata.
  const stale = printStrokes(edgeLook(link({ stale: true, daysUnseen: 9 }), { inTree: true }));
  assert.deepEqual(stale, [{ color: GREY, width: 2.4, dash: "6 4", cap: "butt" }]);
  // A mano non confermata: puntinata, punti tondi.
  const manual = printStrokes(edgeLook(link({ manual: { confirmed: false } }), { inTree: true }));
  assert.deepEqual(manual, [{ color: INK, width: 2.4, dash: "1.5 4", cap: "round" }]);
  // Doppia (la ridondanza nella legenda): tratto largo nero e tratto interno color carta.
  const dbl = printStrokes(edgeLook(link({ redundant: true, speedMbps: 1000 }), { inTree: false }));
  assert.equal(dbl.length, 2);
  assert.deepEqual([dbl[0].color, dbl[1].color], [INK, PAPER]);
  assert.ok(dbl[0].width - dbl[1].width > 2);
  for (const s of [...plain, ...stale, ...manual, ...dbl]) assert.ok([INK, GREY, PAPER].includes(s.color));
});

// T3.5: in bianco e nero «giù» è un tratteggio lungo nero, «non visto» uno corto grigio, il tunnel un lungo-corto.
test("in stampa «cavo giù» e il tunnel hanno il loro tratto, diverso da «non visto»", () => {
  const c = { fiducia: "certo" as const, porteDaVerificare: false, detti: [], frasi: [] };
  const giu = printStrokes(edgeLook(link({ stale: true, daysUnseen: 3, speedMbps: 10000, cavo: { ...c, genere: "cavo", stato: "giu" } }), { inTree: true }));
  assert.deepEqual(giu, [{ color: INK, width: 6, dash: "10 4", cap: "butt" }]);
  const tun = printStrokes(edgeLook(link({ medium: "tunnel", cavo: { ...c, genere: "tunnel", stato: null } }), { inTree: true }));
  assert.deepEqual(tun, [{ color: INK, width: 2.4, dash: "8 3 2 3", cap: "butt" }]);
  const radio = edgeLook(link({ cavo: { ...c, genere: "radio", stato: null } }), { inTree: true });
  assert.equal(radio.wavy, true);
});

const boxes = (ids: string[], attached: string[] = []) => new Map<string, LayoutNode>(
  [...ids.map((id) => [id, "box"] as const), ...attached.map((id) => [id, "attached"] as const)]
    .map(([id, role]) => [id, { id, x: 0, y: 0, w: 1, h: 1, role, parent: null }]),
);

test("cavi di ridondanza: solo i collegamenti che l'albero non usa, dalla parte della radice, porte e velocità", () => {
  const tree: TreeResult = {
    roots: ["dev:1"],
    children: new Map([["dev:1", ["dev:2", "dev:3"]], ["dev:2", ["dev:4"]], ["dev:3", []], ["dev:4", []]]),
    via: new Map(),
    links: [
      link({ id: "l1", a: "dev:1", b: "dev:2", primary: "auto" }),
      link({ id: "l2", a: "dev:4", aPort: "sfp2", b: "dev:3", bPort: "", redundant: true, speedMbps: 10000 }),
      link({ id: "l3", a: "dev:2", aPort: "Port 24", b: "dev:3", bPort: "Port 23", redundant: true }),
      link({ id: "l4", a: "dev:9", b: "dev:1", redundant: true }),
    ],
  };
  const names: Record<string, string> = { "dev:1": "Centrale", "dev:2": "SW-A", "dev:3": "SW-B", "dev:4": "Server-1" };
  const rows = redundantCables(tree, boxes(["dev:1", "dev:2", "dev:3", "dev:4"]), (id) => names[id] ?? id);
  assert.deepEqual(rows, [
    { id: "l3", from: "SW-A", fromPort: "Port 24", to: "SW-B", toPort: "Port 23", speed: "non nota" },
    { id: "l2", from: "SW-B", fromPort: "porta non nota", to: "Server-1", toPort: "sfp2", speed: "10G" },
  ]);
});

test("vista da stampare: la mappa automatica senza apparati collegati dice perché, non è un foglio vuoto", () => {
  const v = buildPrintView(model([]), "auto", { map: null, nodes: [], tweaks: [] }, false);
  assert.equal(v.ok, false);
  assert.match(v.ok ? "" : v.message, /niente da stampare/);
  const empty = buildPrintView(model([node("dev:1", "switch")]), 7, { map: { name: "Sede", kind: "passo", roots: [], head_node: null }, nodes: [], tweaks: [] }, false);
  assert.equal(empty.ok, false);
});

test("vista da stampare: orientamento della mappa, verticale se non detto, ridondanze marcate dall'albero", () => {
  const m = model(
    [node("dev:1", "router", "R"), node("dev:2", "switch", "S1"), node("dev:3", "switch", "S2")],
    [link({ id: "a", a: "dev:1", b: "dev:2" }), link({ id: "b", a: "dev:1", b: "dev:3" }), link({ id: "c", a: "dev:2", b: "dev:3", source: "mac_table", sources: ["mac_table"] })],
  );
  const map = { name: "Sede", kind: "passo" as const, roots: ["dev:1"], head_node: null };
  const lr = buildPrintView(m, 3, { map, nodes: ["dev:1", "dev:2", "dev:3"], tweaks: [] }, false);
  assert.ok(lr.ok);
  if (!lr.ok) return;
  assert.equal(lr.orientation, "lr");
  assert.equal(lr.layout.orientation, "lr");
  assert.equal(lr.title, "Sede");
  assert.deepEqual(lr.tree.links.filter((l) => l.redundant).map((l) => l.id), ["c"]);
  const tb = buildPrintView(m, 3, { map, nodes: ["dev:1", "dev:2", "dev:3"], tweaks: [], orientation: "tb" }, false);
  assert.ok(tb.ok && tb.layout.orientation === "tb");
});

// Task 5, visto nel PDF: «1G · ⚡ 1,7 W» più lunga del braccio verso il figlio toccava il tronco. A schermo
// va a capo fra una parola e l'altra (lrLabelMaxWidth); in stampa uguale.
test("scritta della linea in verticale: va a capo fra un pezzo e l'altro se non ci sta", () => {
  assert.deepEqual(wrapLabel(["1G", "⚡ 1,7 W"], 200), ["1G · ⚡ 1,7 W"]);
  assert.deepEqual(wrapLabel(["1G", "⚡ 1,7 W"], 60), ["1G ·", "⚡ 1,7 W"]);
  // Un pezzo più largo dello spazio resta intero (non si spezza «⚡ 1,7 W»).
  assert.deepEqual(wrapLabel(["10G", "⚡ 12,5 W", "★"], 40), ["10G ·", "⚡ 12,5 W ·", "★"]);
  assert.deepEqual(wrapLabel([], 60), []);
});

test("M-4: «⇄ N» a schermo e l'elenco «Cavi di ridondanza» contano la stessa cosa: i cavi verso gli attaccati no", () => {
  // SRV-5 è un attaccato (riga dell'elenco sotto SW-B): a schermo il suo cavo di ridondanza non si disegna.
  const tree: TreeResult = {
    roots: ["dev:1"],
    children: new Map([["dev:1", ["dev:2", "dev:3"]], ["dev:2", []], ["dev:3", ["dev:5"]], ["dev:5", []]]),
    via: new Map(),
    links: [
      link({ id: "l1", a: "dev:1", b: "dev:2" }), link({ id: "l2", a: "dev:1", b: "dev:3" }), link({ id: "l3", a: "dev:3", b: "dev:5" }),
      link({ id: "r1", a: "dev:2", b: "dev:3", redundant: true }),
      link({ id: "r2", a: "dev:2", b: "dev:5", redundant: true }),
    ],
  };
  const nodes = boxes(["dev:1", "dev:2", "dev:3"], ["dev:5"]);
  const cables = redundantCables(tree, nodes, (id) => id);
  const counts = redundancyCounts(drawableLinks(tree.links, nodes));
  assert.deepEqual(cables.map((c) => c.id), ["r1"]);
  assert.deepEqual([counts.get("dev:2"), counts.get("dev:3"), counts.get("dev:5")], [1, 1, undefined]);
  for (const [id, n] of counts) assert.equal(n, cables.filter((c) => c.from === id || c.to === id).length, id);
});

// Prova I31 (ADR 0012 punto 1): schermo e stampa con la stessa geometria, `latiVicini` unica fonte dei lati.
test("I31 — un figlio spostato a mano dall'altra parte: in stampa sul lato più vicino, come a schermo; un figlio al suo posto: i gradini di oggi", () => {
  const padre = { x: 0, y: 0, w: 200, h: 44 }, spostato = { x: 0, y: 200, w: 180, h: 44 }, alSuoPosto = { x: 304, y: 100, w: 180, h: 44 };
  const l = latiVicini(padre, spostato, "lr", []);
  assert.deepEqual(puntiLineaAlbero("lr", padre, spostato, []), percorso(padre, l.da, spostato, l.a));
  assert.deepEqual(puntiLineaAlbero("lr", padre, alSuoPosto, []), stepPoints("lr", padre, alSuoPosto));
});

// Revisione finale di T1 (dubbio del Task 8): in stampa la parola della linea di un figlio spostato a mano dall'altra parte
// la metteva `edgeLabelAt`, fatta per il tronco: in fondo alla linea, dentro il riquadro del figlio, sopra la sua seconda
// riga. A schermo sta vicino alla metà del percorso, fuori dai riquadri (`redundantLabelAt`): in stampa lo stesso.
test("I31 — la parola della linea di un figlio spostato a mano: in stampa fuori dai riquadri, come a schermo", () => {
  const padre = { x: 0, y: 300, w: 200, h: 44 }, spostato = { x: 0, y: 0, w: 180, h: 44 };
  const pts = puntiLineaAlbero("lr", padre, spostato, []);
  const riquadri = labelBoxes([{ ...padre, role: "box" as const }, { ...spostato, role: "box" as const }], []);
  const testo = "1G · lldp";
  const at = parolaLineaSpostata(pts, testo, riquadri);
  assert.equal(at.anchor, "middle");
  // Il testo di corpo 13 sta fra 12 px sopra la linea di base e 4 sotto.
  const w = testo.length * CHAR_W + 8;
  const parola = { x: at.x - w / 2, y: at.y - 12, w, h: 16 };
  const tocca = (r: { x: number; y: number; w: number; h: number }) =>
    parola.x < r.x + r.w && r.x < parola.x + parola.w && parola.y < r.y + r.h && r.y < parola.y + parola.h;
  assert.deepEqual(riquadri.filter(tocca), []);
  assert.equal(at.y > spostato.y + spostato.h && at.y < padre.y, true, "fra i due riquadri, sulla linea");
});
