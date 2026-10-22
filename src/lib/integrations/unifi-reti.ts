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
}

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
    });
  }
  return out;
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
