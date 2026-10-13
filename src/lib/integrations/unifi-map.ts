/**
 * Mapping PURO controller UniFi → righe del DB tenant (Task 2 dell'integrazione
 * UniFi). Niente rete, niente DB: la sync (`unifi-sync.ts`, Task 4) prende
 * questi risultati e li scrive con `createNetworkDevice`/`updateNetworkDevice`,
 * `upsertSwitchPorts` e `upsertNeighbors` di `@/lib/db-tenant`.
 *
 * Forma d'ingresso: `UnifiDevice` di `unifi-device.ts`, cioè la risposta vera
 * di `stat/device`. Fatti misurati sul controller di DTS (12/10):
 * - la `lldp_table` sta a livello di APPARATO; la porta locale è
 *   `local_port_idx` / `local_port_name`;
 * - una voce LLDP non porta il nome del vicino: `chassis_id` è di solito il suo
 *   MAC e il nome si risolve fra gli apparati della STESSA risposta, con un
 *   indice per MAC costruito una volta (`buildUnifiMacIndex`), mai confronti N²;
 * - `chassis_id_subtype` non c'è sempre (sugli switch manca, sugli AP vale
 *   "mac"): senza sottotipo un `chassis_id` con la forma di un MAC è un MAC;
 * - `port_id` è testo libero: "Port 14", "local Port 7" (visto dall'AP), oppure
 *   il MAC del vicino quando il vicino non annuncia il nome della porta.
 *
 * I MAC escono nella forma del DB (`normalizeMacForStorage`, AA:BB:CC:DD:EE:FF),
 * la stessa di `hosts.mac` e dei vicini MNDP: il ricalcolo dell'attribuzione in
 * `upsertNeighbors` confronta `remote_mac = hosts.mac` senza normalizzare.
 */

import { normalizeMacForStorage, normalizePortNameForMatch } from "@/lib/utils";
import type { SwitchPort } from "@/types";
import type { UnifiDevice, UnifiLldpEntry, UnifiPort } from "./unifi-device";

export type UnifiNetworkDeviceType = "switch" | "access_point" | "router";

/** Tipi del controller che diventano `network_devices`; il resto si salta. */
const DEVICE_TYPES: Record<string, UnifiNetworkDeviceType> = {
  usw: "switch",
  uap: "access_point",
  ugw: "router",
  udm: "router",
  uxg: "router",
};

/**
 * Tipo del controller → `network_devices.device_type`. `null` per un tipo che
 * non sappiamo collocare: la sync lo salta, non lo forza dentro il CHECK.
 */
export function mapUnifiDeviceType(unifiType: string | null | undefined): UnifiNetworkDeviceType | null {
  if (!unifiType) return null;
  return DEVICE_TYPES[unifiType.trim().toLowerCase()] ?? null;
}

/** Campi di `network_devices` che il controller sa dire di un apparato. */
export interface UnifiMappedDevice {
  name: string;
  host: string;
  device_type: UnifiNetworkDeviceType;
  vendor: "ubiquiti";
  model: string | null;
  serial_number: string | null;
  firmware: string | null;
  /** MAC dell'apparato nella forma del DB; null se assente o malformato. */
  mac: string | null;
}

export type UnifiDeviceMapping =
  | { ok: true; device: UnifiMappedDevice }
  | { ok: false; reason: string };

/**
 * Apparato del controller → campi di `network_devices`. Scarta (con il motivo,
 * da mettere fra gli scartati della sync) un tipo ignoto, un apparato non
 * adottato (`adopted: false`: in attesa di adozione o gestito da un altro
 * controller, quindi fuori dall'inventario gestito; `adopted` assente non
 * scarta) e un apparato senza IP: `network_devices.host` è obbligatorio.
 */
export function mapUnifiDevice(d: UnifiDevice): UnifiDeviceMapping {
  const deviceType = mapUnifiDeviceType(d.type);
  const label = d.name ?? d.mac ?? d.ip ?? "apparato senza nome";
  if (!deviceType) {
    return { ok: false, reason: `${label}: tipo "${d.type ?? "assente"}" non gestito` };
  }
  if (d.adopted === false) {
    return { ok: false, reason: `${label}: non adottato dal controller (in attesa o gestito da un altro)` };
  }
  if (!d.ip) {
    return { ok: false, reason: `${label}: nessun indirizzo IP dal controller` };
  }
  const mac = normalizeMacForStorage(d.mac);
  return {
    ok: true,
    device: {
      name: d.name ?? d.model ?? mac ?? d.ip,
      host: d.ip,
      device_type: deviceType,
      vendor: "ubiquiti",
      model: d.model,
      serial_number: d.serial,
      firmware: d.version,
      mac,
    },
  };
}

/** Apparati della stessa risposta per MAC (forma del DB). */
export type UnifiMacIndex = ReadonlyMap<string, UnifiDevice>;

