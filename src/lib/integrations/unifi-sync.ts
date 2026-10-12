/**
 * Sync controller UniFi → DB del tenant (Task 4 dell'integrazione UniFi, tappa
 * 2 del piano di miglioramento). Legge `stat/device` dal controller (in sola
 * lettura) e arricchisce il tenant: apparati in `network_devices`, porte in
 * `switch_ports`, vicini LLDP in `device_neighbors`. Sul controller non scrive
 * mai niente.
 *
 * Da chiamare dentro `withTenant(code, …)` (job) o `withTenantFromSession`
 * (rotta manuale). Non lancia: ogni guasto finisce in `errors[]`.
 *
 * Scelte (piano, «Correzioni prima di eseguire»):
 * - funzioni DB solo da `@/lib/db-tenant`, import statico (correzione 3; le
 *   copie del facade `db.ts` divergono e il suo `getDb()` risolve il tenant con
 *   un `require`, la classe di guasto dell'incidente del 02/09);
 * - guardia «zero sospetto» (correzione 4): se il controller non riporta porte
 *   o vicini per un apparato che nel DB ne ha, non si cancella niente e lo si
 *   dice in `errors[]`;
 * - una sola lettura del controller per giro: `probe()` e `listDevices()` fanno
 *   la stessa sequenza login → stat/device → logout, chiamarle entrambe
 *   vorrebbe dire due sessioni e due letture complete. Un errore di lettura
 *   arriva già classificato come nella sonda (`UnifiApiError`: motivo e testo).
 *
 * Abbinamento con ciò che il DB sa già (nessun doppione, nessuna sovrascrittura
 * a sentimento):
 * 1. per seriale (`network_devices.serial_number`, che la sync stessa scrive):
 *    così la seconda sync ritrova i suoi apparati anche se l'host della rete
 *    ha un MAC diverso da quello del controller;
 * 2. per MAC: i MAC noti di ogni network_device (host collegato o con lo stesso
 *    IP, identità fisica);
 * 3. per IP: solo se nessun MAC lo smentisce e l'apparato del DB è `ubiquiti`
 *    o `other`; altrimenti è un IP conteso e si salta, con l'errore.
 * Trovato per seriale o per MAC con un IP diverso, l'apparato si sposta
 * all'IP del controller (se nessun altro apparato lo occupa).
 * Di un apparato già censito si aggiornano i fatti (vendor, tipo, modello,
 * firmware, seriale) e non le scelte (nome, protocollo, credenziali, `enabled`).
 *
 * Gli apparati nuovi nascono con `enabled = 0` e `use_for_arp_poll = 0`: DA-IPAM
 * non li interroga direttamente (il poll ARP proverebbe SNMP «public» su ognuno,
 * con i suoi timeout), i dati arrivano dal controller. L'identità fisica si
 * collega solo se esiste già (seriale, poi MAC primario): niente record creati.
 */

import {
  createNetworkDevice,
  getCurrentTenantCode,
  getNetworkDeviceKnownMacs,
  getNetworkDevices,
  getPhysicalDeviceAnchors,
  getPortAndNeighborCountsByDevice,
  linkNetworkDeviceToPhysicalDevice,
  runInTenantTransaction,
  updateNetworkDevice,
  upsertNeighbors,
  upsertSwitchPorts,
} from "@/lib/db-tenant";
import { normalizeMacForStorage } from "@/lib/utils";
import type { NetworkDevice } from "@/types";
import { getIntegrationConfig, unifiCertPinStore } from "./config";
import { createUnifiClient, type UnifiClientOptions, type UnifiProbeResult } from "./unifi-api";
import type { UnifiDevice } from "./unifi-device";
import {
  buildUnifiMacIndex,
  mapUnifiDevice,
  mapUnifiLldp,
  mapUnifiPorts,
  type UnifiMacIndex,
  type UnifiMappedDevice,
  type UnifiNeighbor,
} from "./unifi-map";

