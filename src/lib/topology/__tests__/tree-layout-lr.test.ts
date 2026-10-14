import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AP_COLS_LR, AP_W, ATT_INDENT, ATT_MAX, ATT_ROW, BOX_H, LEVEL_GAP_LR, MARGIN, ROOT_GAP, VM_COLS_LR, VM_W,
  fitLabel, layoutTree, nodeWidth, type LayoutResult, type SavedTweak,
} from "@/lib/topology/tree-layout";
import type { TreeResult } from "@/lib/topology/tree";
import type { MapNode, MapVm, TopologyModel } from "@/lib/topology/model-types";

// Dati inventati con la forma vera. Disposizione «Verticale» (lr), spec topologia §12.2.
function node(id: string, type: string, name = id): MapNode {
  const [k, n] = id.split(":");
  return {
    id, kind: k === "dev" ? "device" : "host", refId: Number(n), name, type, mgmtIp: null,
    fusedHostIds: [], addresses: [], aliases: [], siteId: null, rackId: null, siteProposed: false, hidden: false, vendor: null,
  };
}
function model(nodes: MapNode[], vms: MapVm[] = []): TopologyModel {
  return {
    nodes, links: [], sites: [], promote: [], unmatched: [], isolated: [], suspicious: [], withoutSite: [],
    counts: {} as TopologyModel["counts"], portClients: [], clientCount: {}, canonical: {}, vms,
  };
}
function tree(roots: string[], kids: Record<string, string[]>): TreeResult {
  const children = new Map<string, string[]>();
  for (const [p, ks] of Object.entries(kids)) { children.set(p, ks); for (const k of ks) if (!children.has(k)) children.set(k, []); }
  for (const r of roots) if (!children.has(r)) children.set(r, []);
  return { roots, children, via: new Map(), links: [] };
}
const ser = (r: LayoutResult) => JSON.stringify({ n: [...r.nodes.entries()], g: r.apGroups, m: [...r.moreAttached.entries()], c: r.vmChips, w: r.width, h: r.height, e: r.expired });
const seq = (prefix: string, from: number, n: number) => Array.from({ length: n }, (_, i) => `${prefix}:${from + i}`);
type Rect = { id: string; x: number; y: number; w: number; h: number };
function assertNoOverlap(rects: Rect[]) {
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
    assert.ok(apart, `${a.id} e ${b.id} si sovrappongono`);
  }
}
const allRects = (r: LayoutResult): Rect[] => [...r.nodes.values()];
const lr = (m: TopologyModel, t: TreeResult, tw: SavedTweak[] = [], ex: ReadonlySet<string> = new Set()) => layoutTree(m, t, tw, ex, "lr");

/** Radice con 60 switch figli, di cui alcuni con nome lungo (colonna larga quanto il più largo). */
function centrale() {
  const kids = seq("dev", 2, 60);
  const nodes = [node("dev:1", "router", "Centrale"), ...kids.map((k, i) => node(k, "switch", i === 7 ? `Switch-con-nome-molto-lungo-${"x".repeat(40)}` : `SW-${i}`))];
  return { m: model(nodes), t: tree(["dev:1"], { "dev:1": kids }), kids };
}

test("il predefinito è lr; stessi dati, stesse coordinate", () => {
  const { m, t } = centrale();
  assert.equal(ser(lr(m, t)), ser(lr(m, t)));
  assert.equal(ser(layoutTree(m, t, [])), ser(lr(m, t)));
  assert.equal(lr(m, t).orientation, "lr");
  assert.equal(layoutTree(m, t, [], new Set(), "tb").orientation, "tb");
});

test("un genitore con 60 figli: niente sovrapposizioni, figli nella stessa colonna, genitore a metà", () => {
  const { m, t, kids } = centrale();
  const r = lr(m, t);
  assertNoOverlap(allRects(r));
  const xs = new Set(kids.map((k) => r.nodes.get(k)!.x));
  assert.equal(xs.size, 1, "tutti i figli alla stessa x");
  const root = r.nodes.get("dev:1")!;
  assert.equal(root.x, MARGIN);
  const colW = Math.max(...kids.map((k) => r.nodes.get(k)!.w));
  assert.equal(colW, nodeWidth(`Switch-con-nome-molto-lungo-${"x".repeat(40)}`));
  assert.equal([...xs][0], MARGIN + root.w + LEVEL_GAP_LR);
  const byY = kids.map((k) => r.nodes.get(k)!).sort((a, b) => a.y - b.y);
  const first = byY[0], last = byY[59];
  const mid = (first.y + first.h / 2 + last.y + last.h / 2) / 2;
  assert.ok(Math.abs(root.y + root.h / 2 - mid) < 0.001);
  for (let i = 1; i < byY.length; i++) assert.ok(byY[i].y >= byY[i - 1].y + byY[i - 1].h, "impilati");
});

