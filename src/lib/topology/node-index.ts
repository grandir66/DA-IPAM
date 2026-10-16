/**
 * Nodi della mappa: un apparato di rete e il suo host sono UN nodo (spec §3,
 * «niente doppi»), e gli indici per abbinare un vicino a un nodo per IP, MAC e
 * nome. Una chiave contesa fra due oggetti diversi vale null: non si abbina a
 * caso (un MAC VRRP, due apparati con lo stesso nome). Logica pura.
 */
import type { MapNode, ModelDeviceRow, ModelHostRow, ModelKnownMacRow, ModelNeighborRow, TopologyModelInput } from "@/lib/topology/model-types";
import type { ComeFuso, ModelSeparazioneRow, ModelUnioneRow } from "@/lib/topology/unioni-tipi";
import { normalizeName } from "@/lib/topology/match";
import { normalizeMacForStorage } from "@/lib/utils";
import { IDENTITY_TYPES, announcedNames, identifiesByName, isVirtualMac, realOui, ruoloLetto } from "@/lib/topology/identity";

export interface NodeIndex {
  nodes: Map<string, MapNode>;
  alias: Map<string, string>;
  byIp: Map<string, string | null>;
  byMac: Map<string, string | null>;
  byName: Map<string, string | null>;
  hostById: Map<number, ModelHostRow>;
  fusedHosts: number;
  /** Host fusi fra loro senza apparato (spec §10.4). */
  mergedHosts: number;
  // Unioni e separazioni a mano (ADR 0021): interni, mai serializzati.
  /** Perché un host sta nel nodo di un altro oggetto (il rappresentante di un nodo di soli host non c'è). */
  come: Map<number, ComeFuso>;
  /** Nodo → host entrati a mano, in ordine di id. */
  aMano: Map<string, number[]>;
  /** Gruppi che finirebbero in due o più apparati: non si applicano (Scelte 5). */
  nonApplicate: Array<{ gruppo: number; membri: string[]; apparati: string[] }>;
  /** Membri delle unioni che non esistono più (host o apparato cancellati). */
  mancanti: string[];
}

/** Le scelte a mano che l'indice applica: senza righe, l'indice di sempre. */
export interface SceltePerNodi { unioni: readonly ModelUnioneRow[]; separazioni: readonly ModelSeparazioneRow[] }
export const NESSUNA_SCELTA: SceltePerNodi = { unioni: [], separazioni: [] };

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const MAC = /^[0-9a-f]{2}([:-]?)[0-9a-f]{2}(\1[0-9a-f]{2}){4}$/i;

/** Chiave di nome, o null se il «nome» è un IP o un MAC (normalizeName taglierebbe al primo punto). */
export function nameKey(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s || IPV4.test(s) || MAC.test(s)) return null;
  return normalizeName(s) || null;
}

