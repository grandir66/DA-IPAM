/**
 * Nodi della mappa: un apparato di rete e il suo host sono UN nodo (spec §3,
 * «niente doppi»), e gli indici per abbinare un vicino a un nodo per IP, MAC e
 * nome. Una chiave contesa fra due oggetti diversi vale null: non si abbina a
 * caso (un MAC VRRP, due apparati con lo stesso nome). Logica pura.
 */
import type { MapNode, ModelDeviceRow, ModelHostRow, ModelKnownMacRow } from "@/lib/topology/model-types";
import { normalizeName } from "@/lib/topology/match";
import { normalizeMacForStorage } from "@/lib/utils";

export interface NodeIndex {
  nodes: Map<string, MapNode>;
  alias: Map<string, string>;
  byIp: Map<string, string | null>;
  byMac: Map<string, string | null>;
  byName: Map<string, string | null>;
  hostById: Map<number, ModelHostRow>;
  fusedHosts: number;
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const MAC = /^[0-9a-f]{2}([:-]?)[0-9a-f]{2}(\1[0-9a-f]{2}){4}$/i;

/** Chiave di nome, o null se il «nome» è un IP o un MAC (normalizeName taglierebbe al primo punto). */
function nameKey(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s || IPV4.test(s) || MAC.test(s)) return null;
  return normalizeName(s) || null;
}

/** weak = la chiave la mette un host: non la toglie a un apparato. */
function put(map: Map<string, string | null>, key: string | null, id: string, weak: boolean): void {
  if (!key) return;
  const cur = map.get(key);
  if (cur === undefined) {
    map.set(key, id);
    return;
  }
  if (cur === null || cur === id) return;
  if (weak && cur.startsWith("dev:")) return;
  map.set(key, null);
}

function hostNode(h: ModelHostRow): MapNode {
  return {
    id: `host:${h.id}`, kind: "host", refId: h.id, name: h.custom_name || h.hostname || h.ip,
    type: h.classification || "unknown", mgmtIp: h.ip || null, fusedHostIds: [],
    siteId: null, rackId: null, siteProposed: false, hidden: false,
  };
}

export function buildNodeIndex(devices: ModelDeviceRow[], hosts: ModelHostRow[], knownMacs: ModelKnownMacRow[]): NodeIndex {
  const idx: NodeIndex = {
    nodes: new Map(), alias: new Map(), byIp: new Map(), byMac: new Map(), byName: new Map(),
    hostById: new Map(), fusedHosts: 0,
  };
  const hostsByIp = new Map<string, ModelHostRow[]>();
  const hostsByPhys = new Map<number, ModelHostRow[]>();
  const sortedHosts = [...hosts].sort((a, b) => a.id - b.id);
  for (const h of sortedHosts) {
    idx.hostById.set(h.id, h);
    if (h.ip) hostsByIp.set(h.ip, [...(hostsByIp.get(h.ip) ?? []), h]);
    if (h.physical_device_id != null) hostsByPhys.set(h.physical_device_id, [...(hostsByPhys.get(h.physical_device_id) ?? []), h]);
  }

  const absorbedBy = new Map<number, string>();
  for (const d of [...devices].sort((a, b) => a.id - b.id)) {
    const id = `dev:${d.id}`;
    const fused: number[] = [];
    const take = (h: ModelHostRow | undefined): void => {
      if (h && !absorbedBy.has(h.id)) {
        absorbedBy.set(h.id, id);
        fused.push(h.id);
      }
    };
    if (d.host_id != null) take(idx.hostById.get(d.host_id));
    for (const h of hostsByIp.get(d.host) ?? []) take(h);
    if (d.physical_device_id != null) for (const h of hostsByPhys.get(d.physical_device_id) ?? []) take(h);
    idx.nodes.set(id, {
      id, kind: "device", refId: d.id, name: d.name, type: d.device_type, mgmtIp: d.host || null,
      fusedHostIds: fused.sort((a, b) => a - b), siteId: null, rackId: null, siteProposed: false,
      hidden: d.topology_hidden === 1,
    });
    put(idx.byIp, d.host || null, id, false);
    put(idx.byName, nameKey(d.name), id, false);
    put(idx.byMac, normalizeMacForStorage(d.controller_mac), id, false);
  }
  for (const r of knownMacs) {
    if (idx.nodes.has(`dev:${r.device_id}`)) put(idx.byMac, normalizeMacForStorage(r.mac), `dev:${r.device_id}`, false);
  }
  for (const [hostId, devId] of absorbedBy) {
    const h = idx.hostById.get(hostId);
    if (!h) continue;
    idx.alias.set(`host:${hostId}`, devId);
    put(idx.byIp, h.ip || null, devId, false);
    put(idx.byMac, normalizeMacForStorage(h.mac), devId, false);
    put(idx.byName, nameKey(h.hostname), devId, false);
    put(idx.byName, nameKey(h.custom_name), devId, false);
  }
  idx.fusedHosts = absorbedBy.size;
  for (const h of sortedHosts) {
    if (absorbedBy.has(h.id)) continue;
    const id = `host:${h.id}`;
    put(idx.byIp, h.ip || null, id, true);
    put(idx.byMac, normalizeMacForStorage(h.mac), id, true);
    put(idx.byName, nameKey(h.hostname), id, true);
    put(idx.byName, nameKey(h.custom_name), id, true);
  }
  return idx;
}

export function canonical(idx: NodeIndex, nodeId: string): string {
  return idx.alias.get(nodeId) ?? nodeId;
}

/** Il nodo (creato al bisogno se è un host), o null se non esiste. */
export function useNode(idx: NodeIndex, nodeId: string): string | null {
  const id = canonical(idx, nodeId);
  if (idx.nodes.has(id)) return id;
  const m = /^host:(\d+)$/.exec(id);
  const h = m ? idx.hostById.get(Number(m[1])) : undefined;
  if (!h) return null;
  idx.nodes.set(id, hostNode(h));
  return id;
}

/** Abbinamento di un vicino: IP, poi MAC, poi nome (spec §3). Una chiave contesa passa al criterio dopo. */
export function resolveNode(idx: NodeIndex, ref: { ip?: string | null; mac?: string | null; name?: string | null }): string | null {
  const name = ref.name?.trim() ?? "";
  const macs = [normalizeMacForStorage(ref.mac ?? null), MAC.test(name) ? normalizeMacForStorage(name) : null];
  const candidates: Array<string | null | undefined> = [
    ref.ip ? idx.byIp.get(ref.ip) : undefined,
    ...macs.map((m) => (m ? idx.byMac.get(m) : undefined)),
    IPV4.test(name) ? idx.byIp.get(name) : undefined,
    (() => {
      const k = nameKey(name);
      return k ? idx.byName.get(k) : undefined;
    })(),
  ];
  for (const c of candidates) {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- useNode non è un hook React (nome fissato dall'interfaccia)
    if (typeof c === "string") return useNode(idx, c);
  }
  return null;
}
