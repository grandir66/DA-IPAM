/**
 * Mapping PURO controller UniFi → righe del DB tenant (Task 2 dell'integrazione
 * UniFi). Niente rete, niente DB: la sync (`unifi-sync.ts`, Task 4) prende
 * questi risultati e li scrive con `createNetworkDevice`/`updateNetworkDevice`,
 * `upsertSwitchPorts` e `upsertNeighbors` di `@/lib/db-tenant`.
 *
 * Forma d'ingresso: `UnifiDevice` di `unifi-device.ts`, cioè la risposta vera
 * di `stat/device`. Fatti misurati sul controller del cliente A (12/10):
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

import type { FattiLettura, FattoBridgeIn, FattoPortaIn, MacApparatoIn } from "@/lib/db-tenant";
import { normalizeMacForStorage, normalizePortNameForMatch } from "@/lib/utils";
import type { SwitchPort } from "@/types";
import type { UnifiDevice, UnifiLldpEntry, UnifiPort, UnifiUplinkType } from "./unifi-device";

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
  /** T2 (spec §13.5.3): indici delle due porte, solo con la lettura `controller` accesa (`mapUnifiLldpConIndici`). */
  localPortIndex?: number | null;
  remotePortIndex?: number | null;
}

/** Riga di `switch_ports` senza le colonne che mette il DB. */
export type UnifiSwitchPortRow = Omit<SwitchPort, "id" | "device_id" | "timestamp">;

const MAC_SHAPE = /^[0-9a-f]{2}([:-]?)[0-9a-f]{2}(\1[0-9a-f]{2}){4}$/i;
const IPV4_SHAPE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/**
 * Il primo IPv4 di `mgmt_ips`. Il campo manca nella fixture del cliente A e la sua
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
  remotePortIdx: number | null;
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
    // T2 (spec §13.5.3): «Port N» quando il vicino è un apparato della stessa risposta che ha la porta d'indice N.
    const n = /^Port (\d+)$/i.exec(remotePort);
    const remotePortIdx = remote && n && remote.port_table.some((p) => p.port_idx === Number(n[1])) ? Number(n[1]) : null;
    links.push({ localPortIdx: e.local_port_idx, neighbor, remotePortIdx });
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

/** I vicini con gli indici delle due porte (T2, spec §13.5.3): li usa la sincronizzazione solo con la lettura accesa. */
export function mapUnifiLldpConIndici(d: UnifiDevice, index: UnifiMacIndex): UnifiNeighbor[] {
  return lldpLinks(d, index).map((l) => ({
    ...l.neighbor,
    ...(l.localPortIdx !== null ? { localPortIndex: l.localPortIdx } : {}),
    ...(l.remotePortIdx !== null ? { remotePortIndex: l.remotePortIdx } : {}),
  }));
}

/** Lo stato dello spanning tree come lo scrive il controller, nelle parole dello standard; un valore che non si conosce: null. */
const STATI_STP: Readonly<Record<string, string>> = {
  forwarding: "forwarding", blocking: "discarding", discarding: "discarding", learning: "learning", listening: "learning",
  disabled: "disabled", broken: "discarding",
};

/**
 * I fatti di un apparato del controller (spec §13.5.3), fonte `controller`: ogni porta del `port_table` per indice
 * («i:N»), fisica; accesa o spenta; fascio (`lag_idx`, oppure il gruppo della porta che aggrega, `aggregated_by`); stato e
 * costo nello spanning tree (gli switch del controller parlano RSTP; `disabled` su una porta accesa = spanning tree
 * spento, e la porta inoltra: lo decide il modello per cavo). Il bridge: modo, priorità, radice vista (un MAC: il
 * controller non dà la sua priorità); la porta radice no, il controller non la dice. I MAC: quello dell'apparato e
 * `ethernet_table`.
 *
 * Contratto dei lettori (piano di T2, «Scelte» punto 8): ogni riga porta le stesse colonne, `null` dove il controller
 * non dà il valore per quell'apparato (il gateway e il Flex Mini non danno lo spanning tree); le colonne che il
 * controller non legge mai (`root_port`, `lag_partner`, ruolo, BPDU…) mancano da tutte le righe e restano com'erano.
 */
