// Task 2b: un solo calcolo della mappa (modello → albero → disposizione) per lo schermo e per la stampa,
// e la riga «DNS: …» che allunga il riquadro nei due orientamenti. Dati inventati con la forma vera.
import { test } from "node:test";
import assert from "node:assert/strict";
import { VISTA_NUOVA_NON_DISEGNATA, computeMapView, computeMapViewProtetta, type MapComputeInput } from "@/lib/topology/map-compute";
import { buildPrintView } from "@/lib/topology/print-view";
import { drawingBoxes } from "@/lib/topology/print-draw";
import { BOX_H, DNS_H, headHeight, layoutTree, nodeWidth, type LayoutResult } from "@/lib/topology/tree-layout";
import { LINK_ATTRS_DEFAULT, type MapLink, type MapNode, type MapVm, type TopologyModel } from "@/lib/topology/model-types";
import type { TreeResult } from "@/lib/topology/tree";

function node(id: string, type: string, over: Partial<MapNode> = {}): MapNode {
  const [k, n] = id.split(":");
  return {
    id, kind: k === "dev" ? "device" : "host", refId: Number(n), name: id, type, mgmtIp: null,
    fusedHostIds: [], addresses: [], aliases: [], siteId: null, rackId: null, siteProposed: false, hidden: false, vendor: null, ...over,
  };
}
const link = (id: string, a: string, b: string): MapLink => ({
  id, a, aPort: "p1", b, bPort: "p2", source: "lldp", sources: ["lldp"], uplinkFrom: null, lastSeen: null, daysUnseen: null, stale: false, ...LINK_ATTRS_DEFAULT,
});
const vm = (id: string, hyp: string): MapVm => ({ id, name: id, status: "running", ips: [], hypervisorNodeId: hyp, nodeId: null, scannedAt: null });
function model(nodes: MapNode[], links: MapLink[], vms: MapVm[] = []): TopologyModel {
  return {
    nodes, links, sites: [], promote: [], unmatched: [], isolated: [], suspicious: [], withoutSite: [],
    counts: {} as TopologyModel["counts"], portClients: [], clientCount: {}, canonical: {}, vms,
  };
}
const M = model(
  [node("dev:1", "router"), node("dev:2", "switch"), node("dev:3", "hypervisor", { name: "PVE-GIU", dnsName: "pve-02.esempio" })],
  [link("a", "dev:1", "dev:2"), link("b", "dev:2", "dev:3")],
  [vm("vm:3:100", "dev:3"), vm("vm:3:101", "dev:3")],
);
const ser = (v: { layout: { nodes: Map<string, unknown>; vmChips: unknown[]; width: number; height: number } }) =>
  JSON.stringify({ n: [...v.layout.nodes.entries()], c: v.layout.vmChips, w: v.layout.width, h: v.layout.height });

test("schermo e stampa: stesso calcolo, stessa disposizione (mappa automatica e passo passo)", () => {
  for (const orientation of ["lr", "tb"] as const) {
    const screen = computeMapView(M, { auto: true, members: [], roots: [], head: "dev:1", tweaks: [], expanded: new Set(), orientation });
    const paper = buildPrintView(M, "auto", { map: { name: "x", kind: "auto", roots: [], head_node: "dev:1" }, nodes: [], tweaks: [], orientation }, false);
    assert.ok(paper.ok);
    if (!paper.ok) return;
    assert.equal(ser(paper), ser(screen));
    const passo = computeMapView(M, { auto: false, members: ["dev:1", "dev:2", "dev:3"], roots: ["dev:1"], head: null, tweaks: [], expanded: new Set(), orientation });
    const carta = buildPrintView(M, 4, { map: { name: "x", kind: "passo", roots: ["dev:1"], head_node: null }, nodes: ["dev:1", "dev:2", "dev:3"], tweaks: [], orientation }, false);
    assert.ok(carta.ok && ser(carta) === ser(passo));
  }
});

