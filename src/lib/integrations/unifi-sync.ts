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
 * - apparato non connesso al controller (`state` diverso da 1): il controller
 *   ne manda solo la parte statica (porte senza stato, velocità, MAC e PoE,
 *   niente LLDP). Porte e vicini già nel DB restano quelli dell'ultima sync,
 *   e l'apparato finisce in `offline[]` (non è un errore); se nel DB non c'è
 *   niente, si scrive quel che c'è;
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
 * Un apparato del DB con un ALTRO seriale è un altro apparato: né il MAC (che
 * l'host del vecchio IP può aver preso da chi è arrivato dopo) né l'IP lo
 * fanno diventare questo. Per questo il giro ha due passate: prima gli
 * apparati che si ritrovano per seriale (che così lasciano libero l'IP
 * vecchio), poi gli altri; l'esito non dipende dall'ordine del controller.
 * Trovato per seriale o per MAC con un IP diverso, l'apparato si sposta
 * all'IP del controller (se nessun altro apparato lo occupa), e con lui
 * `host_id`: restando sull'host del vecchio IP gli attribuirebbe il MAC di chi
 * ci arriva dopo.
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
  getHostByIp,
  getNetworkDeviceKnownMacs,
  getNetworkDevices,
  getPhysicalDeviceAnchors,
  getPortAndNeighborCountsByDevice,
  linkNetworkDeviceToPhysicalDevice,
  runInTenantTransaction,
  schemaCaviPresente,
  scriviFattiTopologia,
  setNetworkDeviceControllerFacts,
  setUplinkCavi,
  updateNetworkDevice,
  upsertNeighbors,
  upsertSwitchPorts,
} from "@/lib/db-tenant";
import { codiceErrore } from "@/lib/devices/mikrotik-porte";
import { letturaAccesa, oraUtc, scriviEsito } from "@/lib/topology/letture/interruttori";
import { normalizeMacForStorage } from "@/lib/utils";
import type { NetworkDevice } from "@/types";
import type { UnifiDevice } from "./unifi-device";
import {
  buildUnifiMacIndex,
  mapUnifiDevice,
  mapUnifiFattiCavi,
  mapUnifiLldp,
  mapUnifiLldpConIndici,
  mapUnifiPorts,
  mapUnifiUplink,
  type UnifiMacIndex,
  type UnifiMappedDevice,
  type UnifiNeighbor,
} from "./unifi-map";

/** Da dove arrivano gli apparati: il client del controller, o una fixture nelle prove. */
export interface UnifiDeviceSource {
  listDevices(): Promise<UnifiDevice[]>;
}

export interface UnifiSyncOptions {
  /**
   * Il client del controller da leggere (`src/lib/controllers/service.ts`, che
   * lo costruisce dalla riga di `network_controllers`), o una fixture nelle
   * prove. Senza sorgente non si legge niente: la configurazione unica
   * dell'hub (`integration_unifi_*`) non si usa più (ADR 0007).
   */
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
  /** Apparati di cui si è salvato l'uplink in questo giro. */
  uplinksSaved: number;
  errors: string[];
  /**
   * Apparati che il controller non vede connessi («nome (ip)»): i fatti si
   * aggiornano, porte e vicini già nel DB restano quelli dell'ultima sync.
   */
  offline: string[];
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
  // Seriale diverso = apparato diverso, con certezza (la sync scrive il seriale).
  const otherSerial = (nd: NetworkDevice): boolean => {
    const s = serialKey(nd.serial_number);
    return serial !== null && s !== null && s !== serial;
  };
  if (m.mac) {
    const sameMac = (ex.byMac.get(m.mac) ?? []).filter((x) => !otherSerial(x));
    if (sameMac.length > 0) {
      return { kind: "found", device: sameMac.find((x) => x.host === m.host) ?? sameMac[0], by: "mac" };
    }
  }
  const sameIp = ex.byHost.get(m.host);
  if (!sameIp) return { kind: "new" };
  if (otherSerial(sameIp)) {
    return {
      kind: "conflict",
      message: `${m.name} (${m.host}): l'IP è di «${sameIp.name}», che ha un altro seriale (${sameIp.serial_number}): è un altro apparato, non lo sovrascrivo`,
    };
  }
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
  uplink: boolean;
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
    /** T2: `topologia.lettura.controller` accesa e schema nuovo presente, letti una volta per giro. */
    cavi: boolean;
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
        // L'host del vecchio IP non è più il suo (createNetworkDevice fa la stessa ricerca).
        patch.host_id = getHostByIp(m.host)?.id ?? null;
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
  // Offline: il controller dà solo la parte statica, l'ultimo stato buono vale di più.
  const connected = d.state === 1;

  const ports = mapUnifiPorts(d, ctx.index);
  let portsWritten = 0;
  if (!connected && before.ports > 0) {
    // porte dell'ultima sync: l'apparato è in `offline[]`
  } else if (ports.length > 0) {
    upsertSwitchPorts(nd.id, ports);
    portsWritten = ports.length;
  } else if (before.ports > 0) {
    warnings.push(`${m.name}: il controller non riporta porte, nel DB ce ne sono ${before.ports}: non le cancello`);
  }