export function mapUnifiFattiCavi(d: UnifiDevice): FattiLettura {
  const aggregatori = new Set(d.port_table.flatMap((p) => (p.aggregated_by != null ? [p.aggregated_by] : [])));
  const gruppo = (p: UnifiPort): string | null =>
    p.lag_idx != null ? `lag:${p.lag_idx}` : p.aggregated_by != null ? `porta:${p.aggregated_by}` : aggregatori.has(p.port_idx) ? `porta:${p.port_idx}` : null;
  const porte: FattoPortaIn[] = d.port_table.map((p) => ({
    port_key: `i:${p.port_idx}`, port_name: p.name ?? `Port ${p.port_idx}`, port_index: p.port_idx, if_kind: "physical",
    running: p.up === null ? null : p.up ? 1 : 0, lag_group: gruppo(p),
    stp_state: p.stp_state ? (STATI_STP[p.stp_state.toLowerCase()] ?? null) : null, path_cost: p.stp_pathcost ?? null,
  }));
  const modo = (d.stp_version ?? "").toLowerCase();
  const bridge: FattoBridgeIn[] = d.stp_version || d.stp_priority != null || d.root_switch
    ? [{
        bridge_name: "", instance: 0, protocol: ["stp", "rstp", "mstp"].includes(modo) ? modo : null, priority: d.stp_priority ?? null,
        bridge_id: d.mac && d.stp_priority != null ? `${d.stp_priority}.${d.mac.toLowerCase()}` : null,
        root_id: d.root_switch ? d.root_switch.toLowerCase() : null,
      }]
    : [];
  const macs: MacApparatoIn[] = [d.mac, ...(d.ethernet_table ?? []).map((e) => e.mac)]
    .filter((m): m is string => !!m).map((mac) => ({ mac, port_key: null }));
  return { porte, bridge, macs };
}

/** Ciò che il controller sa di un apparato oltre a porte e vicini: il suo MAC e verso chi esce. */
export interface UnifiUplinkFacts {
  controllerMac: string | null;
  uplinkMac: string | null;
  uplinkRemotePort: number | null;
  /** Cavo o wireless (mesh): va con l'uplink, null se l'uplink non c'è (topologia fase 2b). */
  uplinkType: UnifiUplinkType | null;
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
    return { controllerMac, uplinkMac: null, uplinkRemotePort: null, uplinkType: null };
  }
  return {
    controllerMac,
    uplinkMac,
    uplinkRemotePort: d.uplink?.uplink_remote_port ?? null,
    uplinkType: d.uplink?.type ?? null,
  };
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

const nomePortaNorm = (n: string | null | undefined): string => (n ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Il controller non dà la VLAN della porta (la legge lo scan SNMP, `dot1qPvid`) né lo stato STP, ma
 * `upsertSwitchPorts` sostituisce tutte le porte dell'apparato: senza questo passaggio la sincronizzazione
 * notturna le cancellava. Si tengono i valori già nel DB per le colonne che il controller non fornisce;
 * un valore che il controller dà vince sempre.
 *
 * Abbinamento porta del controller ↔ riga esistente: prima per nome normalizzato («Port 1» = «port1»),
 * poi per `port_index` (SNMP ifIndex = `port_idx` del controller sui UniFi), ma solo se il nome della
 * riga esistente non è quello di un'altra porta del controller: così una VLAN non finisce mai su una porta sbagliata.
 */
export function conservaColonneNonDelController(
  rows: UnifiSwitchPortRow[],
  existing: ReadonlyArray<{ port_index: number; port_name: string; vlan: number | null; stp_state?: string | null }>,
): UnifiSwitchPortRow[] {
  const nomiController = new Map<string, number>();
  for (const r of rows) nomiController.set(nomePortaNorm(r.port_name), r.port_index);
  const perNome = new Map<string, (typeof existing)[number]>();
  const perIndice = new Map<number, (typeof existing)[number]>();
  for (const e of existing) {
    perNome.set(nomePortaNorm(e.port_name), e);
    perIndice.set(e.port_index, e);
  }
  return rows.map((r) => {
    let e = perNome.get(nomePortaNorm(r.port_name));
    if (!e) {
      const c = perIndice.get(r.port_index);
      if (c) {
        const altra = nomiController.get(nomePortaNorm(c.port_name));
        if (altra === undefined || altra === r.port_index) e = c;
      }
    }
    if (!e) return r;
    return { ...r, vlan: r.vlan ?? e.vlan ?? null, stp_state: r.stp_state ?? e.stp_state ?? null };
  });
}