/** Da dove arrivano gli apparati: il client del controller, o una fixture nelle prove. */
export interface UnifiDeviceSource {
  listDevices(): Promise<UnifiDevice[]>;
}

export interface UnifiSyncOptions {
  /** Di default il client del controller dalla configurazione `integration_unifi_*`. */
  source?: UnifiDeviceSource;
}

export interface UnifiSyncResult {
  tenantCode: string | null;
  /** Apparati restituiti dal controller. */
  total: number;
  added: number;
  updated: number;
  /** Apparati non scritti: tipo ignoto, senza IP, IP conteso, scrittura fallita. */
  skipped: number;
  /** Perché tipo ignoto e senza IP sono stati saltati: non sono errori. */
  skippedReasons: string[];
  portsUpserted: number;
  neighborsUpserted: number;
  errors: string[];
}

/** Seriale confrontabile: senza spazi ai lati, maiuscolo; null se vuoto. */
function serialKey(serial: string | null | undefined): string | null {
  const s = serial?.trim().toUpperCase();
  return s ? s : null;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ── Indici del DB, costruiti una volta per giro ─────────────────────────────

interface ExistingIndex {
  bySerial: Map<string, NetworkDevice>;
  byHost: Map<string, NetworkDevice>;
  byMac: Map<string, NetworkDevice[]>;
  macsById: Map<number, Set<string>>;
}

function buildExistingIndex(): ExistingIndex {
  const devices = [...getNetworkDevices()].sort((a, b) => a.id - b.id);
  const byId = new Map<number, NetworkDevice>();
  const bySerial = new Map<string, NetworkDevice>();
  const byHost = new Map<string, NetworkDevice>();
  for (const nd of devices) {
    byId.set(nd.id, nd);
    const serial = serialKey(nd.serial_number);
    if (serial && !bySerial.has(serial)) bySerial.set(serial, nd);
    if (!byHost.has(nd.host)) byHost.set(nd.host, nd);
  }
  const byMac = new Map<string, NetworkDevice[]>();
  const macsById = new Map<number, Set<string>>();
  for (const r of getNetworkDeviceKnownMacs()) {
    const mac = normalizeMacForStorage(r.mac);
    const nd = byId.get(r.device_id);
    if (!mac || !nd) continue;
    let set = macsById.get(nd.id);
    if (!set) {
      set = new Set();
      macsById.set(nd.id, set);
    }
    if (set.has(mac)) continue;
    set.add(mac);
    const list = byMac.get(mac) ?? [];
    list.push(nd);
    byMac.set(mac, list);
  }
  return { bySerial, byHost, byMac, macsById };
}

interface PhysicalIndex {
  bySerial: Map<string, number>;
  byMac: Map<string, number>;
}

function buildPhysicalIndex(): PhysicalIndex {
  const bySerial = new Map<string, number>();
  const byMac = new Map<string, number>();
  for (const p of getPhysicalDeviceAnchors()) {
    const serial = serialKey(p.serial_number);
    if (serial && !bySerial.has(serial)) bySerial.set(serial, p.id);
    const mac = normalizeMacForStorage(p.primary_mac);
    if (mac && !byMac.has(mac)) byMac.set(mac, p.id);
  }
  return { bySerial, byMac };
}

// ── Abbinamento ──────────────────────────────────────────────────────────────

type Match =
  | { kind: "new" }
  | { kind: "found"; device: NetworkDevice; by: "serial" | "mac" | "ip" }
  | { kind: "conflict"; message: string };

function findExisting(m: UnifiMappedDevice, ex: ExistingIndex): Match {
  const serial = serialKey(m.serial_number);
  const sameSerial = serial ? ex.bySerial.get(serial) : undefined;
  if (sameSerial) return { kind: "found", device: sameSerial, by: "serial" };
  if (m.mac) {
    const sameMac = ex.byMac.get(m.mac);
    if (sameMac && sameMac.length > 0) {
      return { kind: "found", device: sameMac.find((x) => x.host === m.host) ?? sameMac[0], by: "mac" };
    }
  }
  const sameIp = ex.byHost.get(m.host);
  if (!sameIp) return { kind: "new" };
  const known = ex.macsById.get(sameIp.id);
  if (m.mac && known && known.size > 0) {
    // Ha MAC noti e nessuno è il nostro: sopra l'avremmo trovato per MAC.
    return {
      kind: "conflict",
      message: `${m.name} (${m.host}): l'IP è di «${sameIp.name}» (${sameIp.vendor}), che nel DB ha un altro MAC: non lo sovrascrivo`,
    };
  }
  if (sameIp.vendor !== "ubiquiti" && sameIp.vendor !== "other") {
    return {
      kind: "conflict",
      message: `${m.name} (${m.host}): l'IP è di «${sameIp.name}» (${sameIp.vendor}) e nessun MAC conferma che sia lo stesso apparato: non lo sovrascrivo`,
    };
  }
  return { kind: "found", device: sameIp, by: "ip" };
}

// ── Scrittura di un apparato (dentro una transazione) ───────────────────────

interface WriteOutcome {
  device: NetworkDevice;
  created: boolean;
  movedFrom: string | null;
  ports: number;
  neighbors: number;
  warnings: string[];
}

type DevicePatch = NonNullable<Parameters<typeof updateNetworkDevice>[1]>;

/** I fatti che il controller conosce; i campi che non dice non si cancellano. */
function factsPatch(m: UnifiMappedDevice): DevicePatch {
  const patch: DevicePatch = {};
  if (m.model) patch.model = m.model;
  if (m.firmware) patch.firmware = m.firmware;
  if (m.serial_number) patch.serial_number = m.serial_number;
  return patch;
}

/** Vicini senza doppioni sulla chiave della tabella (la INSERT OR IGNORE li scarterebbe in silenzio). */
function uniqueNeighbors(list: UnifiNeighbor[]): UnifiNeighbor[] {
  const seen = new Set<string>();
  return list.filter((n) => {
    const key = `${n.localPort}\u0000${n.remoteDevice}\u0000${n.remotePort}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function writeDevice(
  d: UnifiDevice,
  m: UnifiMappedDevice,
  match: Extract<Match, { kind: "new" | "found" }>,
  ctx: {
    index: UnifiMacIndex;
    existing: ExistingIndex;
    physical: PhysicalIndex;
    counts: Map<number, { ports: number; neighbors: number }>;
  },
): WriteOutcome {
  const warnings: string[] = [];
  let nd: NetworkDevice | undefined;
  let created = false;
  let movedFrom: string | null = null;

  if (match.kind === "found") {
    const patch: DevicePatch = { vendor: "ubiquiti", device_type: m.device_type, ...factsPatch(m) };
    if (match.by !== "ip" && match.device.host !== m.host) {
      const occupant = ctx.existing.byHost.get(m.host);
      if (occupant && occupant.id !== match.device.id) {
        warnings.push(
          `${m.name}: il controller lo vede a ${m.host}, ma quell'IP è già di «${occupant.name}»: resta a ${match.device.host}`,
        );
      } else {
        patch.host = m.host;
        movedFrom = match.device.host;
      }
    }
    nd = updateNetworkDevice(match.device.id, patch);
  } else {
    const base = createNetworkDevice({
      name: m.name,
      host: m.host,
      device_type: m.device_type,
      classification: m.device_type,
      vendor: "ubiquiti",
      vendor_subtype: null,
      protocol: "api",
      credential_id: null,
      snmp_credential_id: null,
      username: null,
      encrypted_password: null,
      community_string: null,
      api_token: null,
      api_url: null,
      port: 443,
      enabled: 0,
      use_for_arp_poll: 0,
      physical_device_id: null,
    });
    const facts = factsPatch(m);
    nd = Object.keys(facts).length > 0 ? updateNetworkDevice(base.id, facts) : base;
    created = true;
  }
  if (!nd) throw new Error("apparato sparito dal DB durante la scrittura");

  // Identità fisica: solo collegamento a un record che c'è già.
  if (nd.physical_device_id == null) {
    const serial = serialKey(m.serial_number);
    const pd = (serial ? ctx.physical.bySerial.get(serial) : undefined) ?? (m.mac ? ctx.physical.byMac.get(m.mac) : undefined);
    if (pd !== undefined) linkNetworkDeviceToPhysicalDevice(nd.id, pd);
  }

  const before = ctx.counts.get(nd.id) ?? { ports: 0, neighbors: 0 };

  const ports = mapUnifiPorts(d, ctx.index);
  let portsWritten = 0;
  if (ports.length > 0) {
    upsertSwitchPorts(nd.id, ports);
    portsWritten = ports.length;
  } else if (before.ports > 0) {
    warnings.push(`${m.name}: il controller non riporta porte, nel DB ce ne sono ${before.ports}: non le cancello`);
  }

  const neighbors = uniqueNeighbors(mapUnifiLldp(d, ctx.index));
  let neighborsWritten = 0;
  if (neighbors.length > 0) {
    upsertNeighbors(nd.id, neighbors);
    neighborsWritten = neighbors.length;
  } else if (before.neighbors > 0) {
    warnings.push(`${m.name}: il controller non riporta vicini LLDP, nel DB ce ne sono ${before.neighbors}: non li cancello`);
  }

  return { device: nd, created, movedFrom, ports: portsWritten, neighbors: neighborsWritten, warnings };
}

