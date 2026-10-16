import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AP_COLS, ATT_MAX, BOX_H, CHAR_W, VM_COLS, VM_W, fitLabel, layoutTree as layoutTreeCon, nodeWidth, structureSig,
  type LayoutResult, type SavedTweak,
} from "@/lib/topology/tree-layout";
import type { TreeResult } from "@/lib/topology/tree";
import type { MapNode, MapVm, TopologyModel } from "@/lib/topology/model-types";

/** Queste prove sono dell'orizzontale (`tb`): le coordinate di prima, esplicite. Il verticale è in tree-layout-lr.test.ts. */
const layoutTree = (m: TopologyModel, t: TreeResult, tw: SavedTweak[], ex: ReadonlySet<string> = new Set()) =>
  layoutTreeCon(m, t, tw, ex, "tb");

function node(id: string, type: string, name = id): MapNode {
  const [k, n] = id.split(":");
  return {
    id, kind: k === "dev" ? "device" : "host", refId: Number(n), name, type, mgmtIp: null,
    fusedHostIds: [], addresses: [], aliases: [], siteId: null, rackId: null, siteProposed: false, hidden: false, vendor: null,
  };
}
function model(nodes: MapNode[]): TopologyModel {
  return {
    nodes, links: [], sites: [], promote: [], unmatched: [], isolated: [], suspicious: [], withoutSite: [],
    counts: {} as TopologyModel["counts"], portClients: [], clientCount: {}, canonical: {}, vms: [],
  };
}
/** Albero a mano: ogni id nei valori è anche una chiave (foglie con []). */
function tree(roots: string[], kids: Record<string, string[]>): TreeResult {
  const children = new Map<string, string[]>();
  for (const [p, ks] of Object.entries(kids)) { children.set(p, ks); for (const k of ks) if (!children.has(k)) children.set(k, []); }
  for (const r of roots) if (!children.has(r)) children.set(r, []);
  return { roots, children, via: new Map(), links: [] };
}
const ser = (r: LayoutResult) => JSON.stringify({ n: [...r.nodes.entries()], g: r.apGroups, m: [...r.moreAttached.entries()], c: r.vmChips, w: r.width, h: r.height, e: r.expired });
const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}:${i + 1}`);

/** R con due switch: S (con n AP) e X (con un figlio switch). */
function scenario(apCount: number) {
  const aps = ids("dev:10", 0).concat(Array.from({ length: apCount }, (_, i) => `dev:${100 + i}`));
  const nodes = [
    node("dev:1", "router", "R"), node("dev:2", "switch", "S"), node("dev:3", "switch", "X"), node("dev:4", "switch", "Xfiglio"),
    ...aps.map((a) => node(a, "access_point")),
  ];
  return { m: model(nodes), t: tree(["dev:1"], { "dev:1": ["dev:2", "dev:3"], "dev:2": aps, "dev:3": ["dev:4"] }) };
}

test("stessi dati, stesse coordinate", () => {
  const { m, t } = scenario(6);
  assert.equal(ser(layoutTree(m, t, [])), ser(layoutTree(m, t, [])));
});

test("un AP in più non sposta gli altri rami: il gruppo occupa sempre AP_COLS colonne", () => {
  const branch = ["dev:3", "dev:4"];
  const at = (n: number) => { const s = scenario(n); return layoutTree(s.m, s.t, []); };
  const r3 = at(3), r4 = at(4), r5 = at(5);
  for (const id of branch) assert.deepEqual(r4.nodes.get(id), r3.nodes.get(id));
  assert.equal(AP_COLS, 4);
  // con 5 AP cresce solo l'altezza: X e il suo ramo (livelli 1-2) restano dove sono
  for (const id of branch) assert.deepEqual(r5.nodes.get(id), r4.nodes.get(id));
  assert.equal(r5.width, r4.width);
  assert.ok(r5.height > r4.height);
});

test("nessuna scritta esce dal nodo; un nome di 80 caratteri finisce con «…»", () => {
  const long = "x".repeat(80);
  const names = ["a", "Switch-corto", "Un-nome-medio-lungo-per-uno-switch", long];
  const nodes = names.map((n, i) => node(`dev:${i + 1}`, i === 0 ? "router" : "switch", n));
  const t = tree(["dev:1"], { "dev:1": ["dev:2", "dev:3", "dev:4"] });
  const r = layoutTree(model(nodes), t, []);
  let boxes = 0;
  for (const n of r.nodes.values()) {
    if (n.role !== "box") continue;
    boxes++;
    const name = nodes.find((x) => x.id === n.id)!.name;
    assert.ok(fitLabel(name, n.w).length * CHAR_W + 44 <= n.w, name);
  }
  assert.equal(boxes, 4);
  assert.equal(nodeWidth(long), 230);
  assert.ok(fitLabel(long, 230).endsWith("…"));
  assert.ok(!fitLabel("a", 170).endsWith("…"));
});

test("fascia degli attaccati: 4 visibili a destra del riquadro, +2 contati, mai sotto il riquadro", () => {
  const servers = ids("host", 6);
  const nodes = [node("dev:1", "router", "R"), node("dev:2", "switch", "S"), node("dev:3", "switch", "T"),
    ...servers.map((s, i) => node(s, "server_linux", `srv${i}`))];
  const t = tree(["dev:1"], { "dev:1": ["dev:2", "dev:3"], "dev:2": servers });
  const r = layoutTree(model(nodes), t, []);
  const att = [...r.nodes.values()].filter((n) => n.role === "attached");
  assert.equal(att.length, ATT_MAX);
  assert.equal(r.moreAttached.get("dev:2"), 2);
  const box = r.nodes.get("dev:2")!;
  for (const a of att) {
    assert.equal(a.parent, "dev:2");
    assert.ok(a.x >= box.x + box.w, "a destra del riquadro");
  }
  // e non coprono nemmeno il fratello
  const sib = r.nodes.get("dev:3")!;
  for (const a of att) assert.ok(a.x + a.w <= sib.x || a.x >= sib.x + sib.w || a.y + a.h <= sib.y || a.y >= sib.y + sib.h);
});

test("ritocco: con la firma uguale sposta nodo e ramo dello stesso scarto; con firma diversa scade", () => {
  const { m, t } = scenario(3);
  const base = layoutTree(m, t, []);
  const sig = structureSig(t, "dev:2");
  const target = base.nodes.get("dev:2")!;
  const tw: SavedTweak = { nodeId: "dev:2", x: target.x + 37, y: target.y + 11, sig, orientation: "tb" };
  const r = layoutTree(m, t, [tw]);
  assert.deepEqual(r.expired, []);
  for (const id of ["dev:2", "dev:100", "dev:101", "dev:102"]) {
    const a = base.nodes.get(id)!, b = r.nodes.get(id)!;
    assert.equal(b.x - a.x, 37, id);
    assert.equal(b.y - a.y, 11, id);
  }
  const g0 = base.apGroups.find((g) => g.parent === "dev:2")!, g1 = r.apGroups.find((g) => g.parent === "dev:2")!;
  assert.equal(g1.x - g0.x, 37);
  assert.deepEqual(r.nodes.get("dev:3"), base.nodes.get("dev:3"));

  const stale = layoutTree(m, t, [{ ...tw, sig: "altra|firma" }, { ...tw, nodeId: "dev:3", sig: null }]);
  assert.deepEqual(stale.expired, ["dev:2", "dev:3"]);
  assert.equal(ser({ ...stale, expired: [] }), ser(base));
});

/** Centro del primo e dell'ultimo figlio (riquadri e gruppo AP): dove finisce la linea orizzontale. */
function midOfChildCentres(r: LayoutResult, t: TreeResult, p: string): number {
  const c = (t.children.get(p) ?? []).map((k) => r.nodes.get(k)).filter((n) => n?.role === "box").map((n) => n!.x + n!.w / 2);
  const g = r.apGroups.find((x) => x.parent === p);
  if (g) c.push(g.x + g.w / 2);
  return (Math.min(...c) + Math.max(...c)) / 2;
}

test("il riquadro è centrato fra il primo e l'ultimo figlio, anche con la fascia degli attaccati e il gruppo AP", () => {
  const servers = ids("host", 3);
  const nodes = [node("dev:1", "router", "R"), node("dev:2", "switch", "S"), node("dev:3", "switch", "T"),
    node("dev:4", "switch", "U"), node("dev:5", "access_point"), node("dev:6", "access_point"),
    node("dev:7", "switch", "V"), node("dev:8", "switch", "W"),
    ...servers.map((s, i) => node(s, "server_linux", `srv${i}`))];
  // R: due figli foglia + attaccati. T (altra radice): un figlio foglia + gruppo AP + attaccati.
  const t = tree(["dev:1", "dev:3"], {
    "dev:1": ["dev:2", "dev:7", "dev:8", "host:1"],
    "dev:3": ["dev:4", "dev:5", "dev:6", "host:2", "host:3"],
  });
  const r = layoutTree(model(nodes), t, []);
  for (const p of ["dev:1", "dev:3"]) {
    const box = r.nodes.get(p)!;
    const mid = midOfChildCentres(r, t, p);
    assert.ok(Math.abs(box.x + box.w / 2 - mid) <= 1, `${p}: ${box.x + box.w / 2} vs ${mid}`);
    assert.ok([...r.nodes.values()].some((n) => n.role === "attached" && n.parent === p), `${p} ha la fascia`);
  }
});

test("rami asimmetrici: il genitore sta sopra la linea dei figli, non a metà dello spazio riservato; niente si sovrappone", () => {
  // Task 12 (copia di un cliente, 13/10): il primo figlio con un ramo largo
  // spostava il centro dello spazio riservato sopra un altro figlio; la testa
  // era scostata di 749 px dalla linea dei suoi figli.
  const leaves = ids("dev:20", 0).concat(Array.from({ length: 6 }, (_, i) => `dev:${20 + i}`));
  const servers = ids("host", 6);
  const nodes = [node("dev:1", "router", "R"), node("dev:2", "switch", "Largo"), node("dev:3", "switch", "Solo"),
    node("dev:4", "switch", "Ultimo"), ...leaves.map((l) => node(l, "switch")),
    ...servers.map((h, i) => node(h, "server_linux", `srv${i}`))];
  const t = tree(["dev:1"], {
    "dev:1": ["dev:2", "dev:3", "dev:4", "host:1", "host:2"],
    "dev:2": leaves,
    "dev:4": ["host:3", "host:4", "host:5", "host:6"],
  });
  const r = layoutTree(model(nodes), t, []);
  const box = r.nodes.get("dev:1")!;
  const mid = midOfChildCentres(r, t, "dev:1");
  assert.ok(Math.abs(box.x + box.w / 2 - mid) <= 1, `R: ${box.x + box.w / 2} vs ${mid}`);
  // Niente si sovrappone allo stesso livello: riquadri e fascia degli attaccati.
  const all = [...r.nodes.values()];
  for (const a of all) for (const b of all) {
    if (a === b || a.y + a.h <= b.y || b.y + b.h <= a.y) continue;
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x, `${a.id} e ${b.id} si sovrappongono`);
  }
});

// ── Hypervisor espandibili (spec §11.5) ──────────────────────────────────────
function vmRow(i: number, hyper: string, name = `vm-${i}`): MapVm {
  return { id: `vm:9:${100 + i}`, name, status: i % 2 ? "running" : "stopped", ips: [], hypervisorNodeId: hyper, nodeId: null, scannedAt: null };
}
/** R → S1 (con S1a), S2, H (hypervisor con n VM): H è il figlio più a destra. */
function conHyper(n: number, nameOf: (i: number) => string = (i) => `vm-${i}`) {
  const nodes = [
    node("dev:1", "router", "R"), node("dev:2", "switch", "S1"), node("dev:3", "switch", "S2"), node("dev:4", "switch", "S1a"),
    node("dev:5", "server", "H"),
  ];
  nodes[4].vendor = "proxmox";
  const m = { ...model(nodes), vms: Array.from({ length: n }, (_, i) => vmRow(i, "dev:5", nameOf(i))) };
  return { m, t: tree(["dev:1"], { "dev:1": ["dev:2", "dev:3", "dev:5"], "dev:2": ["dev:4"] }) };
}

test("un hypervisor è un riquadro nella fila dei figli, non nella fascia degli attaccati", () => {
  const { m, t } = conHyper(5);
  const r = layoutTree(m, t, []);
  assert.equal(r.nodes.get("dev:5")!.role, "box");
  assert.equal(r.nodes.get("dev:5")!.y, r.nodes.get("dev:2")!.y, "sullo stesso livello degli switch");
  assert.deepEqual(r.vmChips, []);
});

test("espandere un hypervisor: x dei rami a sinistra invariata, gli altri livelli scendono solo dell'altezza in più", () => {
  const { m, t } = conHyper(7);
  const chiuso = layoutTree(m, t, []);
  const aperto = layoutTree(m, t, [], new Set(["dev:5"]));
  for (const id of ["dev:2", "dev:3", "dev:4"]) assert.equal(aperto.nodes.get(id)!.x, chiuso.nodes.get(id)!.x, `${id}: x`);
  const righe = Math.ceil(7 / VM_COLS);
  const extra = 12 + righe * 26;
  assert.equal(aperto.nodes.get("dev:5")!.h, BOX_H + extra);
  assert.equal(aperto.nodes.get("dev:5")!.w, VM_COLS * (VM_W + 8) + 16);
  assert.equal(aperto.nodes.get("dev:1")!.y, chiuso.nodes.get("dev:1")!.y, "il livello sopra non si muove");
  assert.equal(aperto.nodes.get("dev:2")!.y, chiuso.nodes.get("dev:2")!.y, "il livello dell'hypervisor comincia dov'era");
  assert.equal(aperto.nodes.get("dev:4")!.y - chiuso.nodes.get("dev:4")!.y, extra, "il livello sotto scende dell'altezza in più");
  assert.equal(aperto.height - chiuso.height, extra);
});

test("le VM sono tutte nel riquadro in griglia, e nessuna scritta esce dall'etichetta (fitLabel)", () => {
  const lungo = "una-macchina-virtuale-con-un-nome-lunghissimo-che-non-entra";
  const { m, t } = conHyper(7, (i) => (i === 3 ? lungo : `vm-${i}`));
  const r = layoutTree(m, t, [], new Set(["dev:5"]));
  const h = r.nodes.get("dev:5")!;
  assert.equal(r.vmChips.length, 7);
  assert.deepEqual(new Set(r.vmChips.map((c) => c.vmId)).size, 7);
  for (const c of r.vmChips) {
    assert.equal(c.hypervisor, "dev:5");
    assert.ok(c.x >= h.x && c.x + c.w <= h.x + h.w, "dentro il riquadro in larghezza");
    assert.ok(c.y >= h.y + BOX_H && c.y + c.h <= h.y + h.h, "sotto l'etichetta e dentro il riquadro in altezza");
    assert.ok(c.label.length * CHAR_W + 44 <= c.w, `«${c.label}» esce dal chip`);
  }
  assert.ok(r.vmChips.some((c) => c.label.endsWith("…")), "il nome lunghissimo è accorciato");
  assert.equal(new Set(r.vmChips.map((c) => c.x)).size, VM_COLS);
});

test("espandere un hypervisor senza VM o non hypervisor non cambia niente; un ritocco porta con sé le VM", () => {
  const { m, t } = conHyper(0);
  assert.equal(ser(layoutTree(m, t, [], new Set(["dev:5"]))), ser(layoutTree(m, t, [])));
  const { m: m2, t: t2 } = conHyper(4);
  assert.equal(ser(layoutTree(m2, t2, [], new Set(["dev:2"]))), ser(layoutTree(m2, t2, [])), "uno switch non si espande");
  const base = layoutTree(m2, t2, [], new Set(["dev:5"]));
  const h = base.nodes.get("dev:5")!;
  const sig = structureSig(t2, "dev:5");
  const mosso = layoutTree(m2, t2, [{ nodeId: "dev:5", x: h.x + 30, y: h.y + 50, sig, orientation: "tb" }], new Set(["dev:5"]));
  assert.equal(mosso.vmChips[0].x - base.vmChips[0].x, 30);
  assert.equal(mosso.vmChips[0].y - base.vmChips[0].y, 50);
});

// Visto a schermo il 2026-10-14 (fase 2b, Task 12): trascinando dall'elenco tre oggetti non collegati in
// tre punti della mappa passo passo, ogni rilascio aggiungeva una partenza e faceva scadere il ritocco delle
// partenze già posate (la loro firma elencava tutte le partenze): tornavano in fila in alto.
test("una partenza ritoccata resta dov'è quando si aggiunge un'altra partenza; scade se diventa figlia", () => {
  const m = model([node("dev:1", "switch"), node("dev:2", "switch"), node("dev:9", "switch")]);
  const t1 = tree(["dev:1"], {});
  const tw: SavedTweak = { nodeId: "dev:1", x: 640, y: 380, sig: structureSig(t1, "dev:1"), orientation: "tb" };
  const t2 = tree(["dev:1", "dev:9"], {});
  const r = layoutTree(m, t2, [tw]);
  assert.deepEqual(r.expired, []);
  assert.deepEqual([r.nodes.get("dev:1")!.x, r.nodes.get("dev:1")!.y], [640, 380]);
  // un ritocco salvato con la firma di prima (tutte le partenze) vale ancora finché il nodo è una partenza
  const vecchio = layoutTree(m, t2, [{ ...tw, sig: "|dev:1,dev:5" }]);
  assert.deepEqual(vecchio.expired, []);
  // se la partenza diventa figlia di un altro, la struttura è cambiata davvero: il ritocco scade
  const t3 = tree(["dev:2"], { "dev:2": ["dev:1"] });
  assert.deepEqual(layoutTree(m, t3, [tw]).expired, ["dev:1"]);
});

// Stesso difetto dell'orizzontale e del verticale (`finish` è uno solo): i ritocchi si applicavano in ordine di id
// stringa («dev:120» < «dev:78»), e lo scarto dell'antenato ritoccato si sommava una seconda volta al discendente.
test("orizzontale: il discendente ritoccato resta dove lo si lascia anche se l'antenato ritoccato ha l'id «dopo»", () => {
  const m = model([node("dev:1", "router", "R"), node("dev:78", "switch", "S1"), node("dev:120", "switch", "S2")]);
  const t = tree(["dev:1"], { "dev:1": ["dev:78"], "dev:78": ["dev:120"] });
  const b78 = layoutTree(m, t, []).nodes.get("dev:78")!;
  const t78: SavedTweak = { nodeId: "dev:78", x: b78.x + 250, y: b78.y + 40, sig: structureSig(t, "dev:78"), orientation: "tb" };
  const v120 = layoutTree(m, t, [t78]).nodes.get("dev:120")!;
  const t120: SavedTweak = { nodeId: "dev:120", x: v120.x - 180, y: v120.y + 60, sig: structureSig(t, "dev:120"), orientation: "tb" };
  const r = layoutTree(m, t, [t78, t120]);
  assert.deepEqual([r.nodes.get("dev:120")!.x, r.nodes.get("dev:120")!.y], [t120.x, t120.y]);
  assert.deepEqual([r.nodes.get("dev:78")!.x, r.nodes.get("dev:78")!.y], [t78.x, t78.y]);
  assert.equal(ser(layoutTree(m, t, [t120, t78])), ser(r));
});

// Visto a schermo (T1b, Task 16): «Ruolo nella mappa ▸ Attaccato (server, PC)» su uno switch salvava il ruolo, ma il
// riquadro restava un riquadro. Il disegno leggeva la classe dal tipo dichiarato (`nodeClass`) e non quella della mappa
// (`classiMappa`, spec §13.8.2). Un «da sistemare» in una mappa passo passo resta invece un riquadro con la parola (R2).
test("la classe della mappa decide il disegno: «Attaccato» a mano va nella fascia, «da sistemare» resta un riquadro", () => {
  const nodes = [node("dev:1", "router", "R"), node("dev:2", "switch", "S"), node("dev:3", "switch", "T"), node("dev:4", "switch", "U")];
  const t = tree(["dev:1"], { "dev:1": ["dev:2", "dev:3", "dev:4"] });
  const m: TopologyModel = { ...model(nodes), classiMappa: { "dev:2": "att", "dev:4": "da_sistemare" } };
  for (const o of ["tb", "lr"] as const) {
    const r = layoutTreeCon(m, t, [], new Set(), o);
    assert.equal(r.nodes.get("dev:2")?.role, "attached", `${o}: l'attaccato a mano sta nella fascia`);
    assert.equal(r.nodes.get("dev:2")?.parent, "dev:1");
    assert.equal(r.nodes.get("dev:3")?.role, "box", `${o}: lo switch con le sue prove resta un riquadro`);
    assert.equal(r.nodes.get("dev:4")?.role, "box", `${o}: il «da sistemare» resta un riquadro (R2)`);
  }
});
