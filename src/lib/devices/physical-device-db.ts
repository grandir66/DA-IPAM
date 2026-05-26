/**
 * Helper DB per le entità di aggregazione device:
 *   - `physical_devices` (chassis fisico)
 *   - `device_interfaces` (interfaccia)
 *   - `device_interface_addresses` (IP per interfaccia)
 *
 * Tutte le operazioni sono idempotenti (upsert su chiavi univoche).
 * NB: nessuna logica di matching qui — solo CRUD. La risoluzione identità
 *     vive in `identity-resolver.ts`.
 */

import { getDb } from "@/lib/db";
import type {
  PhysicalDevice,
  DeviceInterface,
  DeviceInterfaceAddress,
} from "@/types";

/** Pattern MAC virtuali noti: VRRP/HSRP (`00:00:5E:00:01:xx`), CARP, OLD-VRRP. */
const VIRTUAL_MAC_PATTERNS = [
  /^00:00:5e:00:01:/i, // VRRPv2/v3 IPv4
  /^00:00:5e:00:02:/i, // VRRPv3 IPv6
  /^00:05:73:a0:/i,    // HSRP IPv6
  /^00:00:0c:07:ac:/i, // HSRP IPv4
  /^00:00:0c:9f:f/i,   // HSRP v2
];

/** Normalizza un MAC a `aa:bb:cc:dd:ee:ff` lowercase. Tollera trattini, punti Cisco (`aabb.ccdd.eeff`), uppercase. */
export function normalizeMac(mac: string | null | undefined): string | null {
  if (!mac) return null;
  const cleaned = mac.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
  if (cleaned.length !== 12) return null;
  return cleaned.match(/.{2}/g)!.join(":");
}

export function isVirtualMac(mac: string | null | undefined): boolean {
  const n = normalizeMac(mac);
  if (!n) return false;
  if (VIRTUAL_MAC_PATTERNS.some((rx) => rx.test(n))) return true;
  // Bit locally-administered (secondo byte: bit 1 == 1) → spesso randomized/VM.
  // NB: non lo marchiamo "virtual" perché molte cloud usano LA per default su NIC reali.
  return false;
}

// ──────────────────────────────────────────────────────────────────
// physical_devices
// ──────────────────────────────────────────────────────────────────

export function getPhysicalDeviceById(id: number): PhysicalDevice | undefined {
  return getDb().prepare("SELECT * FROM physical_devices WHERE id = ?").get(id) as PhysicalDevice | undefined;
}

export function findPhysicalDeviceBySerial(serial: string): PhysicalDevice | undefined {
  return getDb().prepare("SELECT * FROM physical_devices WHERE serial_number = ?").get(serial) as PhysicalDevice | undefined;
}

export function findPhysicalDeviceByPrimaryMac(mac: string): PhysicalDevice | undefined {
  const norm = normalizeMac(mac);
  if (!norm) return undefined;
  return getDb().prepare("SELECT * FROM physical_devices WHERE primary_mac = ?").get(norm) as PhysicalDevice | undefined;
}

export function findPhysicalDeviceBySysname(sysname: string): PhysicalDevice | undefined {
  return getDb().prepare("SELECT * FROM physical_devices WHERE sysname = ?").get(sysname) as PhysicalDevice | undefined;
}

/** Cerca physical_devices che condividono uno qualsiasi dei MAC dati (escluso virtuali). */
export function findPhysicalDevicesByAnyMac(macs: string[]): PhysicalDevice[] {
  const norm = macs.map(normalizeMac).filter((m): m is string => m !== null && !isVirtualMac(m));
  if (norm.length === 0) return [];
  const placeholders = norm.map(() => "?").join(",");
  return getDb()
    .prepare(
      `SELECT DISTINCT p.* FROM physical_devices p
        JOIN device_interfaces di ON di.physical_device_id = p.id
        WHERE di.mac IN (${placeholders}) AND di.is_virtual_mac = 0`
    )
    .all(...norm) as PhysicalDevice[];
}

