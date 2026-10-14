import { test } from "node:test";
import assert from "node:assert/strict";
import { edgeLook } from "@/lib/topology/edge-look";
import { LINK_ATTRS_DEFAULT, type MapLink, type MapNode, type TopologyModel } from "@/lib/topology/model-types";
import { GREY, INK, PAPER, edgeLabelAt, printStrokes, redundantCables, stepPoints, wrapLabel } from "@/lib/topology/print-draw";
import { buildPrintView } from "@/lib/topology/print-view";
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
  const rows = redundantCables(tree, new Set(["dev:1", "dev:2", "dev:3", "dev:4"]), (id) => names[id] ?? id);
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
