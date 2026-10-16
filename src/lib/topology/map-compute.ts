/**
 * Il calcolo della mappa, uno solo per lo schermo (`topology-map-client.tsx`) e per la carta (`print-view.ts`):
 * modello + VM non censite come nodi, id salvati passati dall'id canonico, oggetti visibili e partenze (testa della
 * mappa automatica, scelta o proposta; partenze della mappa passo passo), albero con le VM appese, disposizione nel
 * suo orientamento coi ritocchi. Prima erano due copie dello stesso giro: così il nome dal Proxmox, «DNS: …» e il
 * principale dell'hypervisor (spec §12.5) arrivano uguali a schermo e in stampa. Logica pura.
 */
import { nodeClass } from "@/lib/topology/identity";
import { resolveMapView } from "@/lib/topology/map-view";
import type { MapOrientation, TopologyModel } from "@/lib/topology/model-types";
import { autoVisible, buildTree, proposeHead, type TreeResult } from "@/lib/topology/tree";
import { layoutTree, type LayoutResult, type SavedTweak } from "@/lib/topology/tree-layout";
import { hangVmNodes, vmNodes } from "@/lib/topology/vm-nodes";

export interface MapComputeInput {
  /** true = la mappa automatica; false = una mappa passo passo. */
  auto: boolean;
  /** Passo passo: gli oggetti della mappa (id salvati). */
  members: string[];
  /** Passo passo: le partenze salvate. */
  roots: string[];
  /** Automatica: la testa scelta da un admin (null = la propone il sistema). */
  head: string | null;
  tweaks: SavedTweak[];
  /**
   * I ritocchi appena fatti a schermo e non ancora tornati dal server (il nodo trascinato e i discendenti che si porta
   * dietro): valgono al posto di quelli salvati degli stessi oggetti.
   */
  ownTweaks?: readonly SavedTweak[] | null;
  /** Hypervisor con le VM aperte; «tutti» = ogni hypervisor visibile (la stampa «con le VM»). */
  expanded: ReadonlySet<string> | "tutti";
  orientation: MapOrientation;
}

export interface MapComputed<M extends TopologyModel> {
  /** Il modello con le VM non censite come nodi («vm:…») e i loro id canonici. */
  model: M;
  visible: Set<string>;
  roots: string[];
  /** Id salvati che non hanno più un oggetto. */
  missing: string[];
  /** Automatica: la testa usata, e se l'ha scelta un admin (true) o la propone il sistema (false). */
  head: string | null;
  headChosen: boolean;
  /** Le partenze salvate per id canonico (anche quelle che non sono visibili). */
  savedRoots: string[];
  renames: Array<{ from: string; to: string }>;
  tweaks: SavedTweak[];
  expanded: ReadonlySet<string>;
  tree: TreeResult;
  layout: LayoutResult;
}

export function computeMapView<M extends TopologyModel>(base: M, inp: MapComputeInput): MapComputed<M> {
  // Le VM non censite sono nodi della pagina («vm:…»): così entrano in una mappa passo passo (spec §11.5).
  const vn = vmNodes(base);
  const model: M = { ...base, nodes: [...base.nodes, ...vn.nodes], canonical: { ...vn.canonical, ...base.canonical } };
  const ids = new Set(model.nodes.map((n) => n.id));
  // Gli id salvati passano dall'id canonico: un oggetto promosso o fuso resta nella mappa (I5).
  const saved = resolveMapView(
    inp.auto
      ? { members: [], roots: [], tweaks: inp.tweaks, head: inp.head }
      : { members: inp.members, roots: inp.roots, tweaks: inp.tweaks, head: null },
    ids,
    model.canonical,
  );
  let visible: Set<string>;
  let roots: string[];
  let head: string | null = null;
  if (inp.auto) {
    visible = autoVisible(model);
    head = saved.head ?? proposeHead(model);
    roots = head ? [head] : [];
  } else {
    visible = new Set(saved.visible);
    roots = saved.roots.filter((r) => visible.has(r));
  }
  const tree = hangVmNodes(buildTree(model, visible, roots), vn.parentOf);
  const own = inp.ownTweaks ?? [];
  const ownIds = new Set(own.map((t) => t.nodeId));
  const tweaks = [...saved.tweaks.filter((t) => !ownIds.has(t.nodeId)), ...own];
  let expanded: ReadonlySet<string>;
  if (inp.expanded === "tutti") {
    const byId = new Map(model.nodes.map((n) => [n.id, n]));
    const open = new Set<string>();
    for (const v of model.vms) {
      const h = v.hypervisorNodeId ? byId.get(v.hypervisorNodeId) : undefined;
      if (h && visible.has(h.id) && nodeClass(h) === "hyper") open.add(h.id);
    }
    expanded = open;
  } else {
    expanded = inp.expanded;
  }
  const layout = layoutTree(model, tree, tweaks, expanded, inp.orientation);
  return {
    model, visible, roots, missing: inp.auto ? [] : saved.missing, head, headChosen: inp.auto && saved.head !== null,
    savedRoots: saved.roots, renames: saved.renames, tweaks, expanded, tree, layout,
  };
}

/** Il messaggio intero (al passaggio del mouse sulla scritta della barra) quando la vista della mappa nuova cade nel browser. */
export const VISTA_NUOVA_NON_DISEGNATA = "La mappa nuova non si è potuta disegnare in questa pagina: si vede quella di prima";

/**
 * Il modello senza le parti della mappa nuova (`cavi`, il `cavo` di ogni linea, i nodi segmento e le linee che li toccano, che
 * esistono solo con la mappa nuova): `buildTree` torna all'albero di T1 (revisione mirata del giro finale, minore 1).
 */
export function senzaCavi<M extends TopologyModel>(m: M): M {
  const seg = (id: string) => id.startsWith("seg:");
  const out: M = { ...m, nodes: m.nodes.filter((n) => !seg(n.id)), links: m.links.filter((l) => !seg(l.a) && !seg(l.b)).map((l) => {
    const x = { ...l };
    delete x.cavo;
    return x;
  }) };
  delete out.cavi;
  return out;
}

/**
 * `computeMapView` con il ripiego del browser (revisione finale di T3, M7): il server ripiega sulla mappa di prima se il modello
 * per cavo cade (Caso 3, `mappaErrore`), ma un errore nel calcolo della vista con la mappa nuova (l'albero della pagina, solo con
 * `cavi`) lasciava la pagina bianca. Allora la vista si ricalcola senza `cavi` e senza `cavo`, e `errore` lo dice (la stessa
 * scritta della barra). Senza la mappa nuova è `computeMapView` e basta: un errore esce come prima.
 */
export function computeMapViewProtetta<M extends TopologyModel>(base: M, inp: MapComputeInput): { vista: MapComputed<M>; errore: string | null } {
  if (base.cavi === undefined && !base.links.some((l) => l.cavo !== undefined)) return { vista: computeMapView(base, inp), errore: null };
  try {
    return { vista: computeMapView(base, inp), errore: null };
  } catch (e) {
    return { vista: computeMapView(senzaCavi(base), inp), errore: `${VISTA_NUOVA_NON_DISEGNATA} (${e instanceof Error ? e.message : "errore"}).` };
  }
}
