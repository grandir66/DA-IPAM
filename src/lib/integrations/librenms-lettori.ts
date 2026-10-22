/**
 * Lettori puri delle risposte dell'API v0 di LibreNMS (piano 2026-10-22 LibreNMS, task 3; spec §4.2 e §7): dal JSON grezzo
 * di `LibreNMSClient.getRisorsa` alle righe delle tabelle `librenms_*` (senza `letto_il`). Ogni lettore controlla la forma
 * (`status === "ok"`, la chiave attesa, un array di oggetti, i tipi dei campi chiave) e su qualunque deviazione risponde
 * «non so» con un codice (`forma`, `chiave_assente`, `campo_<nome>`), mai una lista a metà: LibreNMS gira con l'immagine
 * `latest` e la sua API può cambiare forma. Una lista vuota con `status: "ok"` è un fatto (fotografia vuota). Il codice
 * HTTP lo guarda chi chiama (`esitoHttp`). MAC normalizzati minuscoli con `:`.
 *
 * Forme vere in `__tests__/fixtures/librenms/` (anonimizzate, 22/10). Note dalla prova sull'hub:
 * - `/resources/vlans`: `vlan_id` è l'id della riga, il numero della VLAN è `vlan_vlan`;
 * - `/resources/fdb`: `vlan_id` è l'id della riga di `/resources/vlans` (0 = non nota), non il numero della VLAN;
 * - l'ARP risponde con righe solo da `/resources/ip/arp/all` (`…/0.0.0.0/0` è vuoto);
 * - la VLAN per porta non ha una rotta (`/resources/ports_vlans` 404): la parte non c'è (spec §4.7).
 */

export type Esito<T> = { esito: "letto"; righe: T[] } | { esito: "non_so"; codice: string };

export interface RigaApparato {
  librenms_device_id: number; ip: string | null; hostname: string | null; sysname: string | null; os: string | null;
  hardware: string | null; version: string | null; serial: string | null; status: number | null;
  last_polled: string | null; last_discovered: string | null;
}
export interface RigaPorta {
  librenms_device_id: number; port_id: number; if_index: number | null; if_name: string | null; if_alias: string | null;
  if_type: string | null; oper_status: string | null; admin_status: string | null; speed: number | null; mac: string | null;
  vlan: number | null;
}
export interface RigaVicino {
  librenms_device_id: number; link_id: number; local_port_id: number | null; protocol: string | null;
  remote_hostname: string | null; remote_port: string | null; remote_platform: string | null;
  remote_device_id: number | null; remote_port_id: number | null;
}
export interface RigaVlan { librenms_device_id: number; vlan_id: number; nome: string | null }
export interface RigaMacPorta { librenms_device_id: number; port_id: number; mac: string; vlan_id: number | null; visto_il: string | null }
export interface RigaArp { librenms_device_id: number; port_id: number | null; mac: string; ip: string }
export interface RigaSensore {
  sensor_id: number; librenms_device_id: number; classe: string; descrizione: string | null; valore: number | null;
  limite_basso: number | null; limite_alto: number | null; aggiornato_il: string | null;
}
export interface RigaInventario {
  librenms_device_id: number; ent_index: number; classe: string | null; nome: string | null; descrizione: string | null;
  modello: string | null; seriale: string | null; firmware: string | null; contenuto_in: number | null;
}

/** Le colonne delle porte chieste a `/ports` (senza, LibreNMS dà solo `port_id` e `ifName`). */
export const COLONNE_PORTE = "port_id,device_id,ifIndex,ifName,ifAlias,ifType,ifOperStatus,ifAdminStatus,ifSpeed,ifPhysAddress,ifVlan";

/** I percorsi dell'API di ogni parte; l'inventario è per apparato. */
export const PERCORSI = {
  apparati: "/devices",
  porte: `/ports?columns=${COLONNE_PORTE}`,
  vicini: "/resources/links",
  vlan: "/resources/vlans",
  mac_porta: "/resources/fdb",
  arp: "/resources/ip/arp/all",
  sensori: "/resources/sensors",
  inventario: (librenmsDeviceId: number): string => `/inventory/${librenmsDeviceId}/all`,
} as const;

/** Un codice HTTP diverso da 200 è «non so» (`http_<n>`), anche un 404: non si cancella niente. */
export function esitoHttp(status: number): { esito: "non_so"; codice: string } | null {
  return status === 200 ? null : { esito: "non_so", codice: `http_${status}` };
}

class FormaNonCapita extends Error {
  constructor(readonly codice: string) {
    super(codice);
  }
}

type Riga = Record<string, unknown>;