function writeDevices(devices: UnifiDevice[], result: UnifiSyncResult): void {
  const ctx = {
    index: buildUnifiMacIndex(devices),
    existing: buildExistingIndex(),
    physical: buildPhysicalIndex(),
    counts: getPortAndNeighborCountsByDevice(),
  };
  const claimed = new Set<number>();

  for (const d of devices) {
    const mapped = mapUnifiDevice(d);
    if (!mapped.ok) {
      result.skipped++;
      result.skippedReasons.push(mapped.reason);
      continue;
    }
    const m = mapped.device;
    const match = findExisting(m, ctx.existing);
    if (match.kind === "conflict") {
      result.skipped++;
      result.errors.push(match.message);
      continue;
    }
    if (match.kind === "found" && claimed.has(match.device.id)) {
      result.skipped++;
      result.errors.push(
        `${m.name} (${m.host}): «${match.device.name}» è già stato abbinato a un altro apparato del controller in questo giro: saltato`,
      );
      continue;
    }

    let out: WriteOutcome;
    try {
      out = runInTenantTransaction(() => writeDevice(d, m, match, ctx));
    } catch (e) {
      result.skipped++;
      result.errors.push(`${m.name} (${m.host}): scrittura annullata, nessuna modifica per questo apparato (${errorMessage(e)})`);
      continue;
    }

    claimed.add(out.device.id);
    if (out.created) {
      result.added++;
      ctx.existing.byHost.set(out.device.host, out.device);
    } else {
      result.updated++;
      if (out.movedFrom !== null) {
        if (ctx.existing.byHost.get(out.movedFrom)?.id === out.device.id) ctx.existing.byHost.delete(out.movedFrom);
        ctx.existing.byHost.set(out.device.host, out.device);
      }
    }
    result.portsUpserted += out.ports;
    result.neighborsUpserted += out.neighbors;
    result.errors.push(...out.warnings);
  }
}

