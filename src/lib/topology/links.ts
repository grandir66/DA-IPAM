/**
 * Collegamenti della mappa (spec §3): correzioni manuali, uplink UniFi,
 * LLDP/CDP/MNDP. Uno per coppia di nodi, con la fonte più affidabile, tutte le
 * fonti che lo vedono e quando è stato visto l'ultima volta. Un collegamento
 * che sparisce non si cancella: dopo `staleDays` è «non visto da N giorni».
 * Logica pura.
 */
import { parseDbDate } from "@/lib/db-date";
import {
  LINK_ATTRS_DEFAULT,
  LINK_SOURCE_RANK,
  type LinkSource,
  type MapLink,
  type TopologyModelInput,
  type UnmatchedNeighbor,
} from "@/lib/topology/model-types";
import { canonical, resolveNode, nodeFor, type NodeIndex } from "@/lib/topology/node-index";

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

function isRouterNode(idx: NodeIndex, id: string): boolean {
  const t = idx.nodes.get(id)?.type;
  return t === "router" || t === "firewall";
}

/**
 * Porte fisiche MikroTik per prefisso (Task 1b): `ether1-2.5` è una ether rinominata (porta da 2,5G),
 * `sfp-sfpplus1`, `sfp28-1`, `combo1`, `qsfp28-1-1`, `bond1` (un fascio di cavi verso un apparato).
 * Dopo il numero può venire solo un suffisso col trattino fatto di cifre e punti, con una «g» in fondo
 * per una velocità (`-2.5`, `-10g`, `-2.5g`): `ether1.20` resta una sottointerfaccia, e `ether1-vlan20`
 * (una VLAN rinominata) non è fisica (revisione finale M-7).
 */
const MIKROTIK_FISICA = /^(ether|sfp-sfpplus|sfp28-|sfp|combo|qsfp\w*?-?|bond)\d+(-\d+(\.\d+)*g?)?$/;
/** Un nome MikroTik rinominato col trattino (`ether1-qualcosa`): se non è in MIKROTIK_FISICA non è una porta fisica. */
const MIKROTIK_RINOMINATA = /^(ether|sfp-sfpplus|sfp28-|sfp|combo|qsfp\w*?-?|bond)\d+-/;
/** Interfacce che non sono un cavo: bridge, VLAN, VRRP, tunnel, wireless, loopback, PPP. */
const LOGICA = /^(bridge|vlan|vrrp|eoip|gre|ipip|6to4|vxlan|wg|wireguard|ovpn|pppoe|pptp|l2tp|sstp|lte|wlan|wifi|lo$|loopback|veth)/;

/**
 * La porta fisica di un nome di porta, o null. MNDP riporta la porta di un bridge come «ether3,bridge»:
 * conta il primo elemento. Un nome MikroTik si riconosce dal prefisso (`MIKROTIK_FISICA`); per gli
 * altri vale la regola della tappa 0 (niente bridge/VLAN/VRRP, niente punti: «Gi0/1.10» è una sottointerfaccia).
 */
export function physicalPortName(port: string): string | null {
  const primo = port.split(",")[0].trim();
  const p = primo.toLowerCase();
  if (p === "" || LOGICA.test(p)) return null;
  if (MIKROTIK_FISICA.test(p)) return primo;
  if (MIKROTIK_RINOMINATA.test(p)) return null;
  if (port.includes(",") || p.includes(".")) return null;
  return primo;
}

export function isPhysicalPort(port: string): boolean {
  return physicalPortName(port) !== null;
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

export function buildLinks(
  input: TopologyModelInput,
  idx: NodeIndex,
): { links: MapLink[]; unmatched: UnmatchedNeighbor[]; ignored: ReadonlySet<string> } {
  const ignored = new Set<string>();
  const candidates: Candidate[] = [];
  const unmatched: UnmatchedNeighbor[] = [];

  // 1. Correzioni manuali (la scelta manuale vince sempre).
  for (const o of [...input.overrides].sort((x, y) => x.id - y.id)) {
    const a = nodeFor(idx, canonical(idx, o.a_node));
    const b = nodeFor(idx, canonical(idx, o.b_node));
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
  const resolved: Array<{ n: (typeof neighbors)[number]; a: string; b: string }> = [];
  for (const n of neighbors) {
    const a = `dev:${n.device_id}`;
    if (!idx.nodes.has(a)) continue;
    const b = resolveNode(idx, { ip: n.remote_ip, mac: n.remote_mac, name: n.remote_device_name });
    if (!b) {
      unmatched.push({ deviceNodeId: a, localPort: n.local_port, remoteName: n.remote_device_name, remoteIp: n.remote_ip, remoteMac: n.remote_mac });
      continue;
    }
    if (b === a) continue;
    resolved.push({ n, a, b });
  }
  // Spec §11.1: un router sente tutti gli annunci del suo segmento, anche quelli dietro uno switch.
  // Un suo vicino diventa collegamento solo se è diretto; gli altri restano negli indici (abbinamento, «non visto»).
  // Task 1b: la conferma vale per LLDP e CDP, che gli switch non inoltrano; MNDP è un broadcast UDP
  // che attraversa gli switch, quindi «ti vedo e mi vedi» via MNDP non prova un cavo.
  const conferme = new Set<string>(); // «x>y»: x vede y su una sua porta via LLDP/CDP, o c'è un uplink fra loro
  for (const c of candidates) if (c.source === "unifi_uplink") { conferme.add(`${c.a}>${c.b}`); conferme.add(`${c.b}>${c.a}`); }
  for (const r of resolved) {
    if (sourceOfProtocol(r.n.protocol) === "mndp") continue;
    if (!isRouterNode(idx, r.a) || isPhysicalPort(r.n.local_port)) conferme.add(`${r.a}>${r.b}`);
  }
  // «ether3» e «ether3,bridge» sono la stessa porta: si contano i vicini sulla porta fisica.
  const portaDi = (local: string) => physicalPortName(local) ?? local;
  const sullaPorta = new Map<string, Set<string>>();
  for (const r of resolved) {
    const k = `${r.a}|${portaDi(r.n.local_port)}`;
    sullaPorta.set(k, (sullaPorta.get(k) ?? new Set()).add(r.b));
  }
  for (const { n, a, b } of resolved) {
    let aPort = n.local_port;
    if (isRouterNode(idx, a)) {
      const fisica = physicalPortName(n.local_port);
      const diretto = fisica !== null && (sullaPorta.get(`${a}|${fisica}`)?.size ?? 0) === 1;
      if (!diretto && !conferme.has(`${b}>${a}`)) continue;
      if (fisica) aPort = fisica;
    }
    candidates.push({ a, aPort, b, bPort: n.remote_port, source: sourceOfProtocol(n.protocol), lastSeen: n.timestamp, uplinkFrom: null });
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
      uplinkFrom: c.uplinkFrom, lastSeen: c.lastSeen, daysUnseen: null, stale: false, ...LINK_ATTRS_DEFAULT,
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
  return { links, unmatched, ignored };
}