test("la colonna dei figli parte dopo la più larga della colonna del genitore, anche se i figli sono più stretti", () => {
  const nodes = [node("dev:1", "router", "R".repeat(60)), node("dev:2", "switch", "a")];
  const r = lr(model(nodes), tree(["dev:1"], { "dev:1": ["dev:2"] }));
  assert.equal(r.nodes.get("dev:2")!.x, MARGIN + nodeWidth("R".repeat(60)) + LEVEL_GAP_LR);
});

test("hypervisor espanso con 7 VM: si allarga la sua colonna, le colonne dopo scorrono, VM dentro il riquadro", () => {
  const vm = (i: number): MapVm => ({
    id: `vm:5:${100 + i}`, name: i === 3 ? `macchina-virtuale-${"w".repeat(40)}` : `vm-${i}`, hypervisorNodeId: "dev:5",
  } as unknown as MapVm);
  const vms = Array.from({ length: 7 }, (_, i) => vm(i));
  const nodes = [
    node("dev:1", "router", "R"), node("dev:5", "hypervisor", "Px"), node("dev:6", "switch", "Sotto"),
    node("dev:2", "switch", "Fratello"),
  ];
  const m = model(nodes, vms);
  const t = tree(["dev:1"], { "dev:1": ["dev:2", "dev:5"], "dev:5": ["dev:6"] });
  const chiuso = lr(m, t);
  const aperto = lr(m, t, [], new Set(["dev:5"]));
  const h = aperto.nodes.get("dev:5")!;
  assert.equal(h.w, VM_COLS_LR * (VM_W + 8) + 16);
  assert.equal(h.h, BOX_H + 12 + Math.ceil(7 / VM_COLS_LR) * 26);
  // la colonna 1 si allarga (anche il fratello, nella stessa colonna, ne ha lo spazio): quella dopo scorre di quanto
  const scarto = aperto.nodes.get("dev:6")!.x - chiuso.nodes.get("dev:6")!.x;
  assert.equal(scarto, h.w - chiuso.nodes.get("dev:5")!.w);
  assert.ok(scarto > 0);
  assert.equal(aperto.nodes.get("dev:1")!.x, chiuso.nodes.get("dev:1")!.x);
  assert.equal(aperto.nodes.get("dev:2")!.x, aperto.nodes.get("dev:5")!.x);
  assertNoOverlap(allRects(aperto));
  assert.equal(aperto.vmChips.length, 7);
  for (const c of aperto.vmChips) {
    assert.ok(c.x >= h.x && c.x + c.w <= h.x + h.w && c.y >= h.y && c.y + c.h <= h.y + h.h, `${c.vmId} dentro il riquadro`);
    assert.ok(c.label.length * 7 + 44 <= c.w + 44);
  }
  const lunga = aperto.vmChips.find((c) => c.vmId === "vm:5:103")!;
  assert.equal(lunga.label, fitLabel(vms[3].name, VM_W));
  assert.ok(lunga.label.endsWith("…"));
  assert.equal(new Set(aperto.vmChips.map((c) => c.x)).size, VM_COLS_LR);
});

test("attaccati in elenco sotto il riquadro con rientro; oltre ATT_MAX «+ altri N»", () => {
  const att = seq("host", 10, 7);
  const nodes = [node("dev:1", "switch", "S"), ...att.map((a) => node(a, "client"))];
  const r = lr(model(nodes), tree(["dev:1"], { "dev:1": att }));
  const b = r.nodes.get("dev:1")!;
  const shown = att.slice(0, ATT_MAX).map((a) => r.nodes.get(a)!);
  shown.forEach((a, i) => {
    assert.equal(a.role, "attached");
    assert.equal(a.x, b.x + ATT_INDENT);
    assert.equal(a.y, b.y + b.h + 4 + i * ATT_ROW);
  });
  assert.equal(att.filter((a) => r.nodes.has(a)).length, ATT_MAX);
  assert.equal(r.moreAttached.get("dev:1"), 3);
  assertNoOverlap(allRects(r));
});

test("un attaccato non sposta il fratello sotto: i blocchi si impilano senza sovrapporsi", () => {
  const att = seq("host", 10, 5);
  const nodes = [node("dev:1", "router", "R"), node("dev:2", "switch", "A"), node("dev:3", "switch", "B"), ...att.map((a) => node(a, "client"))];
  const r = lr(model(nodes), tree(["dev:1"], { "dev:1": ["dev:2", "dev:3"], "dev:2": att }));
  assertNoOverlap(allRects(r));
  const a = r.nodes.get("dev:2")!, b = r.nodes.get("dev:3")!;
  assert.ok(b.y >= a.y + a.h + 4 + (ATT_MAX + 1) * ATT_ROW, "B comincia dopo l'ultima riga di A");
});

