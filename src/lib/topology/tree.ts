/**
 * L'albero della mappa dagli oggetti di partenza (spec §10.2). Logica pura e
 * deterministica: Prim con collegamenti freschi e di rango migliore per primi;
 * attaccati e client sono foglie (non fanno da ponte).
 */
import { nodeClass } from "@/lib/topology/identity";
import { linkCost } from "@/lib/topology/link-attrs";
import { LINK_SOURCE_RANK, type MapLink, type MapNode, type TopologyModel } from "@/lib/topology/model-types";

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

/** Rango della fonte (spec §3): uplink 1, LLDP/CDP/MNDP 2, a mano 3 se confermato o 4, tabella MAC 3, VM 3,5. */
function rango(l: MapLink): number {
  return l.source === "manual" ? (l.manual?.confirmed ? 3 : 4) : LINK_SOURCE_RANK[l.source];
}

/**
 * La chiave con cui l'albero sceglie (spec §13.8.1, D1), confrontata elemento per elemento: vince la più piccola. La ★
 * vince sempre; poi i collegamenti visti; poi la fonte più affidabile; poi chi non percorre un uplink del controller dal
 * figlio al padre; poi il cavo più veloce. A pari chiave «da|a» in ordine, solo per avere lo stesso disegno con gli
 * stessi dati. Il verso viene DOPO il rango: messo prima, sulla copia del cliente A cambiava 4 padri e portava core 1
 * sotto il router di riserva attraverso la porta della WAN (misura del 14/10).
 */
export function chiaveScelta(l: MapLink, da: string): readonly number[] {
  return [l.primary === "user" ? 0 : 1, l.stale ? 1 : 0, rango(l), l.uplinkFrom === da ? 1 : 0, -(l.speedMbps ?? 0)];
}

function confronta(x: readonly number[], y: readonly number[]): number {
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
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
  // Un hypervisor senza scelta a mano si appende al suo collegamento preferito (spec §12.5), con la stessa regola.
  const chosen = hypervisorPreferred(model, nodes, adj);
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
      let best: { k: readonly number[]; from: string; to: string; l: MapLink } | null = null;
      for (const x of [...taken].sort()) {
        const cls = nodeClass(nodes.get(x)!);
        if (cls === "att" || cls === "client" || cls === "hyper") continue; // foglie: non fanno da ponte
        for (const l of adj.get(x) ?? []) {
          const to = l.a === x ? l.b : l.a;
          if (taken.has(to)) continue;
          if (strict && chosen.has(to) && chosen.get(to) !== l) continue;
          const k = chiaveScelta(l, x);
          const d = best ? confronta(k, best.k) : -1;
          if (!best || d < 0 || (d === 0 && x + "|" + to < best.from + "|" + best.to)) best = { k, from: x, to, l };
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

/**
 * Il principale di un hypervisor (spec §12.5): fra i suoi collegamenti dai dati (non solo a mano) verso un oggetto
 * che può fargli da padre vince quello non
 * vecchio, poi il più veloce (la porta dello switch), poi quello con più VM che passano dalla porta, poi le regole di
 * oggi (`linkCost`, poi l'id). Con un collegamento solo non c'è niente da scegliere. «★» scelto a mano vince sempre:
 * lo applica chi chiama, sopra questa scelta. Così il cavo 10G verso il centrale è il principale e il 1G di gestione
 * una ridondanza. Gli altri oggetti: invariati.
 */
function hypervisorPreferred(
  model: TopologyModel, nodes: ReadonlyMap<string, MapNode>, adj: ReadonlyMap<string, MapLink[]>,
): Map<string, MapLink> {
  const hypers = new Set(model.vms.flatMap((v) => (v.hypervisorNodeId ? [v.hypervisorNodeId] : [])));
  const out = new Map<string, MapLink>();
  for (const [id, links] of adj) {
    const n = nodes.get(id);
    if (!n || (nodeClass(n) !== "hyper" && !hypers.has(id))) continue;
    // Solo verso chi può fargli da padre: attaccati, client e hypervisor sono foglie nell'albero.
    const padre = (l: MapLink) => { const o = nodes.get(l.a === id ? l.b : l.a); return !!o && !["att", "client", "hyper"].includes(nodeClass(o)); };
    const dati = links.filter((l) => l.sources.some((s) => s !== "manual") && padre(l));
    if (dati.length < 2) continue;
    const best = [...dati].sort((x, y) =>
      Number(x.stale) - Number(y.stale)
      || (y.speedMbps ?? 0) - (x.speedMbps ?? 0)
      || (y.vmCount ?? 0) - (x.vmCount ?? 0)
      || linkCost(x) - linkCost(y)
      || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))[0];
    out.set(id, best);
  }
  return out;
}

/**
 * Mappa automatica (spec §10.2): niente client, niente isolati («Da sistemare»), niente nascosti.
 * Un nodo che è una VM e non ha collegamenti propri sta dentro il suo hypervisor (spec §11.5): non è un oggetto in più.
 */
export function autoVisible(model: TopologyModel): Set<string> {
  const isolated = new Set(model.isolated);
  const linked = new Set(model.links.flatMap((l) => [l.a, l.b]));
  const inside = new Set(model.vms.flatMap((v) => (v.nodeId !== null && !linked.has(v.nodeId) ? [v.nodeId] : [])));
  return new Set(model.nodes.filter((n) => nodeClass(n) !== "client" && !n.hidden && !isolated.has(n.id) && !inside.has(n.id)).map((n) => n.id));
}

/**
 * Testa confermata di una sede; altrimenti il router (apparato) che raggiunge più nodi coi collegamenti non vecchi; a pari
 * nodi quello gateway di più reti (`gatewayDi`, spec §13.8.1, I63: sulla rete B il router e il gateway del controller sono
 * pari, e vinceva l'id più basso, per caso); l'id solo per ultimo, perché stessi dati diano la stessa testa (I39).
 */
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
  const reti = (id: string | null): number => (id ? (model.gatewayDi?.[id] ?? 0) : 0);
  for (const n of model.nodes.filter((x) => x.kind === "device" && x.type === "router").sort((a, b) => a.refId - b.refId)) {
    const seen = new Set([n.id]);
    const q = [n.id];
    while (q.length) for (const y of fresh.get(q.shift()!) ?? []) if (!seen.has(y)) { seen.add(y); q.push(y); }
    if (seen.size > size || (seen.size === size && reti(n.id) > reti(best))) { size = seen.size; best = n.id; }
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
