/**
 * A-IPAM, Task 4: lettura dal DB del cliente dei SOLI dati che servono alla
 * fotografia dell'inventario per DA-Vul-can (spec §5.4). Lista bianca: ogni
 * colonna è nominata, mai `SELECT *`; una query per tabella, niente N+1.
 *
 * Non si leggono (e una prova statica lo controlla sul testo di questo file):
 * credenziali e loro legami, community SNMP, `snmp_data`, `detection_json`, note,
 * utenti AD, assegnatari, licenze, indirizzi delle sedi, dati grezzi degli apparati.
 *
 * L'apparato (`network_devices`) si unisce all'host per ip come in `db.ts`
 * (`nd.host = h.ip`), ma con una query sua: con due apparati sullo stesso ip vince
 * il primo per id, e l'host non si raddoppia. Gli apparati senza riga in `hosts`
 * non vanno nella versione 1: si contano.
 */
import type { Database } from "better-sqlite3";

export interface RigaRete {
  id: number;
  cidr: string;
  nome: string;
  vlan: number | null;
  /** Nome della sede (`locations.name`), mai l'indirizzo. */
  sede: string | null;
}

/** Solo queste colonne di `hosts`, più tipo, modello, firmware e seriale dell'apparato con lo stesso ip. */
export interface RigaHostInventario {
  id: number;
  network_id: number;
  ip: string;
  mac: string | null;
  vendor: string | null;
  hostname: string | null;
  dns_reverse: string | null;
  custom_name: string | null;
  classification: string | null;
  status: string | null;
  open_ports: string | null;
  os_info: string | null;
  os_family: string | null;
  model: string | null;
  serial_number: string | null;
  firmware: string | null;
  device_manufacturer: string | null;
  host_source: string | null;
  first_seen: string | null;
  last_seen: string | null;
  /** Ripiego di `first_seen` quando manca (9 host su 351 nel DB 70791 del 22/10): l'hub vuole una data. */
  created_at: string | null;
  nd_device_type: string | null;
  nd_model: string | null;
  nd_firmware: string | null;
  nd_serial_number: string | null;
}

export interface DatiInventario {
  reti: RigaRete[];
  host: RigaHostInventario[];
  /** Host con un computer AD abilitato collegato. */
  inAd: Set<number>;
  /** Host con un agente Wazuh: `os` = «os_name os_version» (null se Wazuh non lo sa). */
  wazuh: Map<number, { os: string | null }>;
  /** «operating_system operating_system_version» del computer AD abilitato. */
  osAd: Map<number, string>;
  /** Apparati senza riga in `hosts`: non inviati nella versione 1, solo contati. */
  apparatiSenzaHost: number;
}

const unisci = (a: string | null, b: string | null): string | null => {
  const s = [a, b].map((x) => (x ?? "").trim()).filter((x) => x !== "").join(" ");
  return s === "" ? null : s;
};

export function leggiDatiInventario(db: Database): DatiInventario {
  const reti = db
    .prepare(
      `SELECT n.id AS id, n.cidr AS cidr, n.name AS nome, n.vlan_id AS vlan, l.name AS sede
         FROM networks n LEFT JOIN locations l ON l.id = n.location_id
        ORDER BY n.cidr, n.id`,
    )
    .all() as RigaRete[];

  const righe = db
    .prepare(
      `SELECT h.id, h.network_id, h.ip, h.mac, h.vendor, h.hostname, h.dns_reverse, h.custom_name, h.classification,
              h.status, h.open_ports, h.os_info, h.os_family, h.model, h.serial_number, h.firmware, h.device_manufacturer,
              h.host_source, h.first_seen, h.last_seen, h.created_at
         FROM hosts h
        ORDER BY h.id`,
    )
    .all() as Omit<RigaHostInventario, "nd_device_type" | "nd_model" | "nd_firmware" | "nd_serial_number">[];

  const apparati = db
    .prepare("SELECT nd.host, nd.device_type, nd.model, nd.firmware, nd.serial_number FROM network_devices nd ORDER BY nd.id")
    .all() as { host: string; device_type: string | null; model: string | null; firmware: string | null; serial_number: string | null }[];
  const perIp = new Map<string, (typeof apparati)[number]>();
  for (const a of apparati) if (!perIp.has(a.host)) perIp.set(a.host, a);

  const ipHost = new Set(righe.map((h) => h.ip));
  let apparatiSenzaHost = 0;
  for (const ip of perIp.keys()) if (!ipHost.has(ip)) apparatiSenzaHost++;

  const host: RigaHostInventario[] = righe.map((h) => {
    const a = perIp.get(h.ip);
    return {
      ...h,
      nd_device_type: a?.device_type ?? null,
      nd_model: a?.model ?? null,
      nd_firmware: a?.firmware ?? null,
      nd_serial_number: a?.serial_number ?? null,
    };
  });

  const inAd = new Set<number>();
  const osAd = new Map<number, string>();
  const computer = db
    .prepare(
      `SELECT ac.host_id, ac.operating_system, ac.operating_system_version
         FROM ad_computers ac
        WHERE ac.enabled = 1 AND ac.host_id IS NOT NULL
        ORDER BY ac.host_id, ac.id`,
    )
    .all() as { host_id: number; operating_system: string | null; operating_system_version: string | null }[];
  for (const c of computer) {
    inAd.add(c.host_id);
    const os = unisci(c.operating_system, c.operating_system_version);
    if (os && !osAd.has(c.host_id)) osAd.set(c.host_id, os);
  }

  const wazuh = new Map<number, { os: string | null }>();
  const agenti = db
    .prepare(
      `SELECT wa.host_id, wa.os_name, wa.os_version
         FROM wazuh_agent wa
        WHERE wa.host_id IS NOT NULL
        ORDER BY wa.host_id, wa.agent_id`,
    )
    .all() as { host_id: number; os_name: string | null; os_version: string | null }[];
  for (const w of agenti) {
    const os = unisci(w.os_name, w.os_version);
    const gia = wazuh.get(w.host_id);
    if (!gia) wazuh.set(w.host_id, { os });
    else if (!gia.os && os) gia.os = os;
  }

  return { reti, host, inAd, wazuh, osAd, apparatiSenzaHost };
}
