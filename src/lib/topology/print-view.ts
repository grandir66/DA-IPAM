/**
 * La mappa da stampare (spec topologia §12.3): stesso modello, stesso albero e stessa disposizione
 * della pagina della mappa — VM non censite come nodi, id salvati passati dall'id canonico, testa
 * della mappa automatica, partenze della mappa passo passo, ritocchi nel loro orientamento — così la
 * carta ha le coordinate dello schermo. Le VM restano chiuse, a meno di «con le VM».
 * Ripete i passi del calcolo della pagina (`topology-map-client.tsx`) con le stesse funzioni pure.
 * Logica pura: una vista senza oggetti torna come messaggio in parole, mai come mappa vuota.
 */
import { nodeClass } from "@/lib/topology/identity";
import { resolveMapView } from "@/lib/topology/map-view";
import type { Paper, PrintScale } from "@/lib/topology/print-tiles";
import type { MapOrientation, TopologyModel } from "@/lib/topology/model-types";
import { autoVisible, buildTree, proposeHead, type TreeResult } from "@/lib/topology/tree";
import { layoutTree, type LayoutResult, type SavedTweak } from "@/lib/topology/tree-layout";
import { hangVmNodes, vmNodes } from "@/lib/topology/vm-nodes";

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
  const vn = vmNodes(base);
  const model: M = { ...base, nodes: [...base.nodes, ...vn.nodes], canonical: { ...vn.canonical, ...base.canonical } };
  const ids = new Set(model.nodes.map((n) => n.id));
  const auto = key === "auto";
  const saved = resolveMapView(
    auto
      ? { members: [], roots: [], tweaks: view.tweaks, head: view.map?.head_node ?? null }
      : { members: view.nodes, roots: view.map?.roots ?? [], tweaks: view.tweaks, head: null },
    ids,
    model.canonical,
  );
  let visible: Set<string>;
  let roots: string[];
  if (auto) {
    visible = autoVisible(model);
    const head = saved.head ?? proposeHead(model);
    roots = head ? [head] : [];
  } else {
    visible = new Set(saved.visible);
    roots = saved.roots.filter((r) => visible.has(r));
  }
  if (visible.size === 0) {
    return {
      ok: false,
      message: auto
        ? "Nessun apparato con collegamenti: nella mappa automatica non c'è niente da stampare."
        : "Questa mappa non contiene oggetti: non c'è niente da stampare.",
    };
  }
  const orientation: MapOrientation = view.orientation ?? view.map?.orientation ?? "lr";
  const tree = hangVmNodes(buildTree(model, visible, roots), vn.parentOf);
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const expanded = new Set<string>();
  if (withVms) for (const v of model.vms) if (v.hypervisorNodeId && visible.has(v.hypervisorNodeId) && byId.get(v.hypervisorNodeId) && nodeClass(byId.get(v.hypervisorNodeId)!) === "hyper") expanded.add(v.hypervisorNodeId);
  const layout = layoutTree(model, tree, saved.tweaks, expanded, orientation);
  const title = auto ? "Tutto automatico" : (view.map?.name ?? "Mappa");
  return { ok: true, title, orientation, model, tree, layout, missing: saved.missing.length };
}
