/**
 * Attributi dei collegamenti (spec §11.3, §11.4): se un collegamento a mano è
 * confermato dai dati, velocità e PoE dalla porta dello switch, tipo (cavo,
 * fibra, wireless), scelta a mano del principale e il costo con cui l'albero
 * sceglie fra più collegamenti. Logica pura.
 */
import { parseDbDate } from "@/lib/db-date";
import { elenchiPorte, indiciInElenco, portaInElenco } from "@/lib/topology/cavi/porte";
import {
  LINK_SOURCE_RANK,
  type LinkMedium,
  type MapLink,
  type TopologyModelInput,
} from "@/lib/topology/model-types";
import { canonical, type NodeIndex } from "@/lib/topology/node-index";
import { REGOLE_T1, type Regole } from "@/lib/topology/regole";
import { resolveScanHosts } from "@/lib/topology/vms";
import { normalizeMacForStorage, normalizePortNameForMatch } from "@/lib/utils";

const DAY = 86_400_000;
/** I tipi di una correzione «aggiungi» (spec §13.9): «tunnel» da T3. Una riga a mano senza un tipo noto non ne ha. */
export const MEDIA: readonly string[] = ["cavo", "fibra", "wireless", "tunnel"];

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** «1000 Mbps» → 1000, «10G» → 10000, «2,5G» → 2500; sconosciuto o non positivo → null. */
export function parseSpeedMbps(s: string | null | undefined): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*([kmgt])?(?:b(?:ps|it|\/s)?)?\b/i.exec(s ?? "");
  if (!m) return null;
  const unit = (m[2] ?? "m").toLowerCase();
  if (unit === "k") return null;
  const v = Number(m[1].replace(",", ".")) * (unit === "g" ? 1000 : unit === "t" ? 1_000_000 : 1);
  return v > 0 ? Math.round(v) : null;
}

/**
 * Costo di un collegamento per l'albero (più basso = preferito): la scelta a mano
 * dell'admin vince su tutto; poi i collegamenti non vecchi, poi la fonte più affidabile.
 */
export function linkCost(l: MapLink): number {
  if (l.primary === "user") return -1000;
  const rank = l.source === "manual" ? (l.manual?.confirmed ? 3 : 4) : LINK_SOURCE_RANK[l.source];
  return (l.stale ? 100 : 0) + rank;
}

interface Lookups {
  /** nodo → tutti i suoi MAC veri (apparato, host fusi, schede vive dell'hypervisor). */
  macsOf: Map<string, Set<string>>;
  /** "<id apparato>|<porta normalizzata>" → MAC visti lì, con l'ora. */
  onPort: Map<string, Array<{ mac: string; ms: number }>>;
}
const cache = new WeakMap<NodeIndex, { input: TopologyModelInput; lk: Lookups }>();

function lookups(input: TopologyModelInput, idx: NodeIndex): Lookups {
  const hit = cache.get(idx);
  if (hit && hit.input === input) return hit.lk;
  const macsOf = new Map<string, Set<string>>();
  const add = (node: string, mac: string | null): void => {
    const m = normalizeMacForStorage(mac);
    if (m) macsOf.set(node, (macsOf.get(node) ?? new Set()).add(m));
  };
  for (const [mac, node] of idx.byMac) if (node) add(node, mac);
  for (const { row, nodeId } of resolveScanHosts(input.scanHosts, idx)) if (nodeId) for (const m of row.macs) add(nodeId, m);
  const onPort = new Map<string, Array<{ mac: string; ms: number }>>();
  for (const r of input.macPorts) {
    const mac = normalizeMacForStorage(r.mac);
    if (!mac) continue;
    const k = `${r.device_id}|${normalizePortNameForMatch(r.port_name)}`;
    onPort.set(k, [...(onPort.get(k) ?? []), { mac, ms: parseDbDate(r.timestamp).getTime() }]);
  }
  const lk = { macsOf, onPort };
  cache.set(idx, { input, lk });
  return lk;
}

/**
 * Un collegamento a mano è confermato se i dati lo vedono: un collegamento automatico fra gli stessi
 * nodi (non vecchio), oppure un MAC dell'altro nodo — anche di una scheda viva dell'hypervisor o di un
 * suo host fuso — visto non vecchio sulla porta dichiarata di questo (tabella MAC per porta).
 */
export function confirmManual(link: MapLink, input: TopologyModelInput, idx: NodeIndex): boolean {
  const soglia = input.staleDays * DAY;
  // Un collegamento automatico non vecchio fra gli stessi oggetti: sulla linea o fra gli altri cavi visti. In T1 la
  // verifica resta per coppia (§11.3); per cavo da T3 (spec §13.9).
  const automatici = [
    ...(link.sources.some((s) => s !== "manual") ? [link.lastSeen] : []),
    ...(link.altriCavi ?? []).filter((c) => c.sources.some((s) => s !== "manual")).map((c) => c.lastSeen),
  ];
  for (const s of automatici) {
    const t = s ? parseDbDate(s).getTime() : NaN;
    if (Number.isNaN(t) || input.nowMs - t <= soglia) return true;
  }
  return macSullaPorta(input, idx, link.a, link.aPort, link.b) || macSullaPorta(input, idx, link.b, link.bPort, link.a);
}

/**
 * Un MAC dell'oggetto `altro` (anche di una scheda viva dell'hypervisor o di un host fuso) visto non vecchio sulla porta `porta`
 * di `nodo` (tabella MAC per porta). La verifica a mano di `confirmManual`, e da T3 quella per cavo del modello per cavo (§13.9).
 */
