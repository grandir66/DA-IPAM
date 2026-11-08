/**
 * Reti del site UniFi (`GET /api/s/<site>/rest/networkconf`) e VLAN native delle porte degli switch del controller
 * (piano 2026-10-22 accorpamento, Task 13, ADR 0029). Modulo PURO: niente rete, niente DB.
 *
 * Il `port_table` di `stat/device` cita le reti per id (`native_networkconf_id`); il numero di VLAN sta solo
 * nell'elenco delle reti. Si legge solo ciò che serve: id, nome, scopo, VLAN.
 */
import { UnifiResponseError, type UnifiDevice } from "./unifi-device";

export interface UnifiRete {
  id: string;
  nome: string | null;
  /** "corporate", "guest", "vlan-only", "wan", "remote-user-vpn", ... (il controller lo manda così). */
  purpose: string | null;
  /** Numero di VLAN della rete; null = rete senza VLAN (vedi `vlanDellaRete`). */
  vlan: number | null;
  vlan_enabled: boolean | null;
  /** «192.168.1.1/24»: il gateway della rete e la sua maschera. */
  ip_subnet?: string | null;
}

/** Una rotta statica scritta nel controller (`rest/routing`). */
export interface UnifiRotta { destinazione: string; gateway: string | null; distanza: number | null; attiva: boolean }

type Rec = Record<string, unknown>;
const asRecord = (v: unknown): Rec | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** VLAN valida 1-4094: il controller la manda come numero o come stringa ("40"). */
function vlanId(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,4}$/.test(v.trim()) ? Number(v.trim()) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 4094 ? n : null;
}

/** Legge `data[]` di una risposta `rest/networkconf`; `meta.rc` diverso da ok → `UnifiResponseError`. Voci senza id scartate. */
export function parseNetworkconfResponse(json: unknown): UnifiRete[] {
  const root = asRecord(json);
  if (!root) throw new UnifiResponseError("Risposta del controller senza struttura (atteso un oggetto JSON)");
  const meta = asRecord(root.meta);
  if (str(meta?.rc) !== "ok") {
    const msg = str(meta?.msg);
    throw new UnifiResponseError(`Il controller ha risposto con un errore${msg ? ` (${msg})` : ""}`, msg);
  }
  if (!Array.isArray(root.data)) throw new UnifiResponseError("Risposta del controller senza elenco delle reti (campo data)");
  const out: UnifiRete[] = [];
  for (const x of root.data) {
    const r = asRecord(x);
    const id = str(r?._id);
    if (!r || !id) continue;
    out.push({
      id,
      nome: str(r.name),
      purpose: str(r.purpose),
      vlan: vlanId(r.vlan),
      vlan_enabled: typeof r.vlan_enabled === "boolean" ? r.vlan_enabled : null,
      ip_subnet: str(r.ip_subnet),
    });
  }
  return out;
}

/** `rest/routing`, forma misurata il 07/11 su una UCG: `static-route_network`, `static-route_nexthop`, `enabled`, distanza facoltativa. */
export function parseRoutingResponse(json: unknown): UnifiRotta[] {
  const root = asRecord(json);
  if (!root) throw new UnifiResponseError("Risposta del controller senza struttura (atteso un oggetto JSON)");
  const meta = asRecord(root.meta);
  if (str(meta?.rc) !== "ok") {
    const msg = str(meta?.msg);
    throw new UnifiResponseError(`Il controller ha risposto con un errore${msg ? ` (${msg})` : ""}`, msg);
  }
  if (!Array.isArray(root.data)) throw new UnifiResponseError("Risposta del controller senza elenco delle rotte (campo data)");
  return root.data.flatMap((x) => {
    const r = asRecord(x);
    const destinazione = str(r?.["static-route_network"]);
    if (!r || !destinazione) return [];
    const d = r["static-route_distance"];
    return [{ destinazione, gateway: str(r["static-route_nexthop"]), distanza: typeof d === "number" ? d : null, attiva: r.enabled !== false }];
  });
}

/**
 * Le rotte di un gateway del controller per `upsertRoutes`: le statiche scritte nel controller e le connesse, ricavate dalle reti.
 * `stat/routing` su una UCG risponde vuoto, quindi la tabella viva non si legge: è ciò che il controller dichiara.
 */
export function rotteDelGateway(reti: ReadonlyArray<UnifiRete>, statiche: ReadonlyArray<UnifiRotta>): Array<{ destination: string; gateway: string | null; interface_name: string | null; protocol: string; distance?: number; active: boolean }> {
  const connesse = reti.flatMap((r) => {
    const m = r.ip_subnet ? /^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/.exec(r.ip_subnet) : null;
    if (!m) return [];
    const bit = Number(m[5]);
    const ip = m.slice(1, 5).reduce((t, x) => t * 256 + Number(x), 0);
    const base = bit === 0 ? 0 : (ip - (ip % 2 ** (32 - bit)));
    const rete = [24, 16, 8, 0].map((s) => Math.floor(base / 2 ** s) % 256).join(".");
    return [{ destination: `${rete}/${bit}`, gateway: null, interface_name: r.nome, protocol: "connected", active: true }];
  });
  return [...connesse, ...statiche.map((s) => ({ destination: s.destinazione, gateway: s.gateway, interface_name: null, protocol: "static", ...(s.distanza != null ? { distance: s.distanza } : {}), active: s.attiva }))];
}

