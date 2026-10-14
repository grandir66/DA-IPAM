/**
 * I fogli della stampa della mappa (spec topologia §12.3, Review Focus 4). Il disegno (coordinate
 * di `layoutTree`, px a scala 1) si taglia in tasselli della misura dell'area stampabile del foglio,
 * alla scala scelta, con 15 mm di sovrapposizione fra vicini. Valori alla lettera: area A4
 * 190 × 277 mm, A3 277 × 400 mm (margini di 10 mm), 96 dpi (1 px = 0,2646 mm). In testa a ogni
 * tassello `TILE_HEADER_MM` per «Foglio r-c di R×C» e le frecce ai vicini: il disegno sta sotto.
 *
 * Il foglio si gira (verticale/orizzontale) se così servono meno fogli; a parità resta verticale.
 * Un tassello che non tocca nessun riquadro è vuoto: non si stampa e non si conta (la disposizione
 * verticale lascia angoli vuoti: sulla copia del cliente A uno su otto in A3).
 * Con i riquadri (`drawing.boxes`) un taglio che spezzerebbe un riquadro si anticipa al bordo del
 * riquadro: così ogni riquadro sta intero in almeno un tassello anche quando è più largo della
 * sovrapposizione (i riquadri sono larghi 170-230 px, la sovrapposizione 57). La sovrapposizione
 * non scende mai sotto i 15 mm. Logica pura: stessi dati, stesso piano.
 */

export type Paper = "A4" | "A3";
export type PrintScale = 1 | 0.8;

/** Area stampabile del foglio in verticale, mm. */
export const PAPER_MM: Readonly<Record<Paper, { w: number; h: number }>> = { A4: { w: 190, h: 277 }, A3: { w: 277, h: 400 } };
export const MM_PER_PX = 0.2646;
export const PX_PER_MM = 1 / MM_PER_PX;
/** Fascia in testa a ogni tassello: «Foglio r-c di R×C» e frecce. */
export const TILE_HEADER_MM = 8;
export const OVERLAP_MM = 15;
/** Spazio lasciato prima di un riquadro quando il taglio si anticipa per non spezzarlo. */
const CUT_PAD = 8;
const EPS = 1e-6;

/** `empty`: nessun riquadro lo tocca (si sa solo coi riquadri): non si stampa, la panoramica lo dice. */
export interface Tile { row: number; col: number; x: number; y: number; w: number; h: number; empty: boolean }

export interface SheetPlan {
  paper: Paper;
  /** true = foglio orizzontale. */
  landscape: boolean;
  scale: PrintScale;
  rows: number;
  cols: number;
  /** Numerati da 1, riga per riga; coordinate nel sistema del disegno (px a scala 1). */
  tiles: Tile[];
  /** I tasselli da stampare (quelli non vuoti). */
  printed: number;
  /** Area stampabile del foglio nell'orientamento scelto, mm. */
  pageMm: { w: number; h: number };
  /** Il disegno di ogni tassello sulla carta, mm (l'area meno la fascia in testa). */
  tileMm: { w: number; h: number };
}

export interface DrawingBox { x: number; y: number; w: number; h: number }

/**
 * Inizi dei tagli lungo un asse: `tile` px per tassello, almeno `overlap` px in comune col
 * successivo. `spans` = i riquadri su quell'asse: uno che il bordo spezzerebbe fa anticipare il
 * tassello successivo al suo inizio (meno CUT_PAD), se così si va comunque avanti.
 */
function cuts(length: number, tile: number, overlap: number, spans: ReadonlyArray<{ a: number; b: number }>): number[] {
  const out = [0];
  let start = 0;
  while (start + tile < length - EPS) {
    const edge = start + tile;
    let next = edge - overlap;
    for (const s of spans) {
      // Spezzato dal bordo, cominciato dentro questo tassello e più corto di un tassello.
      if (s.a > start + EPS && s.a < edge && s.b > edge + EPS && s.b - s.a <= tile - CUT_PAD) next = Math.min(next, s.a - CUT_PAD);
    }
    if (next <= start + EPS) next = edge - overlap;
    out.push(next);
    start = next;
  }
  return out;
}

function grid(drawing: { width: number; height: number; boxes?: readonly DrawingBox[] }, tw: number, th: number, overlap: number) {
  const boxes = drawing.boxes ?? [];
  const xs = cuts(drawing.width, tw, overlap, boxes.map((b) => ({ a: b.x, b: b.x + b.w })));
  const ys = cuts(drawing.height, th, overlap, boxes.map((b) => ({ a: b.y, b: b.y + b.h })));
  const tiles: Tile[] = [];
  const touches = (x: number, y: number) => boxes.some((b) => b.x < x + tw && b.x + b.w > x && b.y < y + th && b.y + b.h > y);
  ys.forEach((y, r) => xs.forEach((x, c) => tiles.push({ row: r + 1, col: c + 1, x, y, w: tw, h: th, empty: boxes.length > 0 && !touches(x, y) })));
  return { rows: ys.length, cols: xs.length, tiles, printed: tiles.filter((t) => !t.empty).length };
}

export function planSheets(
  drawing: { width: number; height: number; boxes?: readonly DrawingBox[] },
  opts: { paper: Paper; scale: PrintScale; overlapMm: number },
): SheetPlan {
  const area = PAPER_MM[opts.paper];
  const overlap = (opts.overlapMm * PX_PER_MM) / opts.scale;
  const plan = (landscape: boolean): SheetPlan => {
    const pageMm = landscape ? { w: area.h, h: area.w } : { w: area.w, h: area.h };
    const tileMm = { w: pageMm.w, h: pageMm.h - TILE_HEADER_MM };
    const g = grid(drawing, (tileMm.w * PX_PER_MM) / opts.scale, (tileMm.h * PX_PER_MM) / opts.scale, overlap);
    return { paper: opts.paper, landscape, scale: opts.scale, ...g, pageMm, tileMm };
  };
  const portrait = plan(false), landscape = plan(true);
  return landscape.printed < portrait.printed ? landscape : portrait;
}

/** Altezza di una riga dell'elenco «Cavi di ridondanza» (13 px su una riga sola), mm. */
export const CABLE_ROW_MM = 4.8;

/**
 * Quante righe dell'elenco «Cavi di ridondanza» stanno sul primo foglio (al massimo il 30 %
 * dell'altezza: il resto è della panoramica e della legenda) e quante su ogni foglio di seguito.
 */
export function cableRows(pageMm: { h: number }): { first: number; perPage: number } {
  return { first: Math.max(3, Math.floor((pageMm.h * 0.3 - 10) / CABLE_ROW_MM)), perPage: Math.floor((pageMm.h - 20) / CABLE_ROW_MM) };
}

/** Dove comincia l'elenco su ogni foglio di seguito (indici delle righe); vuoto se tutto sta sul primo. */
export function cablePages(total: number, pageMm: { h: number }): number[] {
  const { first, perPage } = cableRows(pageMm);
  const out: number[] = [];
  for (let i = first; i < total; i += perPage) out.push(i);
  return out;
}

/** I vicini stampati di un tassello, per le frecce in testa al foglio (un vicino vuoto non ha foglio). */
export function neighbours(plan: Pick<SheetPlan, "rows" | "cols" | "tiles">, t: Pick<Tile, "row" | "col">) {
  const at = (row: number, col: number) => (plan.tiles.some((u) => u.row === row && u.col === col && !u.empty) ? `${row}-${col}` : null);
  return { up: at(t.row - 1, t.col), down: at(t.row + 1, t.col), left: at(t.row, t.col - 1), right: at(t.row, t.col + 1) };
}
