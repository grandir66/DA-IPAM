/**
 * Apparato del controller UniFi in forma normalizzata, e lettura della
 * risposta di `GET /api/s/<site>/stat/device`.
 *
 * Modulo PURO (niente rete, niente DB): lo usano il client (`unifi-api.ts`)
 * e il mapping verso il DB (`unifi-map.ts`, Task 2), e si prova sulla
 * risposta vera anonimizzata in `__tests__/fixtures/unifi-stat-device.json`.
 *
 * I nomi dei campi restano QUELLI DEL CONTROLLER (snake_case): chi scrive il
 * mapping li ritrova uguali nella fixture e nella documentazione. La
 * normalizzazione garantisce solo i tipi (stringa/numero/booleano o null),
 * scarta il resto (statistiche, radio, ecc.) e non lancia mai su un
 * apparato malformato: lo salta o lascia null il campo.
 *
 * Fatti misurati sul controller di DTS (12/10, Network Application 10.6.1):
 * - `lldp_table` sta a livello di APPARATO, mai dentro `port_table`;
 * - una voce LLDP non porta il nome del vicino: `chassis_id` è di solito il
 *   suo MAC (`chassis_id_subtype: "mac"`, non sempre presente) e il nome si
 *   risolve cercandolo fra i MAC degli apparati della stessa risposta;
 * - `port_id` è testo libero ("Port 14", "local Port 7", oppure un MAC);
 * - `uplink` dice verso chi esce l'apparato (`uplink_mac`,
 *   `uplink_remote_port`, `uplink_device_name`, `uplink_source`);
 * - un apparato offline (`state: 0`) può non avere `up`/`speed` sulle porte.
 */

export interface UnifiLldpEntry {
  /** Identità del vicino: un MAC quando `chassis_id_subtype` è "mac". */
  chassis_id: string | null;
  chassis_id_subtype: string | null;
  /** Porta del vicino, testo libero ("Port 14", "local Port 7", un MAC). */
  port_id: string | null;
  /** Porta locale dell'apparato che vede il vicino. */
  local_port_idx: number | null;
  local_port_name: string | null;
  /** Indirizzi di gestione annunciati dal vicino (spesso assente). */
  mgmt_ips: string[];
  is_wired: boolean | null;
}

export interface UnifiPort {
  port_idx: number;
  name: string | null;
  /** null: il controller non lo sa (apparato offline). */
  up: boolean | null;
  enable: boolean | null;
  /** Mbit/s; 0 a link giù. */
  speed: number | null;
  full_duplex: boolean | null;
  media: string | null;
  is_uplink: boolean;
  op_mode: string | null;
  port_poe: boolean;
  poe_enable: boolean | null;
  poe_mode: string | null;
  /** Watt (il controller lo manda come stringa "3.21"). */
  poe_power: number | null;
  mac_table_count: number | null;
  stp_state: string | null;
  /** Indice della porta di aggregazione (LAG) di cui fa parte, se c'è. */
  aggregated_by: number | null;
}

export interface UnifiUplink {
  /** Porta locale da cui l'apparato esce. */
  port_idx: number | null;
  uplink_mac: string | null;
  uplink_remote_port: number | null;
  uplink_device_name: string | null;
  /** Come il controller lo ha saputo (es. "lldp_uplink"). */
  uplink_source: string | null;
  /** "wire" o "wireless". */
  type: string | null;
}

export interface UnifiDevice {
  mac: string | null;
  name: string | null;
  model: string | null;
  /** usw, uap, ugw, udm, uxg, ... (il mapping decide cosa farne). */
  type: string | null;
  ip: string | null;
  /** 1 = connesso; 0 = disconnesso; altri valori = in adozione/aggiornamento. */
  state: number | null;
  version: string | null;
  serial: string | null;
  adopted: boolean | null;
  port_table: UnifiPort[];
  lldp_table: UnifiLldpEntry[];
  uplink: UnifiUplink | null;
}

/** Errore di forma della risposta (non JSON atteso, `meta.rc` diverso da ok). */
export class UnifiResponseError extends Error {
  /** `meta.msg` del controller, se c'è (es. "api.err.NoSiteContext"). */
  readonly controllerMsg: string | null;
  constructor(message: string, controllerMsg: string | null = null) {
    super(message);
    this.name = "UnifiResponseError";
    this.controllerMsg = controllerMsg;
  }
}

