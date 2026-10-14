// src/lib/topology/map-screen.ts
/**
 * La mappa a schermo nei due orientamenti (spec topologia §12.2) e le ridondanze a richiesta
 * (spec §12.5), in logica pura: la usano map-canvas, map-node, map-edge e la barra.
 *
 * - Maniglie con id fissi: in «Orizzontale» (`tb`) le linee escono dal fondo ed entrano
 *   dall'alto; in «Verticale» (`lr`) escono da destra ed entrano da sinistra; verso gli
 *   attaccati (elencati sotto il riquadro in `lr`) un tratto corto parte dal fondo.
 * - «Adatta» in verticale adatta la larghezza e porta in cima a sinistra (poi si scorre).
 * - Le ridondanze (collegamenti che l'albero non usa) non si disegnano: le mostra il clic
 *   sul riquadro (solo le sue) o «Mostra ridondanze» (tutte). I principali sempre.
 */
import type { MapLink, MapOrientation } from "@/lib/topology/model-types";
import { ATT_INDENT, ATT_MAX, ATT_ROW } from "@/lib/topology/tree-layout-consts";

/** Orizzontale: entrata in alto, uscita in basso (gli id di prima della verticale). */
export const HANDLE_IN = "su", HANDLE_OUT = "giu";
/** Verticale: entrata a sinistra, uscita a destra. */
export const HANDLE_IN_LR = "sx", HANDLE_OUT_LR = "dx";
/** Verticale: il tratto dal fondo del riquadro verso i suoi attaccati. */
export const HANDLE_ATT = "fondo";

export function lineHandles(o: MapOrientation): { source: string; target: string } {
  return o === "lr" ? { source: HANDLE_OUT_LR, target: HANDLE_IN_LR } : { source: HANDLE_OUT, target: HANDLE_IN };
}

interface At { id: string; x: number; y: number }

/**
 * Il verso di una ridondanza: in orizzontale scende dal riquadro più in alto, in verticale va da
 * quello più a sinistra a quello più a destra. A pari posto decide l'altro asse, poi l'id: stessi
 * dati, stessa linea.
 */
export function redundantEnds(o: MapOrientation, a: At, b: At): [string, string] {
  const key = (n: At): [number, number] => (o === "lr" ? [n.x, n.y] : [n.y, n.x]);
  const [a1, a2] = key(a), [b1, b2] = key(b);
  const aFirst = a1 !== b1 ? a1 < b1 : a2 !== b2 ? a2 < b2 : a.id < b.id;
  return aFirst ? [a.id, b.id] : [b.id, a.id];
}

export const FIT_MIN = 0.25, FIT_MAX = 1;

/** «Adatta» in verticale: la larghezza della disposizione nel riquadro della mappa, fra 0,25 e 1, in cima a sinistra. */
export function fitWidthViewport(layoutWidth: number, paneWidth: number): { x: number; y: number; zoom: number } {
  const zoom = layoutWidth > 0 && paneWidth > 0 ? Math.min(FIT_MAX, Math.max(FIT_MIN, paneWidth / layoutWidth)) : 1;
  return { x: 0, y: 0, zoom };
}

interface Box { x: number; y: number; w: number; h: number }

/**
 * Dove si apre la mappa (al 100 %) quando cambiano modo, mappa o orientamento: in orizzontale la
 * testa in mezzo e in alto, come prima; in verticale la testa a sinistra e a metà altezza, senza
 * scendere sopra la cima della mappa (una testa in alto non lascia una fascia vuota).
 */
export function centerViewport(o: MapOrientation, n: Box, pane: { width: number; height: number }): { x: number; y: number; zoom: number } {
  if (o === "tb") return { x: pane.width / 2 - (n.x + n.w / 2), y: 10, zoom: 1 };
  return { x: 20 - n.x, y: Math.min(10, pane.height / 2 - (n.y + n.h / 2)), zoom: 1 };
}

/** «+ altri N» dopo i primi ATT_MAX attaccati: accanto al riquadro in orizzontale, sotto l'ultimo attaccato in verticale. */
export function moreAttachedAt(o: MapOrientation, b: Box): { x: number; y: number } {
  return o === "lr"
    ? { x: b.x + ATT_INDENT, y: b.y + b.h + 4 + ATT_MAX * ATT_ROW }
    : { x: b.x + b.w + 14, y: b.y + ATT_MAX * ATT_ROW };
}

/**
 * In verticale il tronco verticale dei figli corre a LR_TRUNK px dal lato destro del genitore
 * (non a metà fra le colonne): così il tratto orizzontale che entra nel figlio è lungo e porta
 * l'etichetta (porte, velocità, ⚡, ★, «✎ ✓/?») senza coprire né il tronco né i riquadri.
 */