/** Indice per MAC degli apparati di UNA risposta; si costruisce una volta sola. */
export function buildUnifiMacIndex(devices: readonly UnifiDevice[]): UnifiMacIndex {
  const index = new Map<string, UnifiDevice>();
  for (const d of devices) {
    const mac = normalizeMacForStorage(d.mac);
    if (mac && !index.has(mac)) index.set(mac, d);
  }
  return index;
}

/** Vicino nella forma che consuma `upsertNeighbors` di `@/lib/db-tenant`. */
export interface UnifiNeighbor {
  localPort: string;
  remoteDevice: string;
  remotePort: string;
  protocol: "lldp";
  remoteIp?: string;
  remoteMac?: string;
  remotePlatform?: string;
}

/** Riga di `switch_ports` senza le colonne che mette il DB. */
export type UnifiSwitchPortRow = Omit<SwitchPort, "id" | "device_id" | "timestamp">;

const MAC_SHAPE = /^[0-9a-f]{2}([:-]?)[0-9a-f]{2}(\1[0-9a-f]{2}){4}$/i;
const IPV4_SHAPE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/**
 * Il primo IPv4 di `mgmt_ips`. Il campo manca nella fixture di DTS e la sua
 * forma non è misurata: un IPv6 (anche link-local) in testa non si prende,
 * perché topologia e attribuzione abbinano per IPv4 (`hosts.ip`).
 */
function firstIpv4(ips: readonly string[]): string | null {
  return ips.find((ip) => IPV4_SHAPE.test(ip)) ?? null;
}

/** Il MAC del vicino, se `chassis_id` lo è (sottotipo "mac", o assente con forma di MAC). */
function chassisMac(e: UnifiLldpEntry): string | null {
  if (!e.chassis_id) return null;
  const subtype = e.chassis_id_subtype?.toLowerCase() ?? null;
  if (subtype === "mac" || (subtype === null && MAC_SHAPE.test(e.chassis_id))) {
    return normalizeMacForStorage(e.chassis_id);
  }
  return null;
}

/** Nome della porta locale come la chiama l'apparato. */
function localPortName(e: UnifiLldpEntry): string {
  if (e.local_port_name) return e.local_port_name;
  return e.local_port_idx !== null ? `Port ${e.local_port_idx}` : "";
}

/**
 * `port_id` ripulito: niente prefisso "local " (lo mettono gli AP) e niente MAC
 * al posto del nome, che non è una porta. `""` se non resta un nome.
 */
function cleanPortId(portId: string | null): string {
  if (!portId) return "";
  const t = portId.replace(/^local\s+/i, "").trim();
  if (MAC_SHAPE.test(t)) return "";
  return t;
}

/**
 * Porta del vicino quando lui non la annuncia: la si legge dalla SUA voce LLDP
 * che punta a noi sulla nostra stessa porta (es. SW-1 vede l'AP-3 col MAC come
 * porta; l'AP-3 dice "SW-1, local Port 7" sulla sua `eth0`).
 */
function portSeenByRemote(remote: UnifiDevice, selfMac: string | null, selfPort: string): string {
  if (!selfMac || !selfPort) return "";
  const want = normalizePortNameForMatch(selfPort);
  for (const back of remote.lldp_table) {
    if (chassisMac(back) !== selfMac) continue;
    if (normalizePortNameForMatch(cleanPortId(back.port_id)) === want) return localPortName(back);
  }
  return "";
}

interface LldpLink {
  localPortIdx: number | null;
  neighbor: UnifiNeighbor;
}

function lldpLinks(d: UnifiDevice, index: UnifiMacIndex): LldpLink[] {
  const selfMac = normalizeMacForStorage(d.mac);
  const links: LldpLink[] = [];
  for (const e of d.lldp_table) {
    const mac = chassisMac(e);
    const remote = mac ? index.get(mac) : undefined;
    const mgmtIp = firstIpv4(e.mgmt_ips);
    // Identità del vicino: il nome dell'apparato se è nella risposta, altrimenti
    // il chassis_id (normalizzato se è un MAC). Senza nessuna delle due e senza
    // IP, la voce non dice chi c'è dall'altra parte: si scarta.
    const remoteDevice = remote?.name ?? mac ?? e.chassis_id ?? mgmtIp ?? null;
    if (!remoteDevice) continue;
    const localPort = localPortName(e);
    let remotePort = cleanPortId(e.port_id);
    if (!remotePort && remote) remotePort = portSeenByRemote(remote, selfMac, localPort);
    const neighbor: UnifiNeighbor = { localPort, remoteDevice, remotePort, protocol: "lldp" };
    if (mac) neighbor.remoteMac = mac;
    // Risolto nella risposta: il suo IP, quello che la sync scrive in
    // network_devices.host e che topologia e attribuzione sanno abbinare.
    const ip = remote?.ip ?? mgmtIp;
    if (ip) neighbor.remoteIp = ip;
    if (remote?.model) neighbor.remotePlatform = remote.model;
    links.push({ localPortIdx: e.local_port_idx, neighbor });
  }
  return links;
}

