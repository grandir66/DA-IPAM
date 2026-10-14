// src/lib/topology/tree-layout-lr.ts
/**
 * Disposizione «Verticale» (spec topologia §12.2): l'albero da sinistra a destra, un livello per
 * colonna, i fratelli impilati. Stesse regole di `tree-layout.ts` ruotate: colonna larga quanto il
 * suo elemento più largo, 90 px fra due colonne, genitore a metà (in altezza) fra il centro del
 * primo e dell'ultimo figlio ma dentro la sua fetta, attaccati in elenco sotto il riquadro con un
 * rientro, AP senza figli in un blocco di 2 colonne nella colonna dei figli, VM in 2 colonne,
 * partenze una sotto l'altra. Logica pura: stessi dati, stesse coordinate. I ritocchi e le misure
 * finali li applica `layoutTree`.
 */
import type { TopologyModel } from "@/lib/topology/model-types";
import type { TreeResult } from "@/lib/topology/tree";
import type { LayoutNode, LayoutResult, VmChip } from "@/lib/topology/tree-layout";
import {
  AP_BLOCK_LR, AP_COLS_LR, AP_H, AP_HEAD, AP_W, ATT_INDENT, ATT_MAX, ATT_ROW, ATT_W, BOX_H, GAP, LEVEL_GAP_LR, MARGIN,
  ROOT_GAP, VM_COLS_LR, VM_H, VM_ROW, VM_W, fitLabel,
} from "@/lib/topology/tree-layout-consts";

/** Quel che `layoutTree` sa dei nodi e passa alla disposizione. */
export interface LrContext {
  parts: (id: string) => { inf: string[]; ap: string[]; att: string[] };
  boxW: (id: string) => number;
  boxH: (id: string) => number;
  isOpen: (id: string) => boolean;
  vmsOf: Map<string, TopologyModel["vms"]>;
}

const AP_PAD = 4;
const apHeight = (n: number) => AP_HEAD + Math.ceil(n / AP_COLS_LR) * (AP_H + 6) + AP_PAD;

export function layoutLr(c: LrContext, tree: TreeResult): Pick<LayoutResult, "nodes" | "apGroups" | "moreAttached" | "vmChips"> {
  // Misura: larghezza di ogni colonna e altezza di ogni sottoalbero.
  const colW: number[] = [];
  const height = new Map<string, number>();
  const blockH = (id: string, nAtt: number) => {
    const shown = Math.min(nAtt, ATT_MAX) + (nAtt > ATT_MAX ? 1 : 0);
    return c.boxH(id) + (shown > 0 ? 4 + shown * ATT_ROW : 0);
  };
  const kidsH = (p: ReturnType<LrContext["parts"]>) => {
    const items = p.inf.map((k) => height.get(k)!).concat(p.ap.length ? [apHeight(p.ap.length)] : []);
    return items.length ? items.reduce((s, v) => s + v, 0) + GAP * (items.length - 1) : 0;
  };
  const measure = (id: string, lvl: number): void => {
    const p = c.parts(id);
    colW[lvl] = Math.max(colW[lvl] ?? 0, c.boxW(id), p.att.length ? ATT_INDENT + ATT_W : 0);
    for (const k of p.inf) measure(k, lvl + 1);
    if (p.ap.length) colW[lvl + 1] = Math.max(colW[lvl + 1] ?? 0, AP_BLOCK_LR);
    height.set(id, Math.max(blockH(id, p.att.length), kidsH(p)));
  };
  for (const r of tree.roots) measure(r, 0);
  const colX: number[] = [MARGIN];
  for (let i = 1; i < colW.length; i++) colX[i] = colX[i - 1] + colW[i - 1] + LEVEL_GAP_LR;

  const nodes = new Map<string, LayoutNode>();
  const apGroups: LayoutResult["apGroups"] = [];
  const moreAttached = new Map<string, number>();
  const vmChips: VmChip[] = [];
  const place = (id: string, top: number, lvl: number, parent: string | null): void => {
    const p = c.parts(id);
    const slice = height.get(id)!;
    const bw = c.boxW(id), bh = c.boxH(id);
    const block = blockH(id, p.att.length);
    // Segnaposto: il genitore resta prima dei figli nell'ordine dei nodi.
    nodes.set(id, { id, x: colX[lvl], y: top, w: bw, h: bh, role: "box", parent });
    // I figli stanno al centro della fetta se sono più corti del blocco del genitore.
    let cur = top + (slice - kidsH(p)) / 2;
    const centres: number[] = [];
    for (const k of p.inf) {
      place(k, cur, lvl + 1, id);
      const n = nodes.get(k)!;
      centres.push(n.y + n.h / 2);
      cur += height.get(k)! + GAP;
    }
    if (p.ap.length) {
      const gh = apHeight(p.ap.length);
      p.ap.forEach((a, i) => nodes.set(a, {
        id: a, x: colX[lvl + 1] + AP_PAD + (i % AP_COLS_LR) * (AP_W + 8), y: cur + AP_HEAD + Math.floor(i / AP_COLS_LR) * (AP_H + 6),
        w: AP_W, h: AP_H, role: "ap", parent: id,
      }));
      apGroups.push({ parent: id, x: colX[lvl + 1], y: cur, w: AP_BLOCK_LR, h: gh, count: p.ap.length });
      centres.push(cur + gh / 2);
    }
    // A metà fra il centro del primo e dell'ultimo figlio (dove corre la linea verticale), ma col
    // blocco (attaccati compresi) dentro la propria fetta, così non invade i rami vicini.
    const want = centres.length ? (centres[0] + centres[centres.length - 1]) / 2 : top + bh / 2;
    const y = Math.min(Math.max(want - bh / 2, top), top + slice - block);
    const x = colX[lvl];
    nodes.set(id, { id, x, y, w: bw, h: bh, role: "box", parent });
    if (c.isOpen(id)) {
      c.vmsOf.get(id)!.forEach((v, i) => vmChips.push({
        vmId: v.id, hypervisor: id, x: x + 8 + (i % VM_COLS_LR) * (VM_W + 8), y: y + BOX_H + 6 + Math.floor(i / VM_COLS_LR) * VM_ROW,
        w: VM_W, h: VM_H, label: fitLabel(v.name, VM_W),
      }));
    }
    p.att.slice(0, ATT_MAX).forEach((a, i) =>
      nodes.set(a, { id: a, x: x + ATT_INDENT, y: y + bh + 4 + i * ATT_ROW, w: ATT_W, h: ATT_ROW - 2, role: "attached", parent: id }));
    if (p.att.length > ATT_MAX) moreAttached.set(id, p.att.length - ATT_MAX);
  };
  let top = MARGIN;
  for (const r of tree.roots) { place(r, top, 0, null); top += height.get(r)! + ROOT_GAP; }
  return { nodes, apGroups, moreAttached, vmChips };
}
