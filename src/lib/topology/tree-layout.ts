// src/lib/topology/tree-layout.ts
/**
 * Disposizione dell'albero (spec §4 livello 2, §5 pezzo 2, §10): livelli fissi,
 * figli infrastruttura in fila sotto il genitore, AP senza figli in un gruppo a
 * griglia che occupa SEMPRE AP_COLS colonne (un AP in più non sposta gli altri
 * rami), attaccati in colonna a destra del riquadro (non coprono le linee verso
 * i figli), riquadro a metà fra il primo e l'ultimo figlio. Un hypervisor è un riquadro come uno switch;
 * espanso (spec §11.5) si allarga e si allunga per le sue VM, che diventano `vmChips`. Ritocchi a mano: valgono finché la
 * firma (genitore + fratelli) non cambia. Logica pura: stessi dati, stesse
 * coordinate.
 */
import type { MapOrientation, TopologyModel } from "@/lib/topology/model-types";
import {
  AP_BLOCK, AP_COLS, AP_H, AP_HEAD, AP_W, ATT_MAX, ATT_ROW, ATT_SIDE, ATT_W, BOX_H, GAP, LEVEL_GAP, MARGIN, ROOT_GAP,
  VM_COLS, VM_COLS_LR, VM_H, VM_ROW, VM_W, dnsLine, fitLabel, headHeight, nodeWidth,
} from "@/lib/topology/tree-layout-consts";
import { layoutLr, type LrContext } from "@/lib/topology/tree-layout-lr";
import { nodeClass } from "@/lib/topology/identity";
import type { TreeResult } from "@/lib/topology/tree";

export * from "@/lib/topology/tree-layout-consts";

/**
 * La firma della struttura attorno a un nodo: il ritocco vale finché non cambia. Per un figlio è
 * il genitore con i fratelli; per una partenza (radice) è solo «|»: la sua posizione non dipende
 * dalle altre partenze, che nascono a ogni oggetto non collegato trascinato sulla mappa (fase 2b,
 * Task 12: prima ogni rilascio faceva tornare in fila le partenze già posate).
 */
export function structureSig(tree: TreeResult, nodeId: string): string {
  let parent = "";
  for (const [p, kids] of tree.children) if (kids.includes(nodeId)) { parent = p; break; }
  if (!parent) return ROOT_SIG;
  return `${parent}|${[...(tree.children.get(parent) ?? [])].sort().join(",")}`;
}

const ROOT_SIG = "|";

/** Un ritocco vale con la firma di oggi; quello di una partenza anche con la firma di prima della fase 2b («|a,b,…»). */
function tweakHolds(saved: string | null, now: string): boolean {
  return saved === now || (now === ROOT_SIG && saved !== null && saved.startsWith(ROOT_SIG));
}

/** `orientation`: dove è stato fatto il ritocco (la vista lo porta sempre; le righe di prima valgono `tb`). */
export interface SavedTweak { nodeId: string; x: number; y: number; sig: string | null; orientation: MapOrientation }
export interface LayoutNode { id: string; x: number; y: number; w: number; h: number; role: "box" | "ap" | "attached"; parent: string | null }
/** Una VM dentro il riquadro espanso del suo hypervisor; `label` è il nome già accorciato per entrare in `w`. */
export interface VmChip { vmId: string; hypervisor: string; x: number; y: number; w: number; h: number; label: string }
export interface LayoutResult {
  nodes: Map<string, LayoutNode>;
  apGroups: Array<{ parent: string; x: number; y: number; w: number; h: number; count: number }>;
  moreAttached: Map<string, number>;
  vmChips: VmChip[];
  width: number;
  height: number;
  expired: string[];
  orientation: MapOrientation;
}