/**
 * Vicini LLDP dell'apparato, per `upsertNeighbors`. `index` è quello della
 * stessa risposta (`buildUnifiMacIndex`): serve a dare il nome al vicino.
 */
export function mapUnifiLldp(d: UnifiDevice, index: UnifiMacIndex): UnifiNeighbor[] {
  return lldpLinks(d, index).map((l) => l.neighbor);
}

/** Ciò che il controller sa di un apparato oltre a porte e vicini: il suo MAC e verso chi esce. */
export interface UnifiUplinkFacts {
  controllerMac: string | null;
  uplinkMac: string | null;
  uplinkRemotePort: number | null;
}

/**
 * MAC dell'apparato e uplink (`uplink.uplink_mac`, `uplink_remote_port`), finora
 * letti e buttati (ADR 0005, limite «uplink non usato»). Un uplink verso se
 * stessi o senza MAC non è un collegamento: null.
 */
export function mapUnifiUplink(d: UnifiDevice): UnifiUplinkFacts {
  const controllerMac = normalizeMacForStorage(d.mac);
  const uplinkMac = normalizeMacForStorage(d.uplink?.uplink_mac ?? null);
  if (!uplinkMac || uplinkMac === controllerMac) {
    return { controllerMac, uplinkMac: null, uplinkRemotePort: null };
  }
  return { controllerMac, uplinkMac, uplinkRemotePort: d.uplink?.uplink_remote_port ?? null };
}

function portStatus(p: UnifiPort): UnifiSwitchPortRow["status"] {
  if (p.enable === false) return "disabled";
  if (p.up === true) return "up";
  if (p.up === false) return "down";
  return null; // apparato offline: il controller non lo sa
}

/** Etichette dello stato PoE allineate a quelle SNMP (`snmp-port-schema.ts`). */
function poeStatus(p: UnifiPort): string | null {
  if (!p.port_poe) return null;
  if (p.poe_mode === "off") return "disabled";
  // Apparato offline: il controller manda `port_poe` ma non `poe_enable`, e
  // «in ricerca» su un apparato spento sarebbe un'invenzione.
  if (p.poe_enable === null) return null;
  return p.poe_enable ? "delivering" : "searching";
}

/**
 * Porte dell'apparato (da `port_table`) per `upsertSwitchPorts`, col vicino
 * LLDP della porta in `trunk_neighbor_name/port`. Le colonne che il controller
 * non dà (VLAN, MAC singolo, host collegato, peer principale) restano vuote.
 */
export function mapUnifiPorts(d: UnifiDevice, index: UnifiMacIndex): UnifiSwitchPortRow[] {
  const neighborByPort = new Map<number, UnifiNeighbor>();
  for (const l of lldpLinks(d, index)) {
    if (l.localPortIdx !== null && !neighborByPort.has(l.localPortIdx)) {
      neighborByPort.set(l.localPortIdx, l.neighbor);
    }
  }
  return d.port_table.map((p) => {
    const neighbor = neighborByPort.get(p.port_idx) ?? null;
    const macCount = p.mac_table_count ?? 0;
    // Trunk come lo intende il resto di DA-IPAM (più MAC sulla porta), più ciò
    // che il controller sa già: uplink, LAG, apparato LLDP dall'altra parte.
    // Senza, la pagina dell'apparato non mostrerebbe il vicino della porta.
    const isTrunk = macCount > 1 || p.is_uplink || p.op_mode === "aggregate" || p.aggregated_by !== null || neighbor !== null;
    return {
      port_index: p.port_idx,
      port_name: p.name ?? `Port ${p.port_idx}`,
      status: portStatus(p),
      speed: p.speed !== null && p.speed > 0 ? `${p.speed} Mbps` : null,
      duplex: p.up === true && p.full_duplex !== null ? (p.full_duplex ? "full" : "half") : null,
      vlan: null,
      poe_status: poeStatus(p),
      poe_power_mw: p.port_poe && p.poe_power !== null ? Math.round(p.poe_power * 1000) : null,
      mac_count: macCount,
      is_trunk: isTrunk ? 1 : 0,
      single_mac: null,
      single_mac_vendor: null,
      single_mac_ip: null,
      single_mac_hostname: null,
      host_id: null,
      trunk_neighbor_name: neighbor?.remoteDevice ?? null,
      trunk_neighbor_port: neighbor?.remotePort || null,
      trunk_primary_device_id: null,
      trunk_primary_name: null,
      stp_state: p.stp_state,
      is_uplink: p.is_uplink ? 1 : 0,
    };
  });
}