export function macSullaPorta(input: TopologyModelInput, idx: NodeIndex, nodo: string, porta: string, altro: string): boolean {
  const { macsOf, onPort } = lookups(input, idx);
  const m = /^dev:(\d+)$/.exec(nodo);
  const wanted = macsOf.get(altro);
  if (!m || !wanted || !porta.trim()) return false;
  return (onPort.get(`${m[1]}|${normalizePortNameForMatch(porta)}`) ?? []).some((r) => wanted.has(r.mac) && input.nowMs - r.ms <= input.staleDays * DAY);
}

/** Riempie manual, medium, velocità, PoE e la scelta a mano del principale. Le copie del modello sono nuove: si modificano sul posto. */
export function enrichLinks(links: MapLink[], input: TopologyModelInput, idx: NodeIndex, regole: Regole = REGOLE_T1): void {
  const portInfo = new Map<string, TopologyModelInput["portInfo"][number]>();
  for (const p of input.portInfo) portInfo.set(`${p.device_id}|${normalizePortNameForMatch(p.port_name)}`, p);
  const elenchi = elenchiPorte(input.ports ?? []);
  // Il tipo della chiave va scritto: con `as const` diventa `dev:${number}|${number}` e la lettura con una stringa non compila.
  const velocitaPorta = new Map<string, string | null>((input.ports ?? []).map((p) => [`dev:${p.device_id}|${p.port_index}`, p.speed]));
  /**
   * La velocità di una porta per chiave (spec §13.6.1): l'indice nell'elenco delle porte dell'apparato. Per nome, «SFP_ N»
   * della tabella LLDP del controller non trovava «SFP+ N» dell'elenco: sull'hub tre hypervisor finivano sotto lo switch
   * di gestione a 2,5G invece che sotto l'aggregazione a 10G (H9). Senza elenco (prove e fixture di prima), per nome.
   */
  const velocita = (nodo: string, porta: string): number | null => {
    if (!porta.trim()) return null;
    const el = elenchi.get(nodo);
    if (el) {
      const i = portaInElenco(el, porta);
      if (i !== null) return parseSpeedMbps(velocitaPorta.get(`${nodo}|${i}`) ?? null);
      // Un nome doppio (spec §13.6.1, I70; regola «velocita-nomi-doppi»): la porta non si sa, ma se tutte le porte con quel
      // nome hanno la stessa velocità la velocità sì. Rete B: il cavo dati di un hypervisor su un nome di due porte a 10G (H13).
      if (!regole.has("velocita-nomi-doppi")) return null;
      const v = [...new Set(indiciInElenco(el, porta).map((k) => parseSpeedMbps(velocitaPorta.get(`${nodo}|${k}`) ?? null)))];
      return v.length === 1 ? v[0] : null;
    }
    const m = /^dev:(\d+)$/.exec(nodo);
    const r = m ? portInfo.get(`${m[1]}|${normalizePortNameForMatch(porta)}`) : undefined;
    return r ? parseSpeedMbps(r.speed) : null;
  };
  const uplinkType = new Map(input.devices.map((d) => [`dev:${d.id}`, d.uplink_type]));
  const mediumByPair = new Map<string, LinkMedium>();
  for (const o of [...input.overrides].sort((x, y) => x.id - y.id)) {
    if (o.action === "add" && o.medium && MEDIA.includes(o.medium)) {
      mediumByPair.set(pairKey(canonical(idx, o.a_node), canonical(idx, o.b_node)), o.medium as LinkMedium);
    }
  }
  const chosen = new Map<string, string>(); // coppia → il figlio per cui l'admin ha scelto questo collegamento
  for (const p of input.primaries) chosen.set(pairKey(canonical(idx, p.node_id), canonical(idx, p.other_node)), canonical(idx, p.node_id));

  const ends = (l: MapLink): Array<{ deviceId: string; port: string }> =>
    [{ n: l.a, port: l.aPort }, { n: l.b, port: l.bPort }]
      .map((e) => ({ deviceId: /^dev:(\d+)$/.exec(e.n)?.[1] ?? "", port: e.port }))
      .filter((e) => e.deviceId !== "" && e.port.trim() !== "");

  for (const l of links) {
    const key = pairKey(l.a, l.b);
    l.manual = l.sources.includes("manual") ? { confirmed: confirmManual(l, input, idx) } : null;
    const speeds = [velocita(l.a, l.aPort), velocita(l.b, l.bPort)].filter((v): v is number => v !== null);
    l.speedMbps = speeds.length ? Math.min(...speeds) : null;
    const rows = ends(l).map((e) => portInfo.get(`${e.deviceId}|${normalizePortNameForMatch(e.port)}`)).filter((r): r is NonNullable<typeof r> => !!r);
    const poe = rows.map((r) => (r.poe_power_mw ?? 0) / 1000).filter((v) => v > 0);
    l.poeW = poe.length ? Math.max(...poe) : null;
    const wireless =
      (l.uplinkFrom !== null && l.sources.includes("unifi_uplink") && uplinkType.get(l.uplinkFrom) === "wireless") ||
      [l.aPort, l.bPort].some((p) => p.trim().toLowerCase() === "wifi");
    l.medium = mediumByPair.get(key) ?? (wireless || l.medium === "wireless" ? "wireless" : null); // senza fili dal traduttore (I47)
    const child = chosen.get(key);
    if (child !== undefined) {
      l.primary = "user";
      l.primaryFor = child;
    }
  }
}