export function layoutTree(
  model: TopologyModel, tree: TreeResult, tweaks: SavedTweak[], expanded: ReadonlySet<string> = new Set(),
  orientation: MapOrientation = "lr",
): LayoutResult {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const name = (id: string) => byId.get(id)?.name ?? id;
  const cls = (id: string) => { const n = byId.get(id); return n ? nodeClass(n) : "client"; };
  const vmsOf = new Map<string, TopologyModel["vms"]>();
  for (const v of model.vms) if (v.hypervisorNodeId) vmsOf.set(v.hypervisorNodeId, [...(vmsOf.get(v.hypervisorNodeId) ?? []), v]);
  for (const [k, list] of vmsOf) vmsOf.set(k, [...list].sort((a, b) => a.name.localeCompare(b.name, "it") || (a.id < b.id ? -1 : 1)));
  const isOpen = (id: string) => expanded.has(id) && cls(id) === "hyper" && (vmsOf.get(id)?.length ?? 0) > 0;
  const vmCols = orientation === "lr" ? VM_COLS_LR : VM_COLS;
  // La riga «DNS:» (spec §12.5) allunga l'intestazione e, se è più lunga del nome, allarga il riquadro.
  const headH = (id: string) => headHeight(byId.get(id) ?? {});
  const widest = (id: string) => { const d = dnsLine(byId.get(id) ?? {}); return d && d.length > name(id).length ? d : name(id); };
  const boxW = (id: string) => (isOpen(id) ? vmCols * (VM_W + 8) + 16 : nodeWidth(widest(id)));
  const boxH = (id: string) => (isOpen(id) ? headH(id) + 12 + Math.ceil(vmsOf.get(id)!.length / vmCols) * VM_ROW : headH(id));
  const order = (a: string, b: string) =>
    Number(cls(a) !== "infra") - Number(cls(b) !== "infra") || name(a).localeCompare(name(b), "it") || (a < b ? -1 : 1);
  const parts = (id: string) => {
    const kids = tree.children.get(id) ?? [];
    const att = kids.filter((k) => cls(k) === "att" || cls(k) === "client").sort(order);
    const ap = kids.filter((k) => cls(k) === "ap" && (tree.children.get(k)?.length ?? 0) === 0).sort(order);
    const inf = kids.filter((k) => !att.includes(k) && !ap.includes(k)).sort(order);
    return { inf, ap, att };
  };

  let base: Pick<LayoutResult, "nodes" | "apGroups" | "moreAttached" | "vmChips">;
  if (orientation === "lr") {
    const ctx: LrContext = { parts, boxW, boxH, headH, isOpen, vmsOf };
    base = layoutLr(ctx, tree);
  } else {
    base = layoutTb();
  }
  return finish(base, tree, tweaks, orientation);

  function layoutTb(): typeof base {
  const levelH: number[] = [];
  const width = new Map<string, number>();
  const kidsWidth = (p: ReturnType<typeof parts>) => {
    const items = p.inf.map((k) => width.get(k)!).concat(p.ap.length ? [AP_BLOCK] : []);
    return items.length ? items.reduce((s, v) => s + v, 0) + GAP * (items.length - 1) : 0;
  };
  const measure = (id: string, lvl: number): void => {
    const p = parts(id);
    const shown = Math.min(p.att.length, ATT_MAX) + (p.att.length > ATT_MAX ? 1 : 0);
    levelH[lvl] = Math.max(levelH[lvl] ?? 0, boxH(id), shown * ATT_ROW);
    for (const k of p.inf) measure(k, lvl + 1);
    if (p.ap.length) levelH[lvl + 1] = Math.max(levelH[lvl + 1] ?? 0, AP_HEAD + Math.ceil(p.ap.length / AP_COLS) * (AP_H + 6));
    // Il riquadro sta al centro: lo spazio della fascia si riserva da tutti e due i lati.
    width.set(id, Math.max(boxW(id) + (p.att.length ? 2 * ATT_SIDE : 0), kidsWidth(p)));
  };
  for (const r of tree.roots) measure(r, 0);
  const y: number[] = [MARGIN];
  for (let i = 1; i <= levelH.length; i++) y[i] = y[i - 1] + (levelH[i - 1] ?? BOX_H) + LEVEL_GAP;

  const nodes = new Map<string, LayoutNode>();
  const apGroups: LayoutResult["apGroups"] = [];
  const moreAttached = new Map<string, number>();
  const vmChips: VmChip[] = [];
  const place = (id: string, x: number, lvl: number, parent: string | null): void => {
    const p = parts(id);
    const w = width.get(id)!;
    const box = boxW(id);
    const bh = boxH(id);
    // Segnaposto: il genitore resta prima dei figli nell'ordine dei nodi.
    nodes.set(id, { id, x, y: y[lvl], w: box, h: bh, role: "box", parent });
    let cur = x + w / 2 - kidsWidth(p) / 2;
    const centres: number[] = [];
    for (const k of p.inf) {
      place(k, cur, lvl + 1, id);
      const n = nodes.get(k)!;
      centres.push(n.x + n.w / 2);
      cur += width.get(k)! + GAP;
    }
    if (p.ap.length) {
      p.ap.forEach((a, i) => nodes.set(a, {
        id: a, x: cur + 4 + (i % AP_COLS) * (AP_W + 8), y: y[lvl + 1] + AP_HEAD + Math.floor(i / AP_COLS) * (AP_H + 6),
        w: AP_W, h: AP_H, role: "ap", parent: id,
      }));
      apGroups.push({ parent: id, x: cur, y: y[lvl + 1], w: AP_BLOCK, h: AP_HEAD + Math.ceil(p.ap.length / AP_COLS) * (AP_H + 6) + 4, count: p.ap.length });
      centres.push(cur + AP_BLOCK / 2);
    }
    // Il riquadro sta a metà fra il centro del primo e dell'ultimo figlio (dove
    // finisce la linea orizzontale), non a metà dello spazio riservato: con un
    // figlio di bordo dal ramo largo, o col gruppo AP, il centro dello spazio
    // cadeva sopra un altro figlio (Task 12, copia di un cliente: 9 genitori su
    // 16 scostati di oltre 60 px, la testa di 749). Resta dentro la sua fetta,
    // fascia degli attaccati compresa, così non invade i rami vicini.
    const side = box / 2 + (p.att.length ? ATT_SIDE : 0);
    const want = centres.length ? (centres[0] + centres[centres.length - 1]) / 2 : x + w / 2;
    const cx = Math.min(Math.max(want, x + side), x + w - side);
    nodes.set(id, { id, x: cx - box / 2, y: y[lvl], w: box, h: bh, role: "box", parent });
    if (isOpen(id)) {
      vmsOf.get(id)!.forEach((v, i) => vmChips.push({
        vmId: v.id, hypervisor: id, x: cx - box / 2 + 8 + (i % VM_COLS) * (VM_W + 8), y: y[lvl] + headH(id) + 6 + Math.floor(i / VM_COLS) * VM_ROW,
        w: VM_W, h: VM_H, label: fitLabel(v.name, VM_W),
      }));
    }
    p.att.slice(0, ATT_MAX).forEach((a, i) =>
      nodes.set(a, { id: a, x: cx + box / 2 + 10, y: y[lvl] + i * ATT_ROW, w: ATT_W, h: ATT_ROW - 2, role: "attached", parent: id }));
    if (p.att.length > ATT_MAX) moreAttached.set(id, p.att.length - ATT_MAX);
  };
  let x = MARGIN;
  for (const r of tree.roots) { place(r, x, 0, null); x += width.get(r)! + ROOT_GAP; }
  return { nodes, apGroups, moreAttached, vmChips };
  }
}

