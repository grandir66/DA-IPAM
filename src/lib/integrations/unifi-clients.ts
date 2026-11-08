/**
 * Client collegati letti dal controller UniFi (`GET /api/s/<site>/stat/sta`,
 * sola lettura) → righe della tabella dei MAC per porta (spec §10.5).
 * Logica pura. MAC normalizzati come nel resto dell'app.
 *
 * Si prendono solo MAC, switch, porta, AP e ultimo visto. La tappa 4 del piano
 * di miglioramento userà la STESSA lettura per i dati di riconoscimento (nome,
 * alias, famiglia, sistema operativo, VLAN, primo visto): si aggiungono campi a
 * `UnifiStaClient` e a `parseStaRecord`, senza cambiare la chiamata.
 */
import { normalizeMacForStorage } from "@/lib/utils";
import { UnifiResponseError } from "./unifi-device";

export interface UnifiStaClient {
  mac: string;
  isWired: boolean;
  /** Switch UniFi a cui è collegato (cablato); null se dietro un apparato non UniFi. */
  swMac: string | null;
  /** Indice della porta su quello switch (`port_idx` di stat/device). */
  swPort: number | null;
  /** Access point UniFi (wireless). */
  apMac: string | null;
  /** Ultimo visto, secondi epoch del controller. */
  lastSeen: number | null;
  /** 08/11 (Riccardo: «acquisire dai controller anche i client collegati e dove sono collegati»): IP, nome, gateway e rete del client. Facoltativi: le prove vecchie non li hanno. */
  ip?: string | null;
  nome?: string | null;
  gwMac?: string | null;
  rete?: string | null;
}

function macOf(v: unknown): string | null {
  return normalizeMacForStorage(typeof v === "string" ? v : null);
}

/** Una voce di `data[]`; null se non è un oggetto o non ha un MAC valido. */
function parseStaRecord(v: unknown): UnifiStaClient | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const mac = macOf(r.mac);
  if (!mac) return null;
  const intero = (x: unknown) => (typeof x === "number" && Number.isInteger(x) ? x : null);
  const testo = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : null);
  // Senza `sw_mac` il controller recente dice comunque l'ultimo apparato UniFi a monte (`last_uplink_mac`, `last_uplink_remote_port`).
  const swMac = macOf(r.sw_mac) ?? (r.is_wired === true ? macOf(r.last_uplink_mac) : null);
  const swPort = intero(r.sw_port) ?? (r.is_wired === true && !macOf(r.sw_mac) ? intero(r.last_uplink_remote_port) : null);
  const ip = testo(r.ip);
  return {
    mac,
    isWired: r.is_wired === true,
    swMac,
    swPort,
    ip: ip && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) ? ip : null,
    nome: testo(r.hostname) ?? testo(r.name),
    gwMac: macOf(r.gw_mac),
    rete: testo(r.network) ?? (intero(r.vlan) !== null ? `VLAN ${intero(r.vlan)}` : null),
    apMac: macOf(r.ap_mac),
    lastSeen: typeof r.last_seen === "number" && Number.isFinite(r.last_seen) ? r.last_seen : null,
  };
}

/**
 * Lancia `UnifiResponseError` se `meta.rc` non è "ok" o se manca `data[]`:
 * una risposta d'errore non deve diventare «zero client» (il client del
 * controller la classifica come la lettura degli apparati).
 */
export function parseStatStaResponse(json: unknown): UnifiStaClient[] {
  const o = (json !== null && typeof json === "object" ? json : {}) as { meta?: { rc?: unknown; msg?: unknown }; data?: unknown };
  if (o.meta?.rc !== "ok") {
    const msg = typeof o.meta?.msg === "string" && o.meta.msg.trim() ? o.meta.msg.trim() : null;
    throw new UnifiResponseError(`Risposta del controller non valida (stat/sta): ${msg ?? "senza esito"}`, msg);
  }
  if (!Array.isArray(o.data)) throw new UnifiResponseError("Risposta del controller non valida (stat/sta): manca data[]");
  const out: UnifiStaClient[] = [];
  for (const v of o.data) {
    const c = parseStaRecord(v);
    if (c) out.push(c);
  }
  return out;
}

/**
 * Cablato → porta dello switch per indice (nome da `switch_ports`, altrimenti
 * «Port N» come lo scrive la lettura degli apparati); wireless → porta "wifi"
 * dell'AP. Switch o AP che il tenant non conosce → non abbinato.
 * `portNames`: chiave `${deviceId}|${portIndex}` → nome porta.
 */
export function mapClientsToPorts(
  clients: UnifiStaClient[],
  devices: Array<{ id: number; controller_mac: string | null }>,
  portNames: Map<string, string>,
): { byDevice: Map<number, Array<{ mac: string; port_name: string }>>; unmatched: number; motivi: Record<string, number> } {
  const byMac = new Map<string, number>();
  for (const d of devices) {
    const m = normalizeMacForStorage(d.controller_mac);
    if (m) byMac.set(m, d.id);
  }
  const byDevice = new Map<number, Array<{ mac: string; port_name: string }>>();
  const push = (id: number, mac: string, port_name: string) => {
    const list = byDevice.get(id);
    if (list) list.push({ mac, port_name });
    else byDevice.set(id, [{ mac, port_name }]);
  };
  let unmatched = 0;
  // Perché un client non trova posto: il resoconto lo dice (08/11, sull'hub 32 su 203 senza motivo scritto).
  const motivi: Record<string, number> = {};
  const manca = (m: string) => { unmatched++; motivi[m] = (motivi[m] ?? 0) + 1; };
  for (const c of clients) {
    const sw = c.isWired && c.swMac !== null && c.swPort !== null ? byMac.get(c.swMac) : undefined;
    const ap = !c.isWired && c.apMac !== null ? byMac.get(c.apMac) : undefined;
    if (sw !== undefined) push(sw, c.mac, portNames.get(`${sw}|${c.swPort}`) ?? `Port ${c.swPort}`);
    else if (ap !== undefined) push(ap, c.mac, "wifi");
    else if (c.isWired && c.swMac === null) manca("cablato senza apparato UniFi a monte");
    else if (c.isWired && c.swPort === null) manca("cablato senza porta");
    else if (!c.isWired && c.apMac === null) manca("wifi senza access point");
    // Il MAC dell'apparato che manca, così il resoconto dice chi è (sull'hub 29 client su 193 l'08/11).
    else manca(`apparato UniFi non in inventario (${c.isWired ? c.swMac : c.apMac})`);
  }
  return { byDevice, unmatched, motivi };
}

/**
 * I client del controller visti dal loro gateway, come una tabella ARP (08/11): MAC, IP e rete. La UDM dell'hub aveva 0 ARP
 * perché nessuno la interroga direttamente; il controller sa IP e gateway di ogni client già nella lettura di ogni ora.
 * Solo client con IP e con un gateway che il tenant conosce.
 */
export function vistiDalGateway(clients: UnifiStaClient[], devices: Array<{ id: number; controller_mac: string | null }>): Array<{ device_id: number; mac: string; ip: string; interfaccia: string | null }> {
  const byMac = new Map<string, number>();
  for (const d of devices) {
    const m = normalizeMacForStorage(d.controller_mac);
    if (m) byMac.set(m, d.id);
  }
  return clients.flatMap((c) => {
    const gw = c.gwMac ? byMac.get(c.gwMac) : undefined;
    return gw !== undefined && c.ip ? [{ device_id: gw, mac: c.mac, ip: c.ip, interfaccia: c.rete ?? null }] : [];
  });
}