export interface CreatePhysicalDeviceInput {
  vendor?: string | null;
  model?: string | null;
  serial_number?: string | null;
  primary_mac?: string | null;
  sys_object_id?: string | null;
  sysname?: string | null;
  manufacturer?: string | null;
  identity_confidence: number;
  identity_anchor: string | null;
}

export function createPhysicalDevice(input: CreatePhysicalDeviceInput): PhysicalDevice {
  const res = getDb()
    .prepare(
      `INSERT INTO physical_devices
        (vendor, model, serial_number, primary_mac, sys_object_id, sysname, manufacturer, identity_confidence, identity_anchor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.vendor ?? null,
      input.model ?? null,
      input.serial_number ?? null,
      normalizeMac(input.primary_mac ?? null),
      input.sys_object_id ?? null,
      input.sysname ?? null,
      input.manufacturer ?? null,
      input.identity_confidence,
      input.identity_anchor
    );
  return getPhysicalDeviceById(Number(res.lastInsertRowid))!;
}

/** Aggiorna campi noti del physical_device (best-effort: non sovrascrive con NULL). */
export function updatePhysicalDevice(id: number, patch: Partial<CreatePhysicalDeviceInput> & { last_seen?: string }): void {
  const fields: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (k === "primary_mac" && typeof v === "string") {
      fields.push(`${k} = ?`);
      params.push(normalizeMac(v));
    } else {
      fields.push(`${k} = ?`);
      params.push(v);
    }
  }
  if (fields.length === 0) return;
  fields.push("last_seen = datetime('now')");
  params.push(id);
  getDb().prepare(`UPDATE physical_devices SET ${fields.join(", ")} WHERE id = ?`).run(...params);
}

export function listPhysicalDevices(limit = 500): PhysicalDevice[] {
  return getDb().prepare("SELECT * FROM physical_devices ORDER BY last_seen DESC LIMIT ?").all(limit) as PhysicalDevice[];
}

// ──────────────────────────────────────────────────────────────────
// device_interfaces
// ──────────────────────────────────────────────────────────────────

export interface UpsertInterfaceInput {
  ifname: string;
  ifindex?: number | null;
  mac?: string | null;
  status?: "up" | "down" | "unknown";
  speed_mbps?: number | null;
  type?: string | null;
  alias?: string | null;
}

export function upsertDeviceInterface(physicalDeviceId: number, input: UpsertInterfaceInput): DeviceInterface {
  const mac = normalizeMac(input.mac ?? null);
  const isVirtual = isVirtualMac(mac) ? 1 : 0;
  getDb()
    .prepare(
      `INSERT INTO device_interfaces
        (physical_device_id, ifname, ifindex, mac, status, speed_mbps, type, is_virtual_mac, alias)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(physical_device_id, ifname) DO UPDATE SET
         ifindex = COALESCE(excluded.ifindex, device_interfaces.ifindex),
         mac = COALESCE(excluded.mac, device_interfaces.mac),
         status = excluded.status,
         speed_mbps = COALESCE(excluded.speed_mbps, device_interfaces.speed_mbps),
         type = COALESCE(excluded.type, device_interfaces.type),
         is_virtual_mac = excluded.is_virtual_mac,
         alias = COALESCE(excluded.alias, device_interfaces.alias),
         updated_at = datetime('now')`
    )
    .run(
      physicalDeviceId,
      input.ifname,
      input.ifindex ?? null,
      mac,
      input.status ?? "unknown",
      input.speed_mbps ?? null,
      input.type ?? null,
      isVirtual,
      input.alias ?? null
    );
  return getDb()
    .prepare("SELECT * FROM device_interfaces WHERE physical_device_id = ? AND ifname = ?")
    .get(physicalDeviceId, input.ifname) as DeviceInterface;
}

export function listDeviceInterfaces(physicalDeviceId: number): DeviceInterface[] {
  return getDb()
    .prepare("SELECT * FROM device_interfaces WHERE physical_device_id = ? ORDER BY ifindex, ifname")
    .all(physicalDeviceId) as DeviceInterface[];
}

// ──────────────────────────────────────────────────────────────────
// device_interface_addresses
// ──────────────────────────────────────────────────────────────────

export interface UpsertInterfaceAddressInput {
  ip: string;
  prefix?: number | null;
  family?: 4 | 6;
  scope?: "global" | "link" | "host" | "unknown";
}

export function upsertInterfaceAddress(interfaceId: number, input: UpsertInterfaceAddressInput): DeviceInterfaceAddress {
  getDb()
    .prepare(
      `INSERT INTO device_interface_addresses (interface_id, ip, prefix, family, scope)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(interface_id, ip) DO UPDATE SET
         prefix = COALESCE(excluded.prefix, device_interface_addresses.prefix),
         family = excluded.family,
         scope = excluded.scope,
         updated_at = datetime('now')`
    )
    .run(interfaceId, input.ip, input.prefix ?? null, input.family ?? 4, input.scope ?? "global");
  return getDb()
    .prepare("SELECT * FROM device_interface_addresses WHERE interface_id = ? AND ip = ?")
    .get(interfaceId, input.ip) as DeviceInterfaceAddress;
}

export function listInterfaceAddresses(interfaceId: number): DeviceInterfaceAddress[] {
  return getDb()
    .prepare("SELECT * FROM device_interface_addresses WHERE interface_id = ? ORDER BY family, ip")
    .all(interfaceId) as DeviceInterfaceAddress[];
}

/** Tutti gli IP di un physical_device (join interfaces + addresses), escludendo virtual MAC. */
export function listPhysicalDeviceIps(physicalDeviceId: number): Array<{ ip: string; ifname: string; prefix: number | null; family: 4 | 6; scope: string }> {
  return getDb()
    .prepare(
      `SELECT a.ip, i.ifname, a.prefix, a.family, a.scope
         FROM device_interface_addresses a
         JOIN device_interfaces i ON i.id = a.interface_id
        WHERE i.physical_device_id = ? AND i.is_virtual_mac = 0
        ORDER BY a.family, a.ip`
    )
    .all(physicalDeviceId) as Array<{ ip: string; ifname: string; prefix: number | null; family: 4 | 6; scope: string }>;
}

/** Tutti i MAC fisici (non virtuali) di un physical_device. Anchor per matching identità. */
export function listPhysicalDeviceMacs(physicalDeviceId: number): string[] {
  const rows = getDb()
    .prepare(
      `SELECT mac FROM device_interfaces
        WHERE physical_device_id = ? AND mac IS NOT NULL AND is_virtual_mac = 0`
    )
    .all(physicalDeviceId) as Array<{ mac: string }>;
  return rows.map((r) => r.mac);
}

// ──────────────────────────────────────────────────────────────────
// Linking network_devices ↔ physical_devices ↔ hosts
// ──────────────────────────────────────────────────────────────────

export function setNetworkDevicePhysicalDevice(networkDeviceId: number, physicalDeviceId: number | null): void {
  getDb()
    .prepare("UPDATE network_devices SET physical_device_id = ?, updated_at = datetime('now') WHERE id = ?")
    .run(physicalDeviceId, networkDeviceId);
}

export function setHostPhysicalDevice(hostId: number, physicalDeviceId: number | null): void {
  getDb()
    .prepare("UPDATE hosts SET physical_device_id = ?, updated_at = datetime('now') WHERE id = ?")
    .run(physicalDeviceId, hostId);
}

export function listNetworkDevicesByPhysicalDevice(physicalDeviceId: number): Array<{ id: number; name: string; host: string }> {
  return getDb()
    .prepare("SELECT id, name, host FROM network_devices WHERE physical_device_id = ? ORDER BY id")
    .all(physicalDeviceId) as Array<{ id: number; name: string; host: string }>;
}

export function listHostsByPhysicalDevice(physicalDeviceId: number): Array<{ id: number; ip: string; network_id: number; host_source: string | null }> {
  return getDb()
    .prepare("SELECT id, ip, network_id, host_source FROM hosts WHERE physical_device_id = ? ORDER BY ip")
    .all(physicalDeviceId) as Array<{ id: number; ip: string; network_id: number; host_source: string | null }>;
}

// ──────────────────────────────────────────────────────────────────
// Manual linking (v0.2.594+)
// Quando l'identity-resolver automatico non riesce ad aggregare host che
// l'utente sa essere lo stesso device fisico (es. interfacce su VLAN diverse
// senza SNMP visibile, NIC senza MAC condiviso), permettiamo il link manuale.
// ──────────────────────────────────────────────────────────────────

export interface ManualLinkResult {
  physical_device_id: number;
  linked_host_ids: number[];
  /** True se ha creato un nuovo physical_devices, False se ha riusato uno esistente */
  created: boolean;
  /** Eventuali physical_device_id orfani (cluster vuoto dopo merge) — il chiamante può eliminarli */
  orphaned_physical_device_ids: number[];
}

/**
 * Collega N host allo stesso physical_device.
 *
 * Logica di merge:
 *   - Se `target_physical_device_id` esplicito → quello vince
 *   - Altrimenti se uno degli host ha già un physical_device → usa il primo con confidence più alto
 *   - Altrimenti crea un nuovo physical_devices dal primo host (manual anchor)
 *
 * Gli host che avevano un physical_device diverso vengono ri-puntati al target.
 * Se questo lascia cluster vuoti, ritorniamo gli ID nel campo orphaned_physical_device_ids
 * (il chiamante può scegliere se eliminarli — non lo facciamo qui per sicurezza).
 *
 * NB: usato anche dall'API POST /api/physical-devices/link.
 */
export function manualLinkHostsToPhysicalDevice(
  host_ids: number[],
  target_physical_device_id?: number | null,
): ManualLinkResult {
  if (host_ids.length === 0) {
    throw new Error("Almeno un host richiesto per il link");
  }

  const db = getDb();
  const placeholders = host_ids.map(() => "?").join(",");
  const hosts = db.prepare(
    `SELECT id, ip, hostname, vendor, device_manufacturer, mac, physical_device_id
       FROM hosts WHERE id IN (${placeholders})`
  ).all(...host_ids) as Array<{
    id: number;
    ip: string;
    hostname: string | null;
    vendor: string | null;
    device_manufacturer: string | null;
    mac: string | null;
    physical_device_id: number | null;
  }>;

  if (hosts.length === 0) {
    throw new Error("Nessun host trovato per gli ID forniti");
  }

  // Decide il target physical_device_id
  let targetId: number;
  let created = false;
  const existingDeviceIds = Array.from(new Set(hosts.map((h) => h.physical_device_id).filter((x): x is number => x !== null)));

  if (target_physical_device_id) {
    // Validation: deve esistere
    const exists = getPhysicalDeviceById(target_physical_device_id);
    if (!exists) throw new Error(`physical_device ${target_physical_device_id} non esiste`);
    targetId = target_physical_device_id;
  } else if (existingDeviceIds.length > 0) {
    // Usa il primo con confidence più alto (preferiamo aggregati già "solidi")
    const candidates = db.prepare(
      `SELECT id, identity_confidence FROM physical_devices WHERE id IN (${existingDeviceIds.map(() => "?").join(",")}) ORDER BY identity_confidence DESC, id ASC LIMIT 1`
    ).get(...existingDeviceIds) as { id: number; identity_confidence: number } | undefined;
    targetId = candidates?.id ?? existingDeviceIds[0];
  } else {
    // Crea un nuovo physical_devices a partire dal primo host
    const seed = hosts[0];
    const newDev = createPhysicalDevice({
      vendor: seed.vendor,
      manufacturer: seed.device_manufacturer,
      primary_mac: seed.mac,
      sysname: seed.hostname,
      identity_confidence: 100, // manuale = trust massimo
      identity_anchor: "manual_link",
    });
    targetId = newDev.id;
    created = true;
  }

  // Ri-punta tutti gli host al target
  const updateStmt = db.prepare("UPDATE hosts SET physical_device_id = ?, updated_at = datetime('now') WHERE id = ?");
  for (const h of hosts) {
    if (h.physical_device_id !== targetId) updateStmt.run(targetId, h.id);
  }

  // Calcola gli orphan (cluster vuoti dopo il merge)
  const orphaned: number[] = [];
  for (const prevId of existingDeviceIds) {
    if (prevId === targetId) continue;
    const remaining = db.prepare("SELECT COUNT(*) AS n FROM hosts WHERE physical_device_id = ?").get(prevId) as { n: number };
    const remainingDevices = db.prepare("SELECT COUNT(*) AS n FROM network_devices WHERE physical_device_id = ?").get(prevId) as { n: number };
    if (remaining.n === 0 && remainingDevices.n === 0) {
      orphaned.push(prevId);
    }
  }

  updatePhysicalDevice(targetId, { /* bump last_seen */ });

  return {
    physical_device_id: targetId,
    linked_host_ids: hosts.map((h) => h.id),
    created,
    orphaned_physical_device_ids: orphaned,
  };
}

/** Scollega un host dal suo physical_device. Se è l'ultimo membro, non elimina il cluster (il chiamante decide). */
export function unlinkHostFromPhysicalDevice(hostId: number): { previous_physical_device_id: number | null; orphaned: boolean } {
  const db = getDb();
  const row = db.prepare("SELECT physical_device_id FROM hosts WHERE id = ?").get(hostId) as { physical_device_id: number | null } | undefined;
  if (!row) throw new Error("Host non trovato");
  const prevId = row.physical_device_id;
  if (prevId === null) return { previous_physical_device_id: null, orphaned: false };

  db.prepare("UPDATE hosts SET physical_device_id = NULL, updated_at = datetime('now') WHERE id = ?").run(hostId);

  // Verifica se il cluster è rimasto vuoto
  const remaining = db.prepare("SELECT COUNT(*) AS n FROM hosts WHERE physical_device_id = ?").get(prevId) as { n: number };
  const remainingDevices = db.prepare("SELECT COUNT(*) AS n FROM network_devices WHERE physical_device_id = ?").get(prevId) as { n: number };
  const orphaned = remaining.n === 0 && remainingDevices.n === 0;

  return { previous_physical_device_id: prevId, orphaned };
}

/**
 * Trova host candidati per essere linkati allo stesso device fisico di `hostId`.
 * Ritorna fino a `limit` host ordinati per affinity score discendente.
 *
 * Affinity score:
 *   +50 stessa subnet (network_id)
 *   +30 inferred_vendor uguale
 *   +30 device_manufacturer match (lowercase contains)
 *   +25 inferred_os_family uguale
 *   +20 MAC OUI uguale (primi 3 ottetti, escludendo virtual)
 *   +30 hostname prefix match (almeno 4 char comuni con dash)
 *
 * Esclude:
 *   - L'host stesso
 *   - Gli host già nello stesso cluster (stesso physical_device_id)
 *   - Host offline da >30 giorni (probabilmente dismessi)
 */
export interface LinkCandidate {
  id: number;
  ip: string;
  hostname: string | null;
  vendor: string | null;
  device_manufacturer: string | null;
  inferred_os_family: string | null;
  network_id: number;
  network_name: string;
  physical_device_id: number | null;
  affinity_score: number;
  reasons: string[];
}

export function getLinkCandidatesForHost(hostId: number, limit = 20): LinkCandidate[] {
  const db = getDb();
  const target = db.prepare(`
    SELECT id, ip, hostname, mac, vendor, device_manufacturer, inferred_vendor,
           inferred_os_family, network_id, physical_device_id
      FROM hosts WHERE id = ?
  `).get(hostId) as {
    id: number;
    ip: string;
    hostname: string | null;
    mac: string | null;
    vendor: string | null;
    device_manufacturer: string | null;
    inferred_vendor: string | null;
    inferred_os_family: string | null;
    network_id: number;
    physical_device_id: number | null;
  } | undefined;

  if (!target) return [];

  // Carica tutti gli host candidati (escluso target + già nello stesso cluster)
  const candidates = db.prepare(`
    SELECT h.id, h.ip, h.hostname, h.mac, h.vendor, h.device_manufacturer,
           h.inferred_vendor, h.inferred_os_family, h.network_id, h.physical_device_id,
           n.name AS network_name
      FROM hosts h
      JOIN networks n ON n.id = h.network_id
     WHERE h.id != ?
       AND (h.physical_device_id IS NULL OR h.physical_device_id != COALESCE(?, -1))
       AND (h.last_seen IS NULL OR datetime(h.last_seen) > datetime('now', '-30 days'))
  `).all(hostId, target.physical_device_id) as Array<{
    id: number;
    ip: string;
    hostname: string | null;
    mac: string | null;
    vendor: string | null;
    device_manufacturer: string | null;
    inferred_vendor: string | null;
    inferred_os_family: string | null;
    network_id: number;
    network_name: string;
    physical_device_id: number | null;
  }>;

  // Calcola affinity
  const targetOui = ouiPrefix(target.mac);
  const targetHostnamePrefix = hostnamePrefix(target.hostname);

  const scored: LinkCandidate[] = candidates.map((c) => {
    const reasons: string[] = [];
    let score = 0;

    if (c.network_id === target.network_id) { score += 50; reasons.push("stessa rete"); }
    if (target.inferred_vendor && c.inferred_vendor && target.inferred_vendor === c.inferred_vendor) {
      score += 30; reasons.push(`vendor=${target.inferred_vendor}`);
    }
    if (target.device_manufacturer && c.device_manufacturer
        && target.device_manufacturer.toLowerCase().includes(c.device_manufacturer.toLowerCase().slice(0, 8))) {
      score += 30; reasons.push(`stesso manufacturer (${c.device_manufacturer})`);
    }
    if (target.inferred_os_family && c.inferred_os_family && target.inferred_os_family === c.inferred_os_family) {
      score += 25; reasons.push(`OS ${target.inferred_os_family}`);
    }
    if (targetOui && ouiPrefix(c.mac) === targetOui) {
      score += 20; reasons.push("OUI MAC condiviso");
    }
    const cPrefix = hostnamePrefix(c.hostname);
    if (targetHostnamePrefix && cPrefix && targetHostnamePrefix === cPrefix) {
      score += 30; reasons.push(`hostname prefix "${targetHostnamePrefix}"`);
    }

    return {
      id: c.id,
      ip: c.ip,
      hostname: c.hostname,
      vendor: c.vendor,
      device_manufacturer: c.device_manufacturer,
      inferred_os_family: c.inferred_os_family,
      network_id: c.network_id,
      network_name: c.network_name,
      physical_device_id: c.physical_device_id,
      affinity_score: score,
      reasons,
    };
  });

  // Filter zero-score ma keep almeno top-N per dare opzioni
  scored.sort((a, b) => b.affinity_score - a.affinity_score || a.ip.localeCompare(b.ip, undefined, { numeric: true }));
  return scored.slice(0, limit);
}

function ouiPrefix(mac: string | null | undefined): string | null {
  const n = normalizeMac(mac);
  if (!n) return null;
  if (isVirtualMac(n)) return null;
  return n.slice(0, 8); // "aa:bb:cc"
}

function hostnamePrefix(hostname: string | null): string | null {
  if (!hostname) return null;
  // "SRV-DB-01" → "SRV-DB"; "MB-Air-di-Mauri" → "MB-Air"; "PC-GIULIA" → "PC"
  const parts = hostname.toUpperCase().split(/[-_.]/);
  if (parts.length < 2) return null;
  // Prendi i primi 2 segmenti se il primo è corto (≤4 char), altrimenti solo il primo
  if (parts[0].length <= 4 && parts[1]) return `${parts[0]}-${parts[1]}`;
  return parts[0];
}