// Verifica a schermo di T1 (15/10, copia del cliente A): nella mappa passo passo della sede 1 il router di testa,
// trascinato in alto, porta con sé il suo ramo e tre riquadri finiscono sopra l'origine. Lo schermo li mostra; la
// stampa A3, «foglio unico», partiva da 0 e li perdeva. In stampa la disposizione si sposta tutta insieme.
test("stampa: un ritocco che porta un ramo sopra o a sinistra dell'origine sta tutto nel foglio, con le distanze dello schermo", () => {
  for (const orientation of ["lr", "tb"] as const) {
    const t = { nodeId: "dev:1", x: -400, y: -300, sig: "|", orientation };
    const nodes = ["dev:1", "dev:2", "dev:3"];
    const screen = computeMapView(M, { auto: false, members: nodes, roots: ["dev:1"], head: null, tweaks: [t], expanded: new Set(), orientation });
    const carta = buildPrintView(M, 4, { map: { name: "x", kind: "passo", roots: ["dev:1"], head_node: null }, nodes, tweaks: [t], orientation }, false);
    assert.ok(carta.ok);
    if (!carta.ok) return;
    const foglio: LayoutResult = carta.layout;
    assert.ok([...screen.layout.nodes.values()].some((n) => n.x < 0 && n.y < 0), "a schermo il ramo sta in negativo");
    for (const b of drawingBoxes(foglio)) {
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= foglio.width && b.y + b.h <= foglio.height, JSON.stringify(b));
    }
    const s1 = screen.layout.nodes.get("dev:1")!, c1 = foglio.nodes.get("dev:1")!;
    for (const [id, n] of screen.layout.nodes) {
      const c = foglio.nodes.get(id)!;
      assert.deepEqual([c.x - c1.x, c.y - c1.y, c.w, c.h], [n.x - s1.x, n.y - s1.y, n.w, n.h], id);
    }
  }
});

test("il ritocco in sospeso dello schermo vale al posto di quello salvato dello stesso oggetto", () => {
  const saved = { nodeId: "dev:2", x: 500, y: 500, sig: "", orientation: "lr" as const };
  const own = { nodeId: "dev:2", x: 700, y: 700, sig: "", orientation: "lr" as const };
  const v = computeMapView(M, { auto: true, members: [], roots: [], head: "dev:1", tweaks: [saved], ownTweaks: [own], expanded: new Set(), orientation: "lr" });
  assert.deepEqual(v.tweaks, [own]);
});

test("più ritocchi in sospeso (un padre trascinato col suo ramo): ognuno vale al posto del suo salvato, gli altri restano", () => {
  const s2 = { nodeId: "dev:2", x: 500, y: 500, sig: "", orientation: "lr" as const };
  const s3 = { nodeId: "dev:3", x: 600, y: 600, sig: "", orientation: "lr" as const };
  const s9 = { nodeId: "dev:9", x: 10, y: 10, sig: "", orientation: "lr" as const };
  const o2 = { ...s2, x: 520 }, o3 = { ...s3, x: 620 };
  const v = computeMapView(M, { auto: true, members: [], roots: [], head: "dev:1", tweaks: [s2, s3, s9], ownTweaks: [o2, o3], expanded: new Set(), orientation: "lr" });
  assert.deepEqual(v.tweaks, [s9, o2, o3]);
});

test("«con le VM»: si aprono tutti gli hypervisor visibili; la testa scelta e quella proposta si distinguono", () => {
  const v = computeMapView(M, { auto: true, members: [], roots: [], head: null, tweaks: [], expanded: "tutti", orientation: "lr" });
  assert.deepEqual([...v.expanded], ["dev:3"]);
  assert.equal(v.layout.vmChips.length, 2);
  assert.deepEqual([v.head, v.headChosen], ["dev:1", false]);
  const scelta = computeMapView(M, { auto: true, members: [], roots: [], head: "dev:2", tweaks: [], expanded: new Set(), orientation: "lr" });
  assert.deepEqual([scelta.head, scelta.headChosen], ["dev:2", true]);
});

