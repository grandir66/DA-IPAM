/**
 * La mappa da stampare (spec topologia §12.3): stesso modello, stesso albero e stessa disposizione
 * della pagina della mappa — VM non censite come nodi, id salvati passati dall'id canonico, testa
 * della mappa automatica, partenze della mappa passo passo, ritocchi nel loro orientamento — così la
 * carta ha le coordinate dello schermo (spostate tutte insieme solo se un ritocco porta un ramo sopra
 * o a sinistra dell'origine: `dentroIlFoglio`). Le VM restano chiuse, a meno di «con le VM».
 * Il calcolo è quello della pagina (`computeMapView`, map-compute.ts), una funzione sola per schermo e carta.
 * Logica pura: una vista senza oggetti torna come messaggio in parole, mai come mappa vuota.
 */
import { computeMapView } from "@/lib/topology/map-compute";
import type { Paper, PrintScale } from "@/lib/topology/print-tiles";
import type { MapOrientation, TopologyModel } from "@/lib/topology/model-types";
import type { TreeResult } from "@/lib/topology/tree";
import type { LayoutResult, SavedTweak } from "@/lib/topology/tree-layout";
import { MARGIN } from "@/lib/topology/tree-layout-consts";

/** Quel che serve della risposta di GET /api/topology/maps/[id]. */
export interface PrintViewInput {
  map: { name: string; kind: "auto" | "passo"; roots: string[]; head_node: string | null; orientation?: MapOrientation } | null;
  nodes: string[];
  tweaks: SavedTweak[];
  orientation?: MapOrientation;
}

export type PrintView<M extends TopologyModel = TopologyModel> =
  | { ok: true; title: string; orientation: MapOrientation; model: M; tree: TreeResult; layout: LayoutResult; missing: number }
  | { ok: false; message: string };

export interface PrintParams {
  /** "auto", l'id di una mappa passo passo, o null se `mappa` manca o non è valida. */
  key: "auto" | number | null;
  paper: Paper;
  scale: PrintScale;
  withVms: boolean;
}

/** I parametri della pagina di stampa: `mappa` (id|auto), `foglio` (A4|A3, predefinito A3), `scala` (100|80, predefinita 100), `vm` (0|1). */
export function parsePrintParams(sp: Readonly<Record<string, string | string[] | undefined>>): PrintParams {
  const one = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  const m = one("mappa");
  const key = m === "auto" ? "auto" : m && /^\d{1,9}$/.test(m) && Number(m) > 0 ? Number(m) : null;
  return { key, paper: one("foglio") === "A4" ? "A4" : "A3", scale: one("scala") === "80" ? 0.8 : 1, withVms: one("vm") === "1" };
}

/** La query della pagina per quei parametri (per ricordarli nell'indirizzo). */
export function printQuery(p: PrintParams): string {
  const q = new URLSearchParams({ mappa: String(p.key ?? ""), foglio: p.paper, scala: p.scale === 1 ? "100" : "80" });
  if (p.withVms) q.set("vm", "1");
  return `?${q.toString()}`;
}

export function buildPrintView<M extends TopologyModel>(base: M, key: "auto" | number, view: PrintViewInput, withVms: boolean): PrintView<M> {
  const auto = key === "auto";
  const orientation: MapOrientation = view.orientation ?? view.map?.orientation ?? "lr";
  const c = computeMapView(base, {
    auto,
    members: view.nodes,
    roots: view.map?.roots ?? [],
    head: auto ? (view.map?.head_node ?? null) : null,
    tweaks: view.tweaks,
    expanded: withVms ? "tutti" : new Set(),
    orientation,
  });
  if (c.visible.size === 0) {
    return {
      ok: false,
      message: auto
        ? "Nessun apparato con collegamenti: nella mappa automatica non c'è niente da stampare."
        : "Questa mappa non contiene oggetti: non c'è niente da stampare.",
    };
  }
  const title = auto ? "Tutto automatico" : (view.map?.name ?? "Mappa");
  return { ok: true, title, orientation, model: c.model, tree: c.tree, layout: dentroIlFoglio(c.layout), missing: c.missing.length };
}

/** Alta quanto la riga delle porte sopra un riquadro con un genitore (come `drawingBoxes` di print-draw.ts). */
const RIGA_PORTE = 18;

/**
 * I fogli partono da 0, lo schermo no: un ritocco che porta un ramo sopra o a sinistra dell'origine (il genitore
 * trascinato in alto porta con sé i figli, e quelli sopra di lui vanno in negativo) restava fuori dalla carta.
 * Verifica a schermo di T1, 15/10: la stampa A3 di una mappa passo passo del cliente A, «foglio unico», senza i tre
 * riquadri più in alto. Allora tutta la disposizione si sposta, così il bordo torna a MARGIN come in una mappa senza
 * ritocchi; le distanze fra i riquadri restano quelle dello schermo. Senza niente in negativo resta identica.
 */
export function dentroIlFoglio(layout: LayoutResult): LayoutResult {
  let minX = Infinity, minY = Infinity;
  for (const n of layout.nodes.values()) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.role === "box" && n.parent ? n.y - RIGA_PORTE : n.y);
  }
  for (const r of [...layout.apGroups, ...layout.vmChips]) { minX = Math.min(minX, r.x); minY = Math.min(minY, r.y); }
  const dx = minX < 0 ? MARGIN - minX : 0, dy = minY < 0 ? MARGIN - minY : 0;
  if (dx === 0 && dy === 0) return layout;
  return {
    ...layout,
    nodes: new Map([...layout.nodes].map(([id, n]) => [id, { ...n, x: n.x + dx, y: n.y + dy }])),
    apGroups: layout.apGroups.map((g) => ({ ...g, x: g.x + dx, y: g.y + dy })),
    vmChips: layout.vmChips.map((c) => ({ ...c, x: c.x + dx, y: c.y + dy })),
    width: layout.width + dx,
    height: layout.height + dy,
  };
}
