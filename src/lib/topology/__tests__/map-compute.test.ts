// Task 2b: un solo calcolo della mappa (modello → albero → disposizione) per lo schermo e per la stampa,
// e la riga «DNS: …» che allunga il riquadro nei due orientamenti. Dati inventati con la forma vera.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMapView } from "@/lib/topology/map-compute";
import { buildPrintView } from "@/lib/topology/print-view";
import { BOX_H, DNS_H, headHeight, layoutTree, nodeWidth } from "@/lib/topology/tree-layout";
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

test("il ritocco in sospeso dello schermo vale al posto di quello salvato dello stesso oggetto", () => {
  const saved = { nodeId: "dev:2", x: 500, y: 500, sig: "", orientation: "lr" as const };
  const own = { nodeId: "dev:2", x: 700, y: 700, sig: "", orientation: "lr" as const };
  const v = computeMapView(M, { auto: true, members: [], roots: [], head: "dev:1", tweaks: [saved], ownTweak: own, expanded: new Set(), orientation: "lr" });
  assert.deepEqual(v.tweaks, [own]);
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
