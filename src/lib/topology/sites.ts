/**
 * Sede e armadio di ogni nodo, e testa di ogni sede (spec §3). Sede = ubicazione
 * di primo livello; armadio = ubicazione figlia. Manuale > subnet > albero; le
 * proposte si usano nel calcolo segnate `siteProposed`/`headProposed` e non si
 * scrivono mai nel DB da qui (decisione 13/10). Logica pura.
 */
import type { MapLink, ModelNetworkRow, SiteInfo, TopologyModelInput } from "@/lib/topology/model-types";
import type { NodeIndex } from "@/lib/topology/node-index";
import { isIpInCidr, normalizeMacForStorage } from "@/lib/utils";

export const HEAD_TYPES = ["router", "firewall"] as const;

function prefixLen(cidr: string): number {
  const p = Number(cidr.split("/")[1]);
  return Number.isFinite(p) ? p : 0;
}

function inCidr(ip: string, cidr: string): boolean {
  try {
    return isIpInCidr(ip, cidr);
  } catch {
    return false;
  }
}

export function assignSites(input: TopologyModelInput, idx: NodeIndex, links: MapLink[]): SiteInfo[] {
  const locById = new Map(input.locations.map((l) => [l.id, l]));
  const topCache = new Map<number, number>();
  const topOf = (id: number): number => {
    const hit = topCache.get(id);
    if (hit !== undefined) return hit;
    const seen = new Set<number>([id]);
    let cur = id;
    for (;;) {
      const parent = locById.get(cur)?.parent_id;
      if (parent == null || !locById.has(parent) || seen.has(parent)) break;
      seen.add(parent);
      cur = parent;
    }
    topCache.set(id, cur);
    return cur;
  };

  const netById = new Map(input.networks.map((n) => [n.id, n]));
  const netsLongestFirst = [...input.networks].sort((a, b) => prefixLen(b.cidr) - prefixLen(a.cidr) || a.id - b.id);
  const devById = new Map(input.devices.map((d) => [d.id, d]));
  const nodes = [...idx.nodes.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const siteFromNetworks = (ip: string | null, hostIds: number[]): number | null => {
    const cands: ModelNetworkRow[] = [];
    for (const hid of hostIds) {
      const n = netById.get(idx.hostById.get(hid)?.network_id ?? -1);
      if (n) cands.push(n);
    }
    if (ip) cands.push(...netsLongestFirst.filter((n) => inCidr(ip, n.cidr)));
    const hit = cands.find((n) => n.location_id != null && locById.has(n.location_id));
    return hit && hit.location_id != null ? topOf(hit.location_id) : null;
  };

  // 1-2. Manuale, poi subnet.
  for (const n of nodes) {
    const d = n.kind === "device" ? devById.get(n.refId) : undefined;
    if (d?.location_id != null && locById.has(d.location_id)) {
      const top = topOf(d.location_id);
      n.siteId = top;
      n.rackId = top === d.location_id ? null : d.location_id;
      n.siteProposed = false;
      continue;
    }
    const hostIds = n.kind === "host" ? [n.refId] : n.fusedHostIds;
    const site = siteFromNetworks(n.mgmtIp, hostIds);
    if (site !== null) {
      n.siteId = site;
      n.siteProposed = true;
    }
  }

  // 3. Albero: prima gli uplink (direzione nota), poi i vicini concordi.
  const adjacency = new Map<string, string[]>();
  for (const l of links) {
    adjacency.set(l.a, [...(adjacency.get(l.a) ?? []), l.b]);
    adjacency.set(l.b, [...(adjacency.get(l.b) ?? []), l.a]);
  }
  for (let guard = nodes.length + 1, changed = true; changed && guard > 0; guard--) {
    changed = false;
    for (const l of links) {
      if (!l.uplinkFrom) continue;
      const child = idx.nodes.get(l.uplinkFrom);
      const parent = idx.nodes.get(l.uplinkFrom === l.a ? l.b : l.a);
      if (child && parent && child.siteId === null && parent.siteId !== null) {
        child.siteId = parent.siteId;
        child.siteProposed = true;
        changed = true;
      }
    }
    if (changed) continue;
    for (const n of nodes) {
      if (n.siteId !== null) continue;
      const around = new Set<number>();
      for (const other of adjacency.get(n.id) ?? []) {
        const s = idx.nodes.get(other)?.siteId;
        if (s != null) around.add(s);
      }
      if (around.size === 1) {
        n.siteId = [...around][0];
        n.siteProposed = true;
        changed = true;
      }
    }
  }

  // 4. Testa.
  const ipsByNode = ipDeiNodi(idx);

  const tops = input.locations
    .filter((l) => l.parent_id == null || !locById.has(l.parent_id))
    .sort((a, b) => a.name.localeCompare(b.name, "it") || a.id - b.id);
  return tops.map((loc) => {
    const nodeIds = nodes.filter((n) => n.siteId === loc.id).map((n) => n.id);
    if (loc.head_device_id != null && idx.nodes.has(`dev:${loc.head_device_id}`)) {
      return { locationId: loc.id, name: loc.name, headNodeId: `dev:${loc.head_device_id}`, headProposed: false, nodeIds };
    }
    const gateways: string[] = [];
    for (const nw of input.networks) {
      if (nw.gateway && nw.location_id != null && locById.has(nw.location_id) && topOf(nw.location_id) === loc.id) gateways.push(nw.gateway);
    }
    let best: string | null = null;
    let bestScore = 0;
    let tie = false;
    for (const id of nodeIds) {
      const n = idx.nodes.get(id);
      if (!n || n.kind !== "device" || !(HEAD_TYPES as readonly string[]).includes(n.type)) continue;
      const mine = ipsByNode.get(id) ?? new Set<string>();
      const score = gateways.filter((g) => mine.has(g)).length;
      if (score > bestScore) {
        best = id;
        bestScore = score;
        tie = false;
      } else if (score > 0 && score === bestScore) {
        tie = true;
      }
    }
    return { locationId: loc.id, name: loc.name, headNodeId: best && !tie ? best : null, headProposed: Boolean(best && !tie), nodeIds };
  });
}

/**
 * Gli IP di ogni nodo, per la testa (spec §3): il suo, quelli degli host fusi e quelli degli host col MAC di un apparato.
 * Li usano la testa proposta di una sede (sopra) e quella della mappa automatica (`retiDiCuiGateway`, spec §13.8.1).
 */
export function ipDeiNodi(idx: NodeIndex): Map<string, Set<string>> {
  const ipsByNode = new Map<string, Set<string>>();
  const addIp = (id: string, ip: string | null | undefined) => {
    if (!ip) return;
    const s = ipsByNode.get(id) ?? new Set<string>();
    s.add(ip);
    ipsByNode.set(id, s);
  };
  for (const n of [...idx.nodes.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    addIp(n.id, n.mgmtIp);
    for (const h of n.fusedHostIds) addIp(n.id, idx.hostById.get(h)?.ip);
  }
  for (const h of idx.hostById.values()) {
    const owner = h.mac ? idx.byMac.get(normalizeMacForStorage(h.mac) ?? "") : undefined;
    if (typeof owner === "string" && owner.startsWith("dev:")) addIp(owner, h.ip);
  }
  return ipsByNode;
}

/**
 * Per ogni apparato, di quante reti censite è il gateway (`networks.gateway` è uno dei suoi IP): lo stesso conto della testa
 * proposta di una sede (spec §3, «il router che fa da gateway del maggior numero di subnet»), su tutte le reti. Lo usa la
 * testa proposta della mappa automatica (`proposeHead`, spec §13.8.1). Solo gli apparati con almeno una rete.
 */
export function retiDiCuiGateway(input: Pick<TopologyModelInput, "networks">, idx: NodeIndex): Map<string, number> {
  const ips = ipDeiNodi(idx);
  const out = new Map<string, number>();
  for (const [id, mine] of [...ips].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!id.startsWith("dev:")) continue;
    const n = input.networks.filter((nw) => nw.gateway !== null && mine.has(nw.gateway)).length;
    if (n > 0) out.set(id, n);
  }
  return out;
}