type Rec = Record<string, unknown>;

function asRecord(v: unknown): Rec | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function int(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function parseLldpEntry(raw: unknown): UnifiLldpEntry | null {
  const r = asRecord(raw);
  if (!r) return null;
  const mgmt = Array.isArray(r.mgmt_ips) ? r.mgmt_ips.map(str).filter((s): s is string => s !== null) : [];
  return {
    chassis_id: str(r.chassis_id),
    chassis_id_subtype: str(r.chassis_id_subtype),
    port_id: str(r.port_id),
    local_port_idx: int(r.local_port_idx),
    local_port_name: str(r.local_port_name),
    mgmt_ips: mgmt,
    is_wired: bool(r.is_wired),
  };
}

function parsePort(raw: unknown): UnifiPort | null {
  const r = asRecord(raw);
  if (!r) return null;
  const idx = int(r.port_idx);
  if (idx === null) return null;
  return {
    port_idx: idx,
    name: str(r.name),
    up: bool(r.up),
    enable: bool(r.enable),
    speed: int(r.speed),
    full_duplex: bool(r.full_duplex),
    media: str(r.media),
    is_uplink: r.is_uplink === true,
    op_mode: str(r.op_mode),
    port_poe: r.port_poe === true,
    poe_enable: bool(r.poe_enable),
    poe_mode: str(r.poe_mode),
    poe_power: num(r.poe_power),
    mac_table_count: int(r.mac_table_count),
    stp_state: str(r.stp_state),
    // il controller manda `false` quando la porta non è in un LAG
    aggregated_by: int(r.aggregated_by),
  };
}

function parseUplink(raw: unknown): UnifiUplink | null {
  const r = asRecord(raw);
  if (!r) return null;
  return {
    port_idx: int(r.port_idx),
    uplink_mac: str(r.uplink_mac),
    uplink_remote_port: int(r.uplink_remote_port),
    uplink_device_name: str(r.uplink_device_name),
    uplink_source: str(r.uplink_source),
    type: str(r.type),
  };
}

function compact<T>(items: unknown, parse: (v: unknown) => T | null): T[] {
  if (!Array.isArray(items)) return [];
  const out: T[] = [];
  for (const it of items) {
    const p = parse(it);
    if (p !== null) out.push(p);
  }
  return out;
}

/** Normalizza UN apparato grezzo del controller. `null` se non è un oggetto. */
export function parseUnifiDevice(raw: unknown): UnifiDevice | null {
  const r = asRecord(raw);
  if (!r) return null;
  return {
    mac: str(r.mac),
    name: str(r.name),
    model: str(r.model),
    type: str(r.type),
    ip: str(r.ip),
    state: int(r.state),
    version: str(r.version),
    serial: str(r.serial),
    adopted: bool(r.adopted),
    port_table: compact(r.port_table, parsePort),
    lldp_table: compact(r.lldp_table, parseLldpEntry),
    uplink: parseUplink(r.uplink),
  };
}

/**
 * Legge la risposta (già decodificata da JSON) di `stat/device`:
 * `{ meta: { rc: "ok" }, data: [ ...apparati ] }`.
 *
 * Lancia `UnifiResponseError` se `meta.rc` non è "ok" o se `data` non è un
 * elenco: una risposta malformata non deve diventare "zero apparati", che a
 * valle sembrerebbe un controller vuoto. Gli elementi non-oggetto si saltano.
 */
export function parseStatDeviceResponse(json: unknown): UnifiDevice[] {
  const root = asRecord(json);
  if (!root) throw new UnifiResponseError("Risposta del controller senza struttura (atteso un oggetto JSON)");
  const meta = asRecord(root.meta);
  const rc = str(meta?.rc);
  if (rc !== "ok") {
    const msg = str(meta?.msg);
    throw new UnifiResponseError(
      `Il controller ha risposto con un errore${msg ? ` (${msg})` : ""}`,
      msg,
    );
  }
  if (!Array.isArray(root.data)) {
    throw new UnifiResponseError("Risposta del controller senza elenco degli apparati (campo data)");
  }
  return compact(root.data, parseUnifiDevice);
}