test("riga «DNS:»: il riquadro è più alto di DNS_H e le VM aperte partono sotto, nei due orientamenti", () => {
  assert.ok(DNS_H >= 13);
  assert.equal(headHeight({ dnsName: "x" }), BOX_H + DNS_H);
  assert.equal(headHeight({}), BOX_H);
  const t: TreeResult = { roots: ["dev:2"], children: new Map([["dev:2", ["dev:3"]], ["dev:3", []]]), via: new Map(), links: [] };
  for (const o of ["lr", "tb"] as const) {
    const chiuso = layoutTree(M, t, [], new Set(), o);
    assert.equal(chiuso.nodes.get("dev:3")!.h, BOX_H + DNS_H, o);
    assert.equal(chiuso.nodes.get("dev:2")!.h, BOX_H, o);
    const aperto = layoutTree(M, t, [], new Set(["dev:3"]), o);
    const box = aperto.nodes.get("dev:3")!;
    assert.equal(Math.min(...aperto.vmChips.map((c) => c.y)), box.y + BOX_H + DNS_H + 6, o);
    assert.ok(box.h >= BOX_H + DNS_H + 12, o);
  }
});

test("riga «DNS:»: il riquadro è largo abbastanza anche per il nome DNS, se è più lungo", () => {
  const lungo = model([node("dev:3", "hypervisor", { name: "PX", dnsName: "un-nome-dns-molto-lungo.dominio.locale" })], []);
  const t: TreeResult = { roots: ["dev:3"], children: new Map([["dev:3", []]]), via: new Map(), links: [] };
  const w = layoutTree(lungo, t, [], new Set(), "lr").nodes.get("dev:3")!.w;
  assert.equal(w, nodeWidth("DNS: un-nome-dns-molto-lungo.dominio.locale"));
});

/**
 * Revisione finale di T3 (M7): il calcolo della vista nel browser non aveva ripiego. Il server ripiega sulla mappa di prima se
 * il modello per cavo cade (Caso 3), ma un errore nell'albero della pagina (`alberoDellaPagina`, solo con `cavi`) lasciava la
 * pagina bianca. Con la mappa nuova, un errore ricalcola la vista senza `cavi` e senza `cavo` (l'albero di T1) e lo dice con la
 * stessa scritta della barra; senza `cavi` il calcolo è quello di sempre, errori compresi.
 */
test("M7: con la mappa nuova un errore nel calcolo della vista ripiega sulla mappa di prima e lo dice; spenta, il calcolo di sempre", () => {
  const inp: MapComputeInput = { auto: true, members: [], roots: [], head: "dev:1", tweaks: [], expanded: new Set(), orientation: "lr" };
  const cavo = { genere: "cavo" as const, stato: null, fiducia: "certo" as const, porteDaVerificare: false, detti: [], frasi: [] };
  const rotto: TopologyModel = { ...M, links: M.links.map((l) => ({ ...l, cavo })), cavi: { segmenti: null } as unknown as TopologyModel["cavi"] };
  assert.throws(() => computeMapView(rotto, inp), "senza il ripiego la pagina cadeva");
  const r = computeMapViewProtetta(rotto, inp);
  assert.ok(r.errore?.startsWith(VISTA_NUOVA_NON_DISEGNATA), r.errore ?? "nessun errore");
  assert.equal(r.vista.model.cavi, undefined);
  assert.equal(r.vista.model.links.some((l) => l.cavo !== undefined), false);
  assert.equal(ser(r.vista), ser(computeMapView(M, inp)), "la vista è quella del modello senza la mappa nuova");
  const spenta = computeMapViewProtetta(M, inp);
  assert.deepEqual([spenta.errore, ser(spenta.vista)], [null, ser(computeMapView(M, inp))]);
  assert.throws(() => computeMapViewProtetta({ ...M, nodes: null } as unknown as TopologyModel, inp), "spenta, un errore esce come prima");
});