/** Scopi delle reti che una porta di switch può portare; WAN e VPN no. */
const RETI_DI_PORTA: ReadonlySet<string> = new Set(["corporate", "vlan-only", "guest"]);

/**
 * id della rete → numero di VLAN. Con `vlan_enabled` la sua VLAN; una LAN senza VLAN (`corporate`/`guest`) è la rete di
 * default, cioè la VLAN 1 (misurato sull'hub il 22/10: le porte con quella nativa hanno PVID 1 via SNMP). Una VLAN
 * dichiarata ma illeggibile, e ogni rete WAN o VPN, restano fuori: chi le cita non diventa un numero inventato.
 */
export function vlanDelleReti(reti: ReadonlyArray<UnifiRete>): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of reti) {
    if (!RETI_DI_PORTA.has(r.purpose ?? "")) continue;
    if (r.vlan_enabled === true) {
      if (r.vlan !== null) m.set(r.id, r.vlan);
    } else if (r.purpose !== "vlan-only") {
      m.set(r.id, 1);
    }
  }
  return m;
}

/**
 * La VLAN nativa di ogni porta dello switch che il controller la dà (`native_networkconf_id`) e che l'elenco delle reti
 * sa tradurre; `if_index` = `port_idx` (stessa numerazione delle porte SNMP degli Ubiquiti, misurata sull'hub). Porta
 * senza nativa o con una rete ignota: assente («non so»), mai un default.
 */
export function vlanNativePorte(d: UnifiDevice, vlanDi: ReadonlyMap<string, number>): Array<{ if_index: number; vlan_id: number }> {
  const out: Array<{ if_index: number; vlan_id: number }> = [];
  for (const p of d.port_table) {
    const v = p.native_networkconf_id ? vlanDi.get(p.native_networkconf_id) : undefined;
    if (v !== undefined) out.push({ if_index: p.port_idx, vlan_id: v });
  }
  return out;
}

/** Le VLAN di uno switch o del gateway lette dal controller, nella forma della fotografia SNMP (`scriviVlanSwitch`). */
export interface FotografiaVlanController {
  vlan: Array<{ vlan_id: number; nome: string | null }>;
  porte: Array<{ vlan_id: number; if_index: number; egress: boolean; untagged: boolean | null }>;
  pvid: Array<{ if_index: number; pvid: number }>;
}

/**
 * Riccardo, 08/11: gli switch che non rispondono né a SNMP né a SSH (79993-ipam-2) «sono dentro al controller, che ha le
 * informazioni». Dal `port_table`: la nativa (`native_networkconf_id`) untagged e PVID; le tagged secondo `tagged_vlan_mgmt`
 * («auto» tutte le reti, «custom» tutte tranne le escluse, «block_all» nessuna). Senza `tagged_vlan_mgmt` le tagged non si
 * sanno: solo la nativa, mai un «tutte» inventato. Eccezione dichiarata dal controller: `forward: "all"` senza nativa né profilo
 * di porta è il profilo di default, cioè la LAN di default (VLAN 1) nativa e tutte le altre tagged (su 79993-ipam-2 l'08/11 quasi
 * tutte le porte erano così e restavano «non letto»). Le VLAN dell'apparato sono quelle delle reti con un numero: sul gateway
 * sono le reti che instrada. null = niente da dire (nessuna rete tradotta o nessuna porta).
 */
export function fotografiaVlanController(d: UnifiDevice, reti: ReadonlyArray<UnifiRete>): FotografiaVlanController | null {
  const vlanDi = vlanDelleReti(reti);
  if (vlanDi.size === 0 || d.port_table.length === 0) return null;
  const nomi = new Map<number, string | null>();
  for (const r of reti) {
    const v = vlanDi.get(r.id);
    if (v !== undefined && !nomi.has(v)) nomi.set(v, r.nome);
  }
  const tutte = [...nomi.keys()].sort((a, b) => a - b);
  const out: FotografiaVlanController = { vlan: tutte.map((v) => ({ vlan_id: v, nome: nomi.get(v) ?? null })), porte: [], pvid: [] };
  const predefinita = nomi.has(1) ? 1 : undefined;
  for (const p of d.port_table) {
    const tutteDiDefault = !p.native_networkconf_id && !p.portconf_id && !p.tagged_vlan_mgmt && p.forward === "all";
    const nativa = p.native_networkconf_id ? vlanDi.get(p.native_networkconf_id) : tutteDiDefault ? predefinita : undefined;
    if (nativa !== undefined) {
      out.pvid.push({ if_index: p.port_idx, pvid: nativa });
      out.porte.push({ vlan_id: nativa, if_index: p.port_idx, egress: true, untagged: true });
    }
    const modo = p.tagged_vlan_mgmt ?? (tutteDiDefault ? "auto" : null);
    if (modo !== "auto" && modo !== "custom") continue;
    const escluse = new Set((modo === "custom" ? p.excluded_networkconf_ids ?? [] : []).map((id) => vlanDi.get(id)).filter((v): v is number => v !== undefined));
    for (const v of tutte) if (v !== nativa && !escluse.has(v)) out.porte.push({ vlan_id: v, if_index: p.port_idx, egress: true, untagged: false });
  }
  return out;
}
