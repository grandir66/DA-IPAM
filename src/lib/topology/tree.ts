/**
 * L'albero della mappa dagli oggetti di partenza (spec §10.2). Logica pura e
 * deterministica: Prim con collegamenti freschi e di rango migliore per primi;
 * attaccati e client sono foglie (non fanno da ponte).
 */
import { nodeClass } from "@/lib/topology/identity";
import { linkCost } from "@/lib/topology/link-attrs";
import type { MapLink, TopologyModel } from "@/lib/topology/model-types";

export interface TreeResult {
  roots: string[];
  children: Map<string, string[]>;
  /** Il collegamento con cui ogni nodo è appeso al genitore (copia annotata di quella in `links`). */
  via: Map<string, MapLink>;
  /**
   * I collegamenti fra nodi visibili, copie del modello annotate per questa vista: `primary: "auto"` su quelli che
   * l'albero usa («user» se è la scelta dell'admin), `redundant: true` su quelli che non usa. Il modello non cambia.
   */
  links: MapLink[];
}

export function buildTree(model: TopologyModel, visible: ReadonlySet<string>, roots: readonly string[]): TreeResult {
  const nodes = new Map(model.nodes.map((n) => [n.id, n]));
  const adj = new Map<string, MapLink[]>();
  for (const l of model.links) {
    if (!visible.has(l.a) || !visible.has(l.b)) continue;
    adj.set(l.a, [...(adj.get(l.a) ?? []), l]);
    adj.set(l.b, [...(adj.get(l.b) ?? []), l]);
  }
  // Un nodo con un principale scelto a mano si appende solo a quel collegamento (a meno che non sia irraggiungibile).
  const chosen = new Map<string, MapLink>();
  for (const l of model.links) {
    if (l.primary === "user" && l.primaryFor && visible.has(l.a) && visible.has(l.b)) chosen.set(l.primaryFor, l);
  }
  const taken = new Set<string>();
  const children = new Map<string, string[]>();
  const via = new Map<string, MapLink>();
  const outRoots: string[] = [];
  const grow = (r: string) => {
    taken.add(r);
    children.set(r, []);
    outRoots.push(r);
    const pick = (strict: boolean) => {
      let best: { c: number; from: string; to: string; l: MapLink } | null = null;
      for (const x of [...taken].sort()) {
        const cls = nodeClass(nodes.get(x)!);
        if (cls === "att" || cls === "client" || cls === "hyper") continue; // foglie: non fanno da ponte
        for (const l of adj.get(x) ?? []) {
          const to = l.a === x ? l.b : l.a;
          if (taken.has(to)) continue;
          if (strict && chosen.has(to) && chosen.get(to) !== l) continue;
          const c = linkCost(l);
          if (!best || c < best.c || (c === best.c && x + "|" + to < best.from + "|" + best.to)) best = { c, from: x, to, l };
        }
      }
      return best;
    };
    for (;;) {
      const best = pick(true) ?? pick(false);
      if (!best) return;
      taken.add(best.to);
      children.set(best.to, []);
      children.get(best.from)!.push(best.to);
      via.set(best.to, best.l);
    }
  };
  for (const r of roots) if (visible.has(r) && nodes.has(r) && !taken.has(r)) grow(r);
  const rest = [...visible]
    .filter((x) => !taken.has(x) && nodes.has(x))
    .sort(
      (a, b) =>
        Number(nodeClass(nodes.get(a)!) !== "infra") - Number(nodeClass(nodes.get(b)!) !== "infra") ||
        (adj.get(b)?.length ?? 0) - (adj.get(a)?.length ?? 0) ||
        (a < b ? -1 : 1),
    );
  for (const r of rest) if (!taken.has(r)) grow(r);
  const used = new Set([...via.values()].map((l) => l.id));
  const links = model.links
    .filter((l) => visible.has(l.a) && visible.has(l.b) && nodes.has(l.a) && nodes.has(l.b))
    .map((l): MapLink => ({ ...l, primary: used.has(l.id) ? (l.primary === "user" ? "user" : "auto") : l.primary, redundant: !used.has(l.id) }));
  const byId = new Map(links.map((l) => [l.id, l]));
  for (const [k, l] of via) via.set(k, byId.get(l.id) ?? l);
  return { roots: outRoots, children, via, links };
}

/** Mappa automatica (spec §10.2): niente client, niente isolati («Da sistemare»), niente nascosti. */
export function autoVisible(model: TopologyModel): Set<string> {
  const isolated = new Set(model.isolated);
  return new Set(model.nodes.filter((n) => nodeClass(n) !== "client" && !n.hidden && !isolated.has(n.id)).map((n) => n.id));
}

/** Testa confermata di una sede; altrimenti il router (apparato) che raggiunge più nodi coi collegamenti non vecchi. */
export function proposeHead(model: TopologyModel): string | null {
  const confirmed = model.sites.find((s) => s.headNodeId !== null && !s.headProposed)?.headNodeId;
  if (confirmed) return confirmed;
  const fresh = new Map<string, string[]>();
  for (const l of model.links) {
    if (l.stale) continue;
    fresh.set(l.a, [...(fresh.get(l.a) ?? []), l.b]);
    fresh.set(l.b, [...(fresh.get(l.b) ?? []), l.a]);
  }
  let best: string | null = null;
  let size = -1;
  for (const n of model.nodes.filter((x) => x.kind === "device" && x.type === "router").sort((a, b) => a.refId - b.refId)) {
    const seen = new Set([n.id]);
    const q = [n.id];
    while (q.length) for (const y of fresh.get(q.shift()!) ?? []) if (!seen.has(y)) { seen.add(y); q.push(y); }
    if (seen.size > size) { size = seen.size; best = n.id; }
  }
  return best;
}

/** Il «+N» (spec §10.2): collegamenti verso nodi che non sono client e non sono ancora nella mappa. */
export function missingNeighbors(model: TopologyModel, nodeId: string, visible: ReadonlySet<string>): MapLink[] {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  return model.links.filter((l) => {
    if (l.a !== nodeId && l.b !== nodeId) return false;
    const other = byId.get(l.a === nodeId ? l.b : l.a);
    return !!other && !visible.has(other.id) && nodeClass(other) !== "client";
  });
}