test("gruppo AP: 2 colonne nella colonna dei figli, come un figlio in più", () => {
  const aps = seq("dev", 10, 5);
  const nodes = [node("dev:1", "router", "R"), node("dev:2", "switch", "S"), ...aps.map((a) => node(a, "access_point"))];
  const r = lr(model(nodes), tree(["dev:1"], { "dev:1": ["dev:2", ...aps] }));
  assertNoOverlap(allRects(r));
  const g = r.apGroups.find((x) => x.parent === "dev:1")!;
  const s = r.nodes.get("dev:2")!;
  assert.equal(g.x, s.x, "il gruppo sta nella colonna dei figli");
  assert.equal(g.w, AP_COLS_LR * (AP_W + 8));
  assert.equal(new Set(aps.map((a) => r.nodes.get(a)!.x)).size, AP_COLS_LR);
  for (const a of aps) {
    const n = r.nodes.get(a)!;
    assert.ok(n.x >= g.x && n.x + n.w <= g.x + g.w && n.y >= g.y && n.y + n.h <= g.y + g.h);
  }
  assert.ok(g.y >= s.y + s.h, "il gruppo viene dopo l'infrastruttura");
  // la colonna dei figli è larga quanto il gruppo AP
  const root = r.nodes.get("dev:1")!;
  assert.equal(g.x, MARGIN + root.w + LEVEL_GAP_LR);
});

test("tre partenze una sotto l'altra, ROOT_GAP fra le fette, senza sovrapposizioni", () => {
  const nodes = [node("dev:1", "switch", "A"), node("dev:2", "switch", "B"), node("dev:3", "switch", "C"), node("dev:4", "switch", "Af"), node("dev:5", "switch", "Af2")];
  const t = tree(["dev:1", "dev:2", "dev:3"], { "dev:1": ["dev:4", "dev:5"] });
  const r = lr(model(nodes), t);
  assertNoOverlap(allRects(r));
  const [a, b, c] = ["dev:1", "dev:2", "dev:3"].map((i) => r.nodes.get(i)!);
  assert.deepEqual([a.x, b.x, c.x], [MARGIN, MARGIN, MARGIN]);
  const f5 = r.nodes.get("dev:5")!;
  assert.equal(b.y, f5.y + f5.h + ROOT_GAP, "la seconda partenza comincia ROOT_GAP dopo la fetta della prima");
  assert.equal(c.y, b.y + b.h + ROOT_GAP);
});

test("ritocchi: quello tb si ignora in lr e non scade; quello lr sposta tutto il ramo; senza orientamento vale tb", () => {
  const aps = seq("dev", 10, 3);
  const nodes = [node("dev:1", "router", "R"), node("dev:2", "switch", "S"), ...aps.map((a) => node(a, "access_point"))];
  const m = model(nodes);
  const t = tree(["dev:1"], { "dev:1": ["dev:2"], "dev:2": aps });
  const base = lr(m, t);
  const s = base.nodes.get("dev:2")!;
  const sig = "dev:1|dev:2";
  const tb: SavedTweak = { nodeId: "dev:2", x: s.x + 500, y: s.y + 500, sig, orientation: "tb" };
  const senza: SavedTweak = { nodeId: "dev:2", x: s.x + 500, y: s.y + 500, sig };
  const ignorato = lr(m, t, [tb, senza]);
  assert.deepEqual(ignorato.expired, []);
  assert.equal(ser(ignorato), ser(base));
  // tornando in orizzontale il ritocco ricompare
  const orizz = layoutTree(m, t, [tb], new Set(), "tb");
  assert.equal(orizz.nodes.get("dev:2")!.x, s.x + 500);
  const mio: SavedTweak = { nodeId: "dev:2", x: s.x + 37, y: s.y + 11, sig, orientation: "lr" };
  const r = lr(m, t, [mio]);
  assert.deepEqual(r.expired, []);
  for (const id of ["dev:2", ...aps]) {
    assert.equal(r.nodes.get(id)!.x - base.nodes.get(id)!.x, 37, id);
    assert.equal(r.nodes.get(id)!.y - base.nodes.get(id)!.y, 11, id);
  }
  const g0 = base.apGroups[0], g1 = r.apGroups[0];
  assert.equal(g1.x - g0.x, 37);
  assert.deepEqual(r.nodes.get("dev:1"), base.nodes.get("dev:1"));
  // un ritocco lr con firma cambiata scade, uno tb con firma cambiata no (non è il suo orientamento)
  const scaduto = lr(m, t, [{ ...mio, sig: "altra|firma" }, { ...tb, nodeId: "dev:1", sig: "x" }]);
  assert.deepEqual(scaduto.expired, ["dev:2"]);
});

test("width e height coprono tutto, margini compresi", () => {
  const { m, t } = centrale();
  const r = lr(m, t);
  const maxX = Math.max(...allRects(r).map((n) => n.x + n.w));
  const maxY = Math.max(...allRects(r).map((n) => n.y + n.h));
  assert.equal(r.width, maxX + MARGIN);
  assert.equal(r.height, maxY + MARGIN);
});