// ── Ingresso ─────────────────────────────────────────────────────────────────

/**
 * Un giro di sync per il tenant del contesto. Non lancia: il risultato dice
 * cosa è stato scritto e cosa no.
 */
export async function syncUnifiForTenant(opts: UnifiSyncOptions = {}): Promise<UnifiSyncResult> {
  const tenantCode = getCurrentTenantCode();
  const result: UnifiSyncResult = {
    tenantCode,
    total: 0,
    added: 0,
    updated: 0,
    skipped: 0,
    skippedReasons: [],
    portsUpserted: 0,
    neighborsUpserted: 0,
    errors: [],
  };
  // Senza tenant non si legge nemmeno il controller: non ci sarebbe dove scrivere.
  if (!tenantCode) {
    result.errors.push("Sync UniFi senza contesto tenant: niente letto, niente scritto");
    return result;
  }

  let source: UnifiDeviceSource;
  try {
    const cfg = getIntegrationConfig("unifi");
    if (cfg.mode !== "external") {
      result.errors.push("Integrazione UniFi disattivata: nessuna sincronizzazione");
      return result;
    }
    source = opts.source ?? createUnifiClient(cfg, unifiCertPinStore);
  } catch (e) {
    result.errors.push(`Configurazione UniFi non leggibile: ${errorMessage(e)}`);
    return result;
  }

  let devices: UnifiDevice[];
  try {
    devices = await source.listDevices();
  } catch (e) {
    result.errors.push(`Controller UniFi: ${errorMessage(e)}`);
    return result;
  }

  // Il contesto deve essere ancora quello di partenza dopo l'attesa della rete.
  if (getCurrentTenantCode() !== tenantCode) {
    result.errors.push("Contesto tenant cambiato durante la lettura del controller: niente scritto");
    return result;
  }

  result.total = devices.length;
  if (devices.length === 0) {
    result.errors.push("Il controller non ha restituito nessun apparato (il site è giusto?): niente da aggiornare");
    return result;
  }

  try {
    writeDevices(devices, result);
  } catch (e) {
    result.errors.push(`Sync UniFi interrotta: ${errorMessage(e)}`);
  }
  return result;
}

