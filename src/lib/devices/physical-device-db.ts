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