export const LR_TRUNK = 14;

/** Larghezza massima dell'etichetta di una linea in verticale: fra il tronco e il figlio (oltre, va a capo). */
export function lrLabelMaxWidth(sourceX: number, targetX: number): number {
  return Math.max(40, targetX - (sourceX + LR_TRUNK) - 8);
}

/** La pagina di stampa della mappa che si guarda (spec §12.3); null se non c'è una mappa scelta. */
export function printHref(mode: "auto" | "passo", mapId: number | null): string | null {
  if (mode === "auto") return "/topology/stampa?mappa=auto";
  return mapId === null ? null : `/topology/stampa?mappa=${mapId}`;
}

type Ends = Pick<MapLink, "a" | "b" | "redundant">;

/**
 * Le linee da disegnare (spec §12.5): i principali sempre; le ridondanze tutte con «Mostra
 * ridondanze», altrimenti solo quelle del riquadro scelto. La disposizione non cambia: usa già
 * solo i principali.
 */
export function visibleEdges<L extends Ends>(links: readonly L[], opts: { showAll: boolean; selected: string | null }): L[] {
  return links.filter((l) => !l.redundant || opts.showAll || (opts.selected !== null && (l.a === opts.selected || l.b === opts.selected)));
}

/** «⇄ N» sul riquadro: quante ridondanze ha ogni oggetto (chi non ne ha non è nella mappa). */
export function redundancyCounts(links: readonly Ends[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of links) {
    if (!l.redundant) continue;
    out.set(l.a, (out.get(l.a) ?? 0) + 1);
    out.set(l.b, (out.get(l.b) ?? 0) + 1);
  }
  return out;
}

export type Rect = { x: number; y: number; w: number; h: number };
type Pt = { x: number; y: number };

/** Alta quanto la riga delle porte scritta sopra un riquadro («Port 11 → SFP+ 1»). */
const PORT_ROW = 18;

/**
 * Dove una scritta non deve finire (Task 5): i riquadri con la riga delle porte sopra, gli
 * attaccati, i gruppi degli AP. Coordinate della disposizione.
 */
export function labelBoxes(
  nodes: Iterable<Rect & { role: "box" | "ap" | "attached" }>,
  groups: Iterable<Rect>,
): Rect[] {
  const out: Rect[] = [];
  for (const n of nodes) out.push(n.role === "box" ? { x: n.x, y: n.y - PORT_ROW, w: n.w, h: n.h + PORT_ROW } : { x: n.x, y: n.y, w: n.w, h: n.h });
  for (const g of groups) out.push({ x: g.x, y: g.y, w: g.w, h: g.h });
  return out;
}

/**
 * Il centro della parola di una ridondanza («1G · ridondanza», Task 5). A metà percorso se lì
 * non tocca niente; altrimenti il punto della linea più vicino alla metà in cui la scritta non
 * tocca nessun riquadro. Se la linea è tutta coperta resta a metà: meglio sopra un riquadro
 * che sparita. Si prova un punto ogni 8 px.
 */
export function redundantLabelAt(points: readonly Pt[], size: { w: number; h: number }, avoid: readonly Rect[]): Pt {
  const segs: Array<{ a: Pt; b: Pt; len: number; from: number }> = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    segs.push({ a, b, len, from: total });
    total += len;
  }
  const at = (s: number): Pt => {
    const seg = segs.find((g) => s <= g.from + g.len) ?? segs[segs.length - 1];
    const t = seg ? Math.min(1, Math.max(0, (s - seg.from) / seg.len)) : 0;
    return seg ? { x: seg.a.x + (seg.b.x - seg.a.x) * t, y: seg.a.y + (seg.b.y - seg.a.y) * t } : (points[0] ?? { x: 0, y: 0 });
  };
  const free = (p: Pt) => {
    const r = { x: p.x - size.w / 2 - 2, y: p.y - size.h / 2 - 2, w: size.w + 4, h: size.h + 4 };
    return !avoid.some((b) => r.x < b.x + b.w && b.x < r.x + r.w && r.y < b.y + b.h && b.y < r.y + r.h);
  };
  const mid = total / 2;
  const STEP = 8;
  for (let d = 0; d <= mid; d += STEP) {
    for (const s of d === 0 ? [mid] : [mid - d, mid + d]) {
      const p = at(s);
      if (free(p)) return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
    }
  }
  const m = at(mid);
  return { x: Math.round(m.x * 10) / 10, y: Math.round(m.y * 10) / 10 };
}