/** Chiave di nome che vale per fondere (spec §10.4 punti 2-3): niente nomi di fabbrica né pezzi di MAC. */
function identityKey(raw: string | null | undefined): string | null {
  const k = nameKey(raw);
  return k && identifiesByName(k) ? k : null;
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

/** Un MAC VRRP/HSRP passa da un router all'altro: non entra nell'indice per MAC (spec §10.4 punto 1). */
function putMac(map: Map<string, string | null>, raw: string | null | undefined, id: string, weak: boolean): void {
  const m = normalizeMacForStorage(raw ?? null);
  if (m && !isVirtualMac(m)) put(map, m, id, weak);
}

/** Registra altri MAC veri di un nodo (le schede vive di un hypervisor): come un host, non tolgono nulla a un apparato. */
export function addNodeMacs(idx: NodeIndex, nodeId: string, macs: readonly string[]): void {
  for (const m of macs) putMac(idx.byMac, m, nodeId, true);
}

function hostNode(h: ModelHostRow): MapNode {
  return {
    id: `host:${h.id}`, kind: "host", refId: h.id, name: h.custom_name || h.hostname || h.ip,
    type: h.classification || "unknown", mgmtIp: h.ip || null, fusedHostIds: [],
    addresses: h.ip ? [{ ip: h.ip, virtual: isVirtualMac(h.mac), hostId: h.id }] : [], aliases: [],
    siteId: null, rackId: null, siteProposed: false, hidden: false, vendor: null,
  };
}

/**
 * Fuori da qui e dalle prove l'indice si costruisce solo con `indiceDeiNodi` (lucchetto in unioni-indice.test.ts): le due mappe
 * (model.ts per T1, cavi/modello.ts per T3) devono vedere gli stessi nodi, unioni e separazioni comprese.
 */
export function buildNodeIndex(devices: ModelDeviceRow[], hosts: ModelHostRow[], knownMacs: ModelKnownMacRow[],
  neighbors: ModelNeighborRow[] = [], scelte: SceltePerNodi = NESSUNA_SCELTA,
): NodeIndex {
  const idx: NodeIndex = {
    nodes: new Map(), alias: new Map(), byIp: new Map(), byMac: new Map(), byName: new Map(),
    hostById: new Map(), fusedHosts: 0, mergedHosts: 0, come: new Map(), aMano: new Map(), nonApplicate: [], mancanti: [],
  };
  const hostsByIp = new Map<string, ModelHostRow[]>();
  const hostsByPhys = new Map<number, ModelHostRow[]>();
  const sortedHosts = [...hosts].sort((a, b) => a.id - b.id);
  for (const h of sortedHosts) {
    idx.hostById.set(h.id, h);
    if (h.ip) hostsByIp.set(h.ip, [...(hostsByIp.get(h.ip) ?? []), h]);
    if (h.physical_device_id != null) hostsByPhys.set(h.physical_device_id, [...(hostsByPhys.get(h.physical_device_id) ?? []), h]);
  }
  // Separazioni a mano: «questo host non si fonde da solo con quell'oggetto». Fra due host vale nei due versi.
  const sep = new Map<number, Set<string>>();
  const segna = (h: number, altro: string): void => { sep.set(h, new Set([...(sep.get(h) ?? []), altro])); };
  for (const s of scelte.separazioni) {
    const m = /^host:(\d+)$/.exec(s.membro);
    if (!m) continue;
    segna(Number(m[1]), s.altro);
    const o = /^host:(\d+)$/.exec(s.altro);
    if (o) segna(Number(o[1]), s.membro);
  }
  const separato = (h: number, altro: string): boolean => sep.get(h)?.has(altro) === true;

  const absorbedBy = new Map<number, string>();
  for (const d of [...devices].sort((a, b) => a.id - b.id)) {
    const id = `dev:${d.id}`;
    const fused: number[] = [];
    const take = (h: ModelHostRow | undefined, come: ComeFuso): void => {
      if (h && !absorbedBy.has(h.id)) {
        absorbedBy.set(h.id, id);
        fused.push(h.id);
        idx.come.set(h.id, come);
      }
    };
    // L'host del host_id e quello con l'IP di gestione sono l'apparato: una separazione non li tocca (NON_SEPARABILI).
    if (d.host_id != null) take(idx.hostById.get(d.host_id), "host_dell_apparato");
    for (const h of hostsByIp.get(d.host) ?? []) take(h, "stesso_ip");
    if (d.physical_device_id != null) {
      for (const h of hostsByPhys.get(d.physical_device_id) ?? []) if (!separato(h.id, id)) take(h, "stesso_apparato_fisico");
    }
    idx.nodes.set(id, {
      id, kind: "device", refId: d.id, name: d.name, type: d.device_type, mgmtIp: d.host || null,
      fusedHostIds: fused.sort((a, b) => a - b), addresses: [], aliases: [], siteId: null, rackId: null, siteProposed: false,
      hidden: d.topology_hidden === 1, vendor: d.vendor || null, ...(d.proxmox_scan === 1 ? { proxmoxScan: true } : {}),
      // Come lo legge il modello (Review Focus 7): «core» e «accesso» di T3 sono «rete», così il menu segna il ruolo vero.
      ...(ruoloLetto(d.topology_role) ? { ruolo: ruoloLetto(d.topology_role)! } : {}),
      ...(d.via ? { via: d.via } : {}),
    });
    put(idx.byIp, d.host || null, id, false);
    put(idx.byName, nameKey(d.name), id, false);
    putMac(idx.byMac, d.controller_mac, id, false);
  }
  for (const r of knownMacs) {
    if (idx.nodes.has(`dev:${r.device_id}`)) putMac(idx.byMac, r.mac, `dev:${r.device_id}`, false);
  }
  // Un host col MAC di UN solo apparato è un'altra interfaccia (VLAN, VRRP) dello stesso oggetto fisico:
  // si fonde con lui. Un MAC di due o più apparati (VRRP condiviso) è ambiguo e non assorbe nulla.
  // Viene dopo le regole per host_id, IP e identità fisica: un host già assorbito non si sposta.
  const macOwners = new Map<string, Set<string>>();
  const own = (mac: string | null | undefined, devId: string): void => {
    const m = normalizeMacForStorage(mac ?? null);
    if (!m || isVirtualMac(m)) return; // un MAC virtuale non ha padrone
    const set = macOwners.get(m) ?? new Set<string>();
    set.add(devId);
    macOwners.set(m, set);
  };
  for (const d of devices) own(d.controller_mac, `dev:${d.id}`);
  for (const r of knownMacs) if (idx.nodes.has(`dev:${r.device_id}`)) own(r.mac, `dev:${r.device_id}`);
  for (const h of sortedHosts) {
    if (absorbedBy.has(h.id)) continue;
    const m = normalizeMacForStorage(h.mac);
    if (isVirtualMac(m)) continue; // un MAC VRRP/HSRP non identifica nessuno
    const owners = m ? macOwners.get(m) : undefined;
    if (!owners || owners.size !== 1) continue;
    const devId = [...owners][0];
    const node = idx.nodes.get(devId);
    if (!node || separato(h.id, devId)) continue;
    absorbedBy.set(h.id, devId);
    idx.come.set(h.id, "stesso_mac");
    node.fusedHostIds = [...node.fusedHostIds, h.id].sort((a, b) => a - b);
  }
  // Spec §10.4 punto 3: il nome annunciato da un host già fuso è un alias dell'apparato.
  const announced = announcedNames(sortedHosts, neighbors);
  const namesOf = (h: ModelHostRow): string[] =>
    [h.hostname, h.custom_name, ...(announced.get(h.id) ?? [])].map((s) => identityKey(s)).filter((k): k is string => !!k);
  const aliasOwner = new Map<string, string | null>();
  const claim = (k: string, devId: string): void => {
    aliasOwner.set(k, aliasOwner.has(k) && aliasOwner.get(k) !== devId ? null : devId);
  };
  for (const d of devices) { const k = identityKey(d.name); if (k) claim(k, `dev:${d.id}`); }
  for (const [hostId, devId] of absorbedBy) { const h = idx.hostById.get(hostId); if (h) for (const k of namesOf(h)) claim(k, devId); }
  for (const h of sortedHosts) {
    if (absorbedBy.has(h.id) || !IDENTITY_TYPES.includes(h.classification ?? "")) continue;
    const m = normalizeMacForStorage(h.mac);
    const owners = m && !isVirtualMac(m) ? macOwners.get(m) : undefined; // MAC vero di un altro apparato = contraddizione
    const devId = namesOf(h).map((k) => aliasOwner.get(k)).find((v): v is string => typeof v === "string");
    if (!devId || (owners && !owners.has(devId)) || separato(h.id, devId)) continue;
    absorbedBy.set(h.id, devId);
    idx.come.set(h.id, "stesso_nome");
    const node = idx.nodes.get(devId)!;
    node.fusedHostIds = [...node.fusedHostIds, h.id].sort((a, b) => a - b);
  }
  // Spec §10.4 punti 1-2: gli host rimasti si raggruppano per MAC vero (tutti) e per nome (solo infrastruttura e server).
  // La radice di un gruppo è il suo id più basso; con una separazione due gruppi che la contraddirebbero non si uniscono.
  const parent = new Map<number, number>();
  const find = (x: number): number => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
  const membri = new Map<number, number[]>(); // radice → membri
  const membriDi = (r: number): number[] => membri.get(r) ?? [r];
  const puo = (a: number, b: number): boolean => {
    if (sep.size === 0) return true;
    const B = membriDi(find(b));
    return !membriDi(find(a)).some((x) => B.some((y) => separato(x, `host:${y}`)));
  };
  /** «a_mano» vince sulle separazioni: le rotte tolgono quelle che contraddirebbe. */
  const union = (a: number, b: number, come: ComeFuso): boolean => {
    const ra = find(a), rb = find(b);
    if (ra === rb) return true;
    if (come !== "a_mano" && !puo(ra, rb)) return false;
    const lo = Math.min(ra, rb), hi = Math.max(ra, rb);
    parent.set(hi, lo);
    const sposta = membriDi(hi);
    membri.set(lo, [...membriDi(lo), ...sposta]);
    membri.delete(hi);
    for (const x of sposta) if (!idx.come.has(x)) idx.come.set(x, come);
    return true;
  };
  const firstBy = new Map<string, number>();
  for (const h of sortedHosts) {
    if (absorbedBy.has(h.id)) continue;
    const m = normalizeMacForStorage(h.mac);
    if (!m || isVirtualMac(m)) continue;
    const f = firstBy.get(m);
    if (f === undefined) firstBy.set(m, h.id); else union(f, h.id, "stesso_mac");
  }
  // Per nome solo se nessun MAC vero lo contraddice: due gruppi con MAC veri di OUI diversi sono due oggetti.
  const ouis = new Map<number, Set<string>>(); // rappresentante → OUI dei MAC veri del gruppo
  for (const h of sortedHosts) {
    const o = absorbedBy.has(h.id) ? null : realOui(normalizeMacForStorage(h.mac));
    if (o) ouis.set(find(h.id), new Set([...(ouis.get(find(h.id)) ?? []), o]));
  }
  const compatible = (a: number, b: number): boolean => new Set([...(ouis.get(find(a)) ?? []), ...(ouis.get(find(b)) ?? [])]).size <= 1;
  const byName = new Map<string, number[]>();
  for (const h of sortedHosts) {
    if (absorbedBy.has(h.id) || !IDENTITY_TYPES.includes(h.classification ?? "")) continue;
    for (const k of namesOf(h)) {
      const seen = byName.get(k) ?? [];
      const other = seen.find((x) => find(x) !== find(h.id) && compatible(x, h.id) && puo(x, h.id));
      if (other !== undefined) {
        const merged = new Set([...(ouis.get(find(other)) ?? []), ...(ouis.get(find(h.id)) ?? [])]);
        if (union(other, h.id, "stesso_nome")) ouis.set(find(h.id), merged);
      }
      byName.set(k, [...seen, h.id]);
    }
  }
  // Unioni a mano: dopo TUTTE le regole automatiche (decisione 1). Ogni membro va nel nodo che lo contiene adesso.
  const perGruppo = new Map<number, string[]>();
  for (const u of [...scelte.unioni].sort((x, y) => x.gruppo - y.gruppo || (x.membro < y.membro ? -1 : x.membro > y.membro ? 1 : 0))) {
    perGruppo.set(u.gruppo, [...(perGruppo.get(u.gruppo) ?? []), u.membro]);
  }
  const radicePrima = new Map<number, number>(); // host → la radice del suo gruppo prima della prima unione a mano
  for (const [gruppo, elenco] of perGruppo) {
    const apparati = new Set<string>(), radici = new Set<number>(), espliciti = new Set<number>();
    for (const m of elenco) {
      const hm = /^host:(\d+)$/.exec(m);
      if (/^dev:\d+$/.test(m) && idx.nodes.has(m)) apparati.add(m);
      else if (hm && idx.hostById.has(Number(hm[1]))) {
        const hid = Number(hm[1]);
        espliciti.add(hid);
        const dev = absorbedBy.get(hid);
        if (dev) apparati.add(dev); else radici.add(find(hid));
      } else idx.mancanti.push(m);
    }
    if (apparati.size + radici.size < 2) continue;
    if (apparati.size >= 2) { idx.nonApplicate.push({ gruppo, membri: [...elenco].sort(), apparati: [...apparati].sort() }); continue; }
    if (apparati.size === 1) {
      const devId = [...apparati][0];
      const entrano: number[] = [];
      for (const h of sortedHosts) {
        if (absorbedBy.has(h.id) || !radici.has(find(h.id))) continue;
        if (!espliciti.has(h.id) && separato(h.id, devId)) continue; // un gemello separato a mano resta fuori
        absorbedBy.set(h.id, devId);
        idx.come.set(h.id, "a_mano");
        entrano.push(h.id);
      }
      const node = idx.nodes.get(devId)!;
      node.fusedHostIds = [...node.fusedHostIds, ...entrano].sort((a, b) => a - b);
      idx.aMano.set(devId, [...(idx.aMano.get(devId) ?? []), ...entrano].sort((a, b) => a - b));
    } else {
      const rs = [...radici].sort((a, b) => a - b);
      for (const h of sortedHosts) {
        if (!absorbedBy.has(h.id) && radici.has(find(h.id)) && !radicePrima.has(h.id)) radicePrima.set(h.id, find(h.id));
      }
      for (const r of rs.slice(1)) union(rs[0], r, "a_mano");
    }
  }
  // Il rappresentante di un gruppo è il primo membro rimasto: senza unioni a mano è la radice (l'id più basso), con un'unione
  // verso un apparato la radice può esservi entrata e il gemello separato resta il nodo di sé stesso.
  const groupMembers = new Map<number, ModelHostRow[]>(); // radice → membri rimasti, in ordine di id
  const repOf = new Map<number, number>();
  for (const h of sortedHosts) {
    if (absorbedBy.has(h.id)) continue;
    const r = find(h.id);
    groupMembers.set(r, [...(groupMembers.get(r) ?? []), h]);
  }
  for (const members of groupMembers.values()) {
    const rep = members[0].id;
    for (const m of members) repOf.set(m.id, rep);
    idx.come.delete(rep); // il rappresentante è l'oggetto del nodo, non un host fuso
  }
  for (const members of groupMembers.values()) {
    if (members.length < 2) continue;
    const rep = members[0].id;
    const node = hostNode(members[0]);
    const named = members
      .flatMap((m) => [m.custom_name, m.hostname, ...(announced.get(m.id) ?? [])])
      .find((s) => !!nameKey(s));
    if (named) node.name = named.trim();
    node.fusedHostIds = members.filter((m) => m.id !== rep).map((m) => m.id);
    idx.nodes.set(node.id, node);
    for (const m of members) if (m.id !== rep) idx.alias.set(`host:${m.id}`, node.id);
    idx.mergedHosts += members.length - 1;
  }
  // Fra soli host è entrato a mano chi stava, prima delle unioni, in un gruppo diverso da quello del rappresentante.
  for (const [h, prima] of radicePrima) {
    const rep = repOf.get(h);
    if (rep === undefined || rep === h || prima === radicePrima.get(rep)) continue;
    idx.come.set(h, "a_mano");
    const nodo = `host:${rep}`;
    idx.aMano.set(nodo, [...(idx.aMano.get(nodo) ?? []), h].sort((a, b) => a - b));
  }
  // I nomi di un host entrato a mano in un apparato restano chiavi di un host (revisione finale, 16/10): deboli e dopo gli host
  // rimasti, così un nome conteso con un altro host resta conteso e non passa all'apparato. IP e MAC restano dell'apparato.
  const nomiAMano: Array<[ModelHostRow, string]> = [];
  for (const [hostId, devId] of absorbedBy) {
    const h = idx.hostById.get(hostId);
    if (!h) continue;
    idx.alias.set(`host:${hostId}`, devId);
    put(idx.byIp, h.ip || null, devId, false);
    putMac(idx.byMac, h.mac, devId, false);
    if (idx.come.get(hostId) === "a_mano") {
      nomiAMano.push([h, devId]);
      continue;
    }
    put(idx.byName, nameKey(h.hostname), devId, false);
    put(idx.byName, nameKey(h.custom_name), devId, false);
  }
  idx.fusedHosts = absorbedBy.size;
  for (const h of sortedHosts) {
    if (absorbedBy.has(h.id)) continue;
    const id = `host:${repOf.get(h.id) ?? h.id}`;
    put(idx.byIp, h.ip || null, id, true);
    putMac(idx.byMac, h.mac, id, true);
    put(idx.byName, nameKey(h.hostname), id, true);
    put(idx.byName, nameKey(h.custom_name), id, true);
  }
  for (const [h, devId] of nomiAMano) {
    put(idx.byName, nameKey(h.hostname), devId, true);
    put(idx.byName, nameKey(h.custom_name), devId, true);
  }
  // Indirizzi e alias di ogni nodo con host fusi.
  const ipOrder = (a: string, b: string): number => {
    const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
    for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return (pa[i] || 0) - (pb[i] || 0);
    return a.localeCompare(b);
  };
  for (const node of idx.nodes.values()) {
    const fused = node.fusedHostIds.map((i) => idx.hostById.get(i)).filter((h): h is ModelHostRow => !!h);
    const members = node.kind === "host" ? [idx.hostById.get(node.refId), ...fused].filter((h): h is ModelHostRow => !!h) : fused;
    if (members.length === 0 && node.kind === "host") continue;
    const addrs = new Map<string, { ip: string; virtual: boolean; hostId: number | null }>();
    if (node.kind === "device" && node.mgmtIp) {
      addrs.set(node.mgmtIp, { ip: node.mgmtIp, virtual: false, hostId: members.find((h) => h.ip === node.mgmtIp)?.id ?? null });
    }
    for (const h of members) if (h.ip && !addrs.has(h.ip)) addrs.set(h.ip, { ip: h.ip, virtual: isVirtualMac(h.mac), hostId: h.id });
    node.addresses = [...addrs.values()].sort((a, b) => ipOrder(a.ip, b.ip));
    const own = nameKey(node.name);
    const seen = new Map<string, string>();
    for (const h of members) {
      for (const s of [h.hostname, h.custom_name, ...(announced.get(h.id) ?? [])]) {
        const k = nameKey(s);
        if (k && k !== own && !seen.has(k)) seen.set(k, s!.trim());
      }
    }
    node.aliases = [...seen.values()].sort();
  }
  return idx;
}

/** L'indice dei nodi di un ingresso del modello, con le sue unioni e separazioni: l'unico modo di costruirlo fuori da qui. */
export function indiceDeiNodi(
  input: Pick<TopologyModelInput, "devices" | "hosts" | "knownMacs" | "neighbors" | "unioni" | "separazioni">,
): NodeIndex {
  return buildNodeIndex(input.devices, input.hosts, input.knownMacs, input.neighbors,
    { unioni: input.unioni ?? [], separazioni: input.separazioni ?? [] });
}

export function canonical(idx: NodeIndex, nodeId: string): string {
  return idx.alias.get(nodeId) ?? nodeId;
}

/** Il nodo (creato al bisogno se è un host), o null se non esiste. */
export function nodeFor(idx: NodeIndex, nodeId: string): string | null {
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
    if (typeof c === "string") return nodeFor(idx, c);
  }
  return null;
}