  const neighbors = uniqueNeighbors(ctx.cavi ? mapUnifiLldpConIndici(d, ctx.index) : mapUnifiLldp(d, ctx.index));
  let neighborsWritten = 0;
  if (!connected && before.neighbors > 0) {
    // vicini dell'ultima sync: l'apparato è in `offline[]`
  } else if (neighbors.length > 0) {
    upsertNeighbors(nd.id, neighbors, "unifi");
    neighborsWritten = neighbors.length;
  } else if (before.neighbors > 0) {
    warnings.push(`${m.name}: il controller non riporta vicini LLDP, nel DB ce ne sono ${before.neighbors}: non li cancello`);
  }

  // Uplink e MAC del controller (topologia fase 1). Offline: il controller
  // manda l'ultimo uplink noto, ma non è una lettura di adesso: si scrive solo il MAC.
  const facts = mapUnifiUplink(d);
  setNetworkDeviceControllerFacts(
    nd.id,
    connected ? facts : { ...facts, uplinkMac: null, uplinkRemotePort: null, uplinkType: null },
  );
  const uplink = connected && facts.uplinkMac !== null;

  // T2 (spec §13.5.3): i campi per la mappa per cavo, solo con la lettura accesa e solo per un apparato connesso (offline il
  // controller manda l'ultima lettura buona, che non è di adesso). Nessuna chiamata nuova: l'esito dice «letto dal controller».
  if (ctx.cavi && connected) warnings.push(...scriviCampiCavi(nd.id, d));

  return { device: nd, created, movedFrom, ports: portsWritten, neighbors: neighborsWritten, uplink, warnings };
}

/**
 * T2: fatti (fonte `controller`) e uplink per indice di un apparato, in una transazione annidata: tutto o niente, e un
 * guasto qui annulla solo loro, non la scrittura di oggi dell'apparato (spenta o accesa, porte e vicini sono gli stessi:
 * R7). L'esito per apparato porta il codice; l'avviso nel resoconto solo l'id e il codice, mai nomi, MAC o IP.
 */
function scriviCampiCavi(deviceId: number, d: UnifiDevice): string[] {
  const avvisi: string[] = [];
  let codice: string | null = null;
  try {
    runInTenantTransaction(() => {
      scriviFattiTopologia(deviceId, "controller", mapUnifiFattiCavi(d));
      setUplinkCavi(deviceId, d.uplink?.port_idx ?? null, d.uplink?.uplink_source ?? null);
    });
  } catch (e) {
    codice = codiceErrore(e);
    avvisi.push(`apparato #${deviceId}: campi per la mappa per cavo non scritti (${codice})`);
  }
  try {
    scriviEsito("controller", deviceId, { il: oraUtc(new Date()), comandi: 1, riusciti: codice === null ? 1 : 0, codice });
  } catch (e) {
    avvisi.push(`apparato #${deviceId}: esito della lettura per la mappa per cavo non scritto (${codiceErrore(e)})`);
  }
  return avvisi;
}

function writeDevices(devices: UnifiDevice[], result: UnifiSyncResult): void {
  // T2: l'interruttore e lo schema si leggono una volta per giro, lo stesso valore per tutti gli apparati. Accesa senza
  // lo schema nuovo non si scrive niente di nuovo, e il resoconto lo dice (spec §13.5.7, «Se la migrazione non riesce»).
  const accesa = letturaAccesa("controller");
  const cavi = accesa && schemaCaviPresente();
  if (accesa && !cavi) result.errors.push("Letture in più del controller non disponibili: lo schema di questo cliente non è aggiornato");
  const ctx = {
    index: buildUnifiMacIndex(devices),
    existing: buildExistingIndex(),
    physical: buildPhysicalIndex(),
    counts: getPortAndNeighborCountsByDevice(),
    cavi,
  };
  const claimed = new Set<number>();

  // Due passate: prima chi si ritrova per seriale, poi gli altri (vedi in testa).
  const mappedAll = devices.map((d) => ({ d, mapped: mapUnifiDevice(d) }));
  const knownSerial = (x: (typeof mappedAll)[number]): boolean => {
    if (!x.mapped.ok) return false;
    const s = serialKey(x.mapped.device.serial_number);
    return s !== null && ctx.existing.bySerial.has(s);
  };
  const ordered = [...mappedAll.filter(knownSerial), ...mappedAll.filter((x) => !knownSerial(x))];

  for (const { d, mapped } of ordered) {
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
    if (out.uplink) result.uplinksSaved++;
    result.errors.push(...out.warnings);
    if (d.state !== 1) result.offline.push(`${m.name} (${m.host})`);
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
    uplinksSaved: 0,
    errors: [],
    offline: [],
  };
  // Senza tenant non si legge nemmeno il controller: non ci sarebbe dove scrivere.
  if (!tenantCode) {
    result.errors.push("Sync UniFi senza contesto tenant: niente letto, niente scritto");
    return result;
  }

  const source = opts.source;
  if (!source) {
    result.errors.push("Nessun controller indicato: la lettura parte dalla pagina Controller di rete");
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