/**
 * Perché un giro di sync è da considerare fallito; `null` se è andato.
 *
 * Fallito = niente letto (controller in errore, integrazione spenta, zero
 * apparati, nessun contesto tenant) oppure apparati letti ma nessuno scritto,
 * con errori. Gli avvisi su qualche apparato, con gli altri scritti, non fanno
 * fallire il giro; nemmeno gli apparati scartati per tipo ignoto o senza IP
 * (`skippedReasons`, non errori). Lo usano la rotta manuale (`ok`) e il job
 * `unifi_sync`, che su un fallimento lancia: così lo scheduler lo conta fra i
 * job falliti invece di dirlo «completato» (niente ripieghi muti).
 *
 * Il testo finisce nel log dello scheduler: porta il motivo del giro, non gli
 * errori dei singoli apparati (nomi e IP), che restano nel resoconto.
 */
export function unifiSyncFailure(r: UnifiSyncResult): string | null {
  if (r.errors.length === 0) return null;
  if (r.total === 0) return r.errors.join("; ");
  if (r.added + r.updated > 0) return null;
  return `nessuno dei ${r.total} apparati del controller è stato scritto (${r.errors.length} errori: il dettaglio è nel resoconto della sync manuale)`;
}

/**
 * Test di connessione col controller della configurazione salvata
 * (`integration_unifi_*`): login, lettura di stat/device, logout. Non scrive
 * nel tenant; al primo collegamento riuscito fissa l'impronta del certificato
 * nella configurazione dell'hub (`unifiCertPinStore`). Gira anche a
 * integrazione spenta: l'amministratore prova il collegamento prima di
 * accenderla. Non lancia. `opts` serve alle prove (trasporto finto).
 */
export async function probeUnifiController(opts: UnifiClientOptions = {}): Promise<UnifiProbeResult> {
  let cfg: ReturnType<typeof getIntegrationConfig>;
  try {
    cfg = getIntegrationConfig("unifi");
  } catch (e) {
    return { ok: false, reason: "config", message: `Configurazione UniFi non leggibile: ${errorMessage(e)}` };
  }
  return createUnifiClient(cfg, unifiCertPinStore, opts).probe();
}
