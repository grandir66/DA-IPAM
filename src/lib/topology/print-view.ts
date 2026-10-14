/**
 * La mappa da stampare (spec topologia §12.3): stesso modello, stesso albero e stessa disposizione
 * della pagina della mappa — VM non censite come nodi, id salvati passati dall'id canonico, testa
 * della mappa automatica, partenze della mappa passo passo, ritocchi nel loro orientamento — così la
 * carta ha le coordinate dello schermo. Le VM restano chiuse, a meno di «con le VM».
 * Il calcolo è quello della pagina (`computeMapView`, map-compute.ts), una funzione sola per schermo e carta.
 * Logica pura: una vista senza oggetti torna come messaggio in parole, mai come mappa vuota.
 */
import { computeMapView } from "@/lib/topology/map-compute";
import type { Paper, PrintScale } from "@/lib/topology/print-tiles";
import type { MapOrientation, TopologyModel } from "@/lib/topology/model-types";
import type { TreeResult } from "@/lib/topology/tree";
import type { LayoutResult, SavedTweak } from "@/lib/topology/tree-layout";

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
  return { ok: true, title, orientation, model: c.model, tree: c.tree, layout: c.layout, missing: c.missing.length };
}