/** Ritocchi e misure finali, uguali per le due disposizioni. */
function finish(
  base: Pick<LayoutResult, "nodes" | "apGroups" | "moreAttached" | "vmChips">,
  tree: TreeResult, tweaks: SavedTweak[], orientation: MapOrientation,
): LayoutResult {
  const { nodes, apGroups, moreAttached, vmChips } = base;

  // Ritocchi dell'orientamento in uso (gli altri restano da parte, non scadono): lo scarto vale per il nodo e tutto il suo ramo (attaccati e gruppo AP compresi).
  const expired: string[] = [];
  // Prima gli antenati, poi i discendenti: il ritocco è il punto assoluto del rilascio, visto con quelli degli antenati
  // già applicati. In ordine di id («dev:120» < «dev:78») lo scarto dell'antenato si sommava una seconda volta e il
  // riquadro saltava altrove al rilascio (cliente A, 15/10).
  const parentOf = new Map<string, string>();
  for (const [p, kids] of tree.children) for (const k of kids) parentOf.set(k, p);
  const depth = (id: string) => { let d = 0; for (let p = parentOf.get(id); p !== undefined && d <= parentOf.size; p = parentOf.get(p)) d++; return d; };
  const mine = tweaks.filter((w) => w.orientation === orientation).map((t) => ({ t, d: depth(t.nodeId) }));
  for (const { t } of mine.sort((a, b) => a.d - b.d || (a.t.nodeId < b.t.nodeId ? -1 : 1))) {
    const n = nodes.get(t.nodeId);
    if (!n || n.role !== "box") continue;
    if (!tweakHolds(t.sig, structureSig(tree, t.nodeId))) { expired.push(t.nodeId); continue; }
    const dx = t.x - n.x, dy = t.y - n.y;
    const branch = new Set<string>([t.nodeId]);
    const q = [t.nodeId];
    while (q.length) for (const k of tree.children.get(q.shift()!) ?? []) if (!branch.has(k)) { branch.add(k); q.push(k); }
    for (const id of branch) { const m = nodes.get(id); if (m) nodes.set(id, { ...m, x: m.x + dx, y: m.y + dy }); }
    for (const g of apGroups) if (branch.has(g.parent)) { g.x += dx; g.y += dy; }
    for (const c of vmChips) if (branch.has(c.hypervisor)) { c.x += dx; c.y += dy; }
  }
  let maxX = 0, maxY = 0;
  for (const n of nodes.values()) { maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h); }
  for (const g of apGroups) { maxX = Math.max(maxX, g.x + g.w); maxY = Math.max(maxY, g.y + g.h); }
  return { nodes, apGroups, moreAttached, vmChips, width: maxX + MARGIN, height: maxY + MARGIN, expired, orientation };
}
