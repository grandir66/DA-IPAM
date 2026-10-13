/**
 * Collegamenti della mappa (spec §3): correzioni manuali, uplink UniFi,
 * LLDP/CDP/MNDP. Uno per coppia di nodi, con la fonte più affidabile, tutte le
 * fonti che lo vedono e quando è stato visto l'ultima volta. Un collegamento
 * che sparisce non si cancella: dopo `staleDays` è «non visto da N giorni».
 * Logica pura.
 */
import { parseDbDate } from "@/lib/db-date";
import {
  LINK_SOURCE_RANK,
  type LinkSource,
  type MapLink,
  type TopologyModelInput,
  type UnmatchedNeighbor,
} from "@/lib/topology/model-types";
import { canonical, resolveNode, useNode, type NodeIndex } from "@/lib/topology/node-index";

export const DEFAULT_STALE_DAYS = 2;
const DAY_MS = 86_400_000;

interface Candidate {
  a: string;
  aPort: string;
  b: string;
  bPort: string;
  source: LinkSource;
  lastSeen: string | null;
  uplinkFrom: string | null;
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function timeOf(s: string | null): number | null {
  if (!s) return null;
  const t = parseDbDate(s).getTime();
  return Number.isNaN(t) ? null : t;
}

function sourceOfProtocol(p: string): LinkSource {
  if (p === "cdp") return "cdp";
  if (p === "mndp") return "mndp";
  return "lldp";
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function mergeInto(link: MapLink, c: Candidate): void {
  const same = c.a === link.a;
  const cA = same ? c.aPort : c.bPort;
  const cB = same ? c.bPort : c.aPort;
  if (LINK_SOURCE_RANK[c.source] < LINK_SOURCE_RANK[link.source]) {
    link.source = c.source;
    if (cA) link.aPort = cA;
    if (cB) link.bPort = cB;
  } else {
    if (!link.aPort && cA) link.aPort = cA;
    if (!link.bPort && cB) link.bPort = cB;
  }
  if (!link.sources.includes(c.source)) link.sources.push(c.source);
  const t = timeOf(c.lastSeen);
  const cur = timeOf(link.lastSeen);
  if (t !== null && (cur === null || t > cur)) link.lastSeen = c.lastSeen;
  if (c.uplinkFrom) link.uplinkFrom = c.uplinkFrom;
}

export function buildLinks(input: TopologyModelInput, idx: NodeIndex): { links: MapLink[]; unmatched: UnmatchedNeighbor[] } {
  const ignored = new Set<string>();
  const candidates: Candidate[] = [];
  const unmatched: UnmatchedNeighbor[] = [];

  // 1. Correzioni manuali (la scelta manuale vince sempre).
  for (const o of [...input.overrides].sort((x, y) => x.id - y.id)) {
    const a = useNode(idx, canonical(idx, o.a_node));
    const b = useNode(idx, canonical(idx, o.b_node));
    if (!a || !b || a === b) continue;
    if (o.action === "ignore") ignored.add(pairKey(a, b));
    else candidates.push({ a, aPort: o.a_port, b, bPort: o.b_port, source: "manual", lastSeen: null, uplinkFrom: null });
  }

  // 2. Uplink UniFi: dal figlio (chi esce) al padre.
  const uplinkPort = new Map<number, string>();
  for (const p of [...input.uplinkPorts].sort((x, y) => x.device_id - y.device_id || x.port_index - y.port_index)) {
    if (!uplinkPort.has(p.device_id)) uplinkPort.set(p.device_id, p.port_name);
  }
  for (const d of [...input.devices].sort((x, y) => x.id - y.id)) {
    if (!d.uplink_mac) continue;
    const a = `dev:${d.id}`;
    const b = resolveNode(idx, { mac: d.uplink_mac });
    if (!b || b === a) continue;
    candidates.push({
      a, aPort: uplinkPort.get(d.id) ?? "", b,
      bPort: d.uplink_remote_port != null ? `Port ${d.uplink_remote_port}` : "",
      source: "unifi_uplink", lastSeen: d.uplink_seen_at, uplinkFrom: a,
    });
  }

  // 3. LLDP / CDP / MNDP: abbinati per IP, MAC, nome.
  const neighbors = [...input.neighbors].sort(
    (x, y) => x.device_id - y.device_id || cmp(x.local_port, y.local_port) || cmp(x.remote_device_name, y.remote_device_name) || cmp(x.remote_port, y.remote_port),
  );
  for (const n of neighbors) {
    const a = `dev:${n.device_id}`;
    if (!idx.nodes.has(a)) continue;
    const b = resolveNode(idx, { ip: n.remote_ip, mac: n.remote_mac, name: n.remote_device_name });
    if (!b) {
      unmatched.push({ deviceNodeId: a, localPort: n.local_port, remoteName: n.remote_device_name, remoteIp: n.remote_ip, remoteMac: n.remote_mac });
      continue;
    }
    if (b === a) continue;
    candidates.push({ a, aPort: n.local_port, b, bPort: n.remote_port, source: sourceOfProtocol(n.protocol), lastSeen: n.timestamp, uplinkFrom: null });
  }

  const merged = new Map<string, MapLink>();
  for (const c of candidates) {
    const key = pairKey(c.a, c.b);
    if (ignored.has(key)) continue;
    const cur = merged.get(key);
    if (cur) {
      mergeInto(cur, c);
      continue;
    }
    merged.set(key, {
      id: `link:${key}`, a: c.a, aPort: c.aPort, b: c.b, bPort: c.bPort, source: c.source, sources: [c.source],
      uplinkFrom: c.uplinkFrom, lastSeen: c.lastSeen, daysUnseen: null, stale: false,
    });
  }

  const links = [...merged.values()].sort((x, y) => cmp(x.id, y.id));
  for (const l of links) {
    l.sources.sort((x, y) => LINK_SOURCE_RANK[x] - LINK_SOURCE_RANK[y] || cmp(x, y));
    const t = timeOf(l.lastSeen);
    if (l.sources.includes("manual") || t === null) {
      l.stale = false;
      l.daysUnseen = null;
      continue;
    }
    const age = Math.max(0, input.nowMs - t);
    l.daysUnseen = Math.floor(age / DAY_MS);
    l.stale = age > input.staleDays * DAY_MS;
  }
  return { links, unmatched };
}
