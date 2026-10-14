/**
 * Il disegno della mappa per la carta (spec topologia §12.3, §12.5, §11.4): logica pura che il
 * componente `PrintMap` traduce in SVG. In stampa le linee sono nere o grigie, mai solo colore: lo
 * stile viene da `edgeLook` (spessore = velocità, ondulata = Wi-Fi, tratteggiata grigia = non vista,
 * puntinata = a mano non confermata, ogni stato con la sua parola). Le ridondanze non si disegnano:
 * diventano l'elenco «Cavi di ridondanza» del primo foglio (spec §12.5).
 */
import type { EdgeLook, Pt } from "@/lib/topology/edge-look";
import { speedLabel } from "@/lib/topology/edge-look";
import type { MapLink, MapOrientation } from "@/lib/topology/model-types";
import type { TreeResult } from "@/lib/topology/tree";
import type { LayoutResult } from "@/lib/topology/tree-layout";

export const INK = "#000000";
export const GREY = "#6b6b6b";
export const PAPER = "#ffffff";
/** Testo secondario, fondo di attaccati e gruppi AP, loro bordo: grigi che restano leggibili in bianco e nero. */
export const DARK = "#333333", LIGHT = "#efefef", MID = "#9a9a9a";
const DOUBLE_GAP = 2.6;

export interface Rect { x: number; y: number; w: number; h: number }

/**
 * Il tratto a gradini (raggio 0) dal genitore al figlio. Orizzontale (`tb`): dal fondo del genitore
 * alla cima del figlio, gradino a metà altezza. Verticale (`lr`, spec §12.2): dal lato destro del
 * genitore al lato sinistro del figlio, gradino a metà larghezza.
 */
export function stepPoints(orientation: MapOrientation, from: Rect, to: Rect): Pt[] {
  if (orientation === "lr") {
    const sx = from.x + from.w, sy = from.y + from.h / 2;
    const tx = to.x, ty = to.y + to.h / 2;
    const mx = (sx + tx) / 2;
    return sy === ty ? [{ x: sx, y: sy }, { x: tx, y: ty }] : [{ x: sx, y: sy }, { x: mx, y: sy }, { x: mx, y: ty }, { x: tx, y: ty }];
  }
  const sx = from.x + from.w / 2, sy = from.y + from.h;
  const tx = to.x + to.w / 2, ty = to.y;
  const my = (sy + ty) / 2;
  return sx === tx ? [{ x: sx, y: sy }, { x: tx, y: ty }] : [{ x: sx, y: sy }, { x: sx, y: my }, { x: tx, y: my }, { x: tx, y: ty }];
}

export function pointsPath(points: readonly Pt[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${Math.round(p.x * 10) / 10} ${Math.round(p.y * 10) / 10}`).join(" ");
}

export interface PrintStroke { color: string; width: number; dash: string | null; cap: "butt" | "round" }

/**
 * I tratti di una linea in bianco e nero, dal più largo al più stretto: nero (grigio se non vista)
 * con lo spessore della velocità, tratteggio o puntini come a schermo; la doppia linea è un tratto
 * largo con dentro un tratto color carta.
 */
export function printStrokes(look: EdgeLook): PrintStroke[] {
  const color = look.grey ? GREY : INK;
  const cap = look.dash === "1.5 4" ? "round" : "butt";
  if (!look.double) return [{ color, width: look.width, dash: look.dash, cap }];
  const outer = Math.max(look.width + DOUBLE_GAP, 4.2);
  return [{ color, width: outer, dash: look.dash, cap }, { color: PAPER, width: outer - DOUBLE_GAP, dash: look.dash, cap }];
}

/** Dove va l'etichetta della linea: sopra l'ultimo tratto, accanto al figlio. `anchor` è l'allineamento del testo. */
export function edgeLabelAt(orientation: MapOrientation, points: readonly Pt[]): { x: number; y: number; anchor: "start" | "end" } {
  const end = points[points.length - 1];
  if (orientation === "lr") return { x: end.x - 4, y: end.y - 4, anchor: "end" };
  // Orizzontale: a sinistra della verticale del figlio, sopra il gradino (le porte stanno a destra). Una linea
  // dritta non ha gradino: a metà, altrimenti la scritta finiva sul riquadro del genitore.
  if (points.length < 3) return { x: end.x - 4, y: (points[0].y + end.y) / 2 + 4, anchor: "end" };
  return { x: end.x - 4, y: points[points.length - 2].y - 3, anchor: "end" };
}

export interface RedundantCable {
  id: string;
  from: string;
  fromPort: string;
  to: string;
  toPort: string;
  /** «10G», «1G»…; «non nota» se non si sa (sta nella colonna «velocità»). */
  speed: string;
}

/**
 * L'elenco «Cavi di ridondanza» (spec §12.5): i collegamenti della vista che l'albero non usa
 * (`redundant`), con le porte e la velocità. Parte dall'oggetto più vicino alla radice; in ordine
 * di nome. Solo quelli fra oggetti disegnati.
 */
export function redundantCables(tree: TreeResult, drawn: ReadonlySet<string>, nameOf: (id: string) => string): RedundantCable[] {
  const depth = new Map<string, number>();
  const q: string[] = [];
  for (const r of tree.roots) { depth.set(r, 0); q.push(r); }
  while (q.length) {
    const p = q.shift()!;
    for (const k of tree.children.get(p) ?? []) if (!depth.has(k)) { depth.set(k, depth.get(p)! + 1); q.push(k); }
  }
  const d = (id: string) => depth.get(id) ?? Number.MAX_SAFE_INTEGER;
  const rows = tree.links
    .filter((l: MapLink) => l.redundant && drawn.has(l.a) && drawn.has(l.b))
    .map((l): RedundantCable => {
      const aFirst = d(l.a) < d(l.b) || (d(l.a) === d(l.b) && nameOf(l.a).localeCompare(nameOf(l.b), "it") <= 0);
      const [x, xp, y, yp] = aFirst ? [l.a, l.aPort, l.b, l.bPort] : [l.b, l.bPort, l.a, l.aPort];
      return { id: l.id, from: nameOf(x), fromPort: xp || "porta non nota", to: nameOf(y), toPort: yp || "porta non nota", speed: speedLabel(l.speedMbps) ?? "non nota" };
    });
  return rows.sort((p, q2) => p.from.localeCompare(q2.from, "it") || p.to.localeCompare(q2.to, "it") || (p.id < q2.id ? -1 : 1));
}

/** I riquadri per non tagliarli fra due fogli (planSheets): le porte scritte sopra il riquadro comprese. */
export function drawingBoxes(layout: LayoutResult): Rect[] {
  const out: Rect[] = [];
  for (const n of layout.nodes.values()) out.push(n.role === "box" && n.parent ? { x: n.x, y: n.y - 18, w: n.w, h: n.h + 18 } : { x: n.x, y: n.y, w: n.w, h: n.h });
  return out;
}