/** La lista sotto `chiave`, se la risposta ha la forma dell'API v0; altrimenti lancia FormaNonCapita. */
function lista(corpo: unknown, chiave: string): Riga[] {
  if (corpo === null || typeof corpo !== "object" || Array.isArray(corpo)) throw new FormaNonCapita("forma");
  const o = corpo as Riga;
  if (o.status !== "ok") throw new FormaNonCapita("forma");
  if (!(chiave in o)) throw new FormaNonCapita("chiave_assente");
  const v = o[chiave];
  if (!Array.isArray(v)) throw new FormaNonCapita("forma");
  for (const r of v) if (r === null || typeof r !== "object" || Array.isArray(r)) throw new FormaNonCapita("forma");
  return v as Riga[];
}

function intero(r: Riga, campo: string): number {
  const v = r[campo];
  if (typeof v !== "number" || !Number.isInteger(v)) throw new FormaNonCapita(`campo_${campo}`);
  return v;
}
function interoONull(r: Riga, campo: string): number | null {
  const v = r[campo];
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isInteger(v)) throw new FormaNonCapita(`campo_${campo}`);
  return v;
}
function numeroONull(r: Riga, campo: string): number | null {
  const v = r[campo];
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) throw new FormaNonCapita(`campo_${campo}`);
  return v;
}
function testo(r: Riga, campo: string): string {
  const v = r[campo];
  if (typeof v !== "string") throw new FormaNonCapita(`campo_${campo}`);
  return v;
}
/** Testo o null; una stringa vuota è null (l'inventario dà "" per «non dichiarato»). Un tipo diverso è una forma nuova. */
function testoONull(r: Riga, campo: string): string | null {
  const v = r[campo];
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") throw new FormaNonCapita(`campo_${campo}`);
  return v === "" ? null : v;
}

/** «020000000005», «02:00:00:00:00:05», «02-00-…» → «02:00:00:00:00:05»; altro → null. */
export function normalizzaMac(v: string): string | null {
  const h = v.toLowerCase().replace(/[^0-9a-f]/g, "");
  if (h.length !== 12 || v.replace(/[\s:.-]/g, "").length !== 12) return null;
  return h.match(/../g)!.join(":");
}
function macChiave(r: Riga, campo: string): string {
  const m = normalizzaMac(testo(r, campo));
  if (!m) throw new FormaNonCapita(`campo_${campo}`);
  return m;
}

/** Un lettore: le righe, o «non so» col codice della prima deviazione. Le chiavi doppie restano la prima. */
function leggi<T>(fn: () => T[], chiave?: (r: T) => string): Esito<T> {
  try {
    const righe = fn();
    if (!chiave) return { esito: "letto", righe };
    const viste = new Set<string>();
    const uniche: T[] = [];
    for (const r of righe) {
      const k = chiave(r);
      if (viste.has(k)) continue;
      viste.add(k);
      uniche.push(r);
    }
    return { esito: "letto", righe: uniche };
  } catch (e) {
    if (e instanceof FormaNonCapita) return { esito: "non_so", codice: e.codice };
    throw e;
  }
}

export function leggiApparati(corpo: unknown): Esito<RigaApparato> {
  return leggi(() => lista(corpo, "devices").map((r) => ({
    librenms_device_id: intero(r, "device_id"),
    ip: testoONull(r, "ip"),
    hostname: testoONull(r, "hostname"),
    sysname: testoONull(r, "sysName"),
    os: testoONull(r, "os"),
    hardware: testoONull(r, "hardware"),
    version: testoONull(r, "version"),
    serial: testoONull(r, "serial"),
    status: interoONull(r, "status"),
    last_polled: testoONull(r, "last_polled"),
    last_discovered: testoONull(r, "last_discovered"),
  })), (r) => String(r.librenms_device_id));
}

export function leggiPorte(corpo: unknown): Esito<RigaPorta> {
  return leggi(() => lista(corpo, "ports").map((r) => {
    const mac = testoONull(r, "ifPhysAddress");
    // ifVlan arriva come testo («666»): numero se lo è, altrimenti null (non è un campo chiave).
    const vlanTesto = r.ifVlan;
    const vlan = typeof vlanTesto === "number" ? vlanTesto : typeof vlanTesto === "string" && /^\d+$/.test(vlanTesto) ? Number(vlanTesto) : null;
    return {
      librenms_device_id: intero(r, "device_id"),
      port_id: intero(r, "port_id"),
      if_index: interoONull(r, "ifIndex"),
      if_name: testoONull(r, "ifName"),
      if_alias: testoONull(r, "ifAlias"),
      if_type: testoONull(r, "ifType"),
      oper_status: testoONull(r, "ifOperStatus"),
      admin_status: testoONull(r, "ifAdminStatus"),
      speed: interoONull(r, "ifSpeed"),
      mac: mac ? normalizzaMac(mac) : null,
      vlan,
    };
  }), (r) => `${r.librenms_device_id}:${r.port_id}`);
}

export function leggiVicini(corpo: unknown): Esito<RigaVicino> {
  return leggi(() => lista(corpo, "links").map((r) => ({
    librenms_device_id: intero(r, "local_device_id"),
    link_id: intero(r, "id"),
    local_port_id: interoONull(r, "local_port_id"),
    protocol: testoONull(r, "protocol"),
    remote_hostname: testoONull(r, "remote_hostname"),
    remote_port: testoONull(r, "remote_port"),
    remote_platform: testoONull(r, "remote_platform"),
    remote_device_id: interoONull(r, "remote_device_id"),
    remote_port_id: interoONull(r, "remote_port_id"),
  })), (r) => `${r.librenms_device_id}:${r.link_id}`);
}

export function leggiVlan(corpo: unknown): Esito<RigaVlan> {
  return leggi(() => lista(corpo, "vlans").map((r) => ({
    librenms_device_id: intero(r, "device_id"),
    vlan_id: intero(r, "vlan_vlan"),
    nome: testoONull(r, "vlan_name"),
  })), (r) => `${r.librenms_device_id}:${r.vlan_id}`);
}

/**
 * Dalla risposta di `/resources/vlans`, l'id di riga → numero della VLAN: serve a `leggiMacPorta`, dove `vlan_id` è l'id di
 * riga. Forma non capita → mappa vuota (le VLAN dei MAC restano null, non si indovinano).
 */
export function vlanDaRiga(corpo: unknown): Map<number, number> {
  const m = new Map<number, number>();
  try {
    for (const r of lista(corpo, "vlans")) m.set(intero(r, "vlan_id"), intero(r, "vlan_vlan"));
  } catch (e) {
    if (e instanceof FormaNonCapita) return new Map();
    throw e;
  }
  return m;
}

export function leggiMacPorta(corpo: unknown, vlanPerRiga: ReadonlyMap<number, number> = new Map()): Esito<RigaMacPorta> {
  return leggi(() => lista(corpo, "ports_fdb").map((r) => {
    const riga = interoONull(r, "vlan_id");
    return {
      librenms_device_id: intero(r, "device_id"),
      port_id: intero(r, "port_id"),
      mac: macChiave(r, "mac_address"),
      vlan_id: riga === null || riga === 0 ? null : vlanPerRiga.get(riga) ?? null,
      visto_il: testoONull(r, "updated_at"),
    };
  }), (r) => `${r.librenms_device_id}:${r.port_id}:${r.mac}`);
}

export function leggiArp(corpo: unknown): Esito<RigaArp> {
  return leggi(() => lista(corpo, "arp").map((r) => ({
    librenms_device_id: intero(r, "device_id"),
    port_id: interoONull(r, "port_id"),
    mac: macChiave(r, "mac_address"),
    ip: testo(r, "ipv4_address"),
  })), (r) => `${r.librenms_device_id}:${r.mac}:${r.ip}`);
}

/** I sensori tolti da LibreNMS (`sensor_deleted = 1`) non si leggono. */
export function leggiSensori(corpo: unknown): Esito<RigaSensore> {
  return leggi(() => lista(corpo, "sensors").filter((r) => r.sensor_deleted !== 1).map((r) => ({
    sensor_id: intero(r, "sensor_id"),
    librenms_device_id: intero(r, "device_id"),
    classe: testo(r, "sensor_class"),
    descrizione: testoONull(r, "sensor_descr"),
    valore: numeroONull(r, "sensor_current"),
    limite_basso: numeroONull(r, "sensor_limit_low"),
    limite_alto: numeroONull(r, "sensor_limit"),
    aggiornato_il: testoONull(r, "lastupdate"),
  })), (r) => String(r.sensor_id));
}

/** L'inventario di un apparato: una riga con un `device_id` diverso da quello chiesto è una forma nuova. */
export function leggiInventario(librenmsDeviceId: number, corpo: unknown): Esito<RigaInventario> {
  return leggi(() => lista(corpo, "inventory").map((r) => {
    const dev = interoONull(r, "device_id");
    if (dev !== null && dev !== librenmsDeviceId) throw new FormaNonCapita("campo_device_id");
    return {
      librenms_device_id: librenmsDeviceId,
      ent_index: intero(r, "entPhysicalIndex"),
      classe: testoONull(r, "entPhysicalClass"),
      nome: testoONull(r, "entPhysicalName"),
      descrizione: testoONull(r, "entPhysicalDescr"),
      modello: testoONull(r, "entPhysicalModelName"),
      seriale: testoONull(r, "entPhysicalSerialNum"),
      firmware: testoONull(r, "entPhysicalFirmwareRev") ?? testoONull(r, "entPhysicalSoftwareRev"),
      contenuto_in: interoONull(r, "entPhysicalContainedIn"),
    };
  }), (r) => String(r.ent_index));
}
