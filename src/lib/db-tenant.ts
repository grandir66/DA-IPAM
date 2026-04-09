/**
 * Tenant (Spoke) DB module — multi-tenant system.
 * Each tenant gets its own SQLite database at data/tenants/<tenantCode>.db.
 *
 * Usage:
 *   import { withTenant, getNetworks } from "@/lib/db-tenant";
 *   const nets = withTenant("ACME01", () => getNetworks());
 *
 * Functions that reference hub settings (getSetting) import from db-hub.ts.
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "./db-tenant-schema";
import { macToHex, normalizeMac, normalizeMacForStorage } from "./utils";
import { sqlOrderByDhcpLeases, sqlOrderByNetworks, type SortDirection } from "./table-sort";
import { decrypt, safeDecrypt } from "./crypto";
import { randomUUID } from "crypto";
import { inferIpAssignment, resolveAdDhcpLeaseForHost, resolveDhcpLeaseForHost } from "./ip-assignment";
import { getActiveTenants } from "./db-hub";

import type {
  Network,
  NetworkWithStats,
  Host,
  KnownHostWithNetworkRow,
  HostDetail,
  ScanHistory,
  NetworkDevice,
  Credential,
  ArpEntry,
  MacPortEntry,
  ScheduledJob,
  StatusHistory,
  NetworkInput,
  HostInput,
  HostUpdate,
  ScheduledJobInput,
  CredentialInput,
} from "@/types";

// ═══════════════════════════════════════════════════════════════════════════
// TENANT CONTEXT (AsyncLocalStorage)
// ═══════════════════════════════════════════════════════════════════════════

const tenantContext = new AsyncLocalStorage<string>();

export function withTenant<T>(tenantCode: string, fn: () => T): T {
  return tenantContext.run(tenantCode, fn);
}

export function getCurrentTenantCode(): string | null {
  return tenantContext.getStore() ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════
// TENANT DB CONNECTION CACHE (LRU)
// ═══════════════════════════════════════════════════════════════════════════

const TENANTS_DIR = path.join(process.cwd(), "data", "tenants");
const MAX_OPEN_DBS = 20;
const tenantDbs = new Map<string, { db: Database.Database; lastUsed: number }>();

export function getTenantDb(tenantCode: string): Database.Database {
  const existing = tenantDbs.get(tenantCode);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.db;
  }

  // Evict LRU if over limit
  if (tenantDbs.size >= MAX_OPEN_DBS) {
    let oldest: string | null = null;
    let oldestTime = Infinity;
    for (const [code, entry] of tenantDbs) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldest = code;
      }
    }
    if (oldest) {
      closeTenantDb(oldest);
    }
  }

  // Ensure directory
  if (!fs.existsSync(TENANTS_DIR)) {
    fs.mkdirSync(TENANTS_DIR, { recursive: true });
  }

  const dbPath = path.join(TENANTS_DIR, `${tenantCode}.db`);
  const newDb = new Database(dbPath);

  // Apply PRAGMAs
  newDb.pragma("journal_mode = WAL");
  newDb.pragma("foreign_keys = ON");
  newDb.pragma("synchronous = NORMAL");
  newDb.pragma("cache_size = -64000");
  newDb.pragma("temp_store = MEMORY");
  newDb.pragma("mmap_size = 268435456");

  // Create schema if needed
  newDb.exec(TENANT_SCHEMA_SQL);
  newDb.exec(TENANT_INDEXES_SQL);

  tenantDbs.set(tenantCode, { db: newDb, lastUsed: Date.now() });
  return newDb;
}

export function closeTenantDb(tenantCode: string): void {
  const entry = tenantDbs.get(tenantCode);
  if (entry) {
    try {
      entry.db.close();
    } catch {
      /* ignore */
    }
    tenantDbs.delete(tenantCode);
  }
}

export function closeAllTenantDbs(): void {
  for (const [code] of tenantDbs) {
    closeTenantDb(code);
  }
}

export function createTenantDatabase(tenantCode: string): void {
  getTenantDb(tenantCode);
}

export function deleteTenantDatabase(tenantCode: string): void {
  closeTenantDb(tenantCode);
  const dbPath = path.join(TENANTS_DIR, `${tenantCode}.db`);
  try { fs.unlinkSync(dbPath); } catch { /* file may not exist */ }
  try { fs.unlinkSync(`${dbPath}-wal`); } catch { /* ignore */ }
  try { fs.unlinkSync(`${dbPath}-shm`); } catch { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL: db() reads from AsyncLocalStorage
// ═══════════════════════════════════════════════════════════════════════════

function db(): Database.Database {
  const code = tenantContext.getStore();
  if (!code) throw new Error("Nessun contesto tenant — usare withTenant() prima di accedere al DB tenant");
  return getTenantDb(code);
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES (local to this module)
// ═══════════════════════════════════════════════════════════════════════════

/** Convert IPv4 string to numeric value for sorting */
function ipToNum(ip: string): number {
  const p = ip.split(".").map(Number);
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

/** Confronto MAC normalizzato (ignora : - .) per match cross-vendor */
const MAC_HEX = (col: string) => `UPPER(REPLACE(REPLACE(REPLACE(COALESCE(${col},''), ':', ''), '-', ''), '.', ''))`;

type PortEntry = { port: number; protocol: string; service?: string | null; version?: string | null };

function parsePortsJson(json: string | null): PortEntry[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json) as Array<{ port: number; protocol?: string; service?: string | null; version?: string | null }>;
    if (Array.isArray(arr)) {
      return arr.map((p) => ({ port: p.port, protocol: p.protocol || "tcp", service: p.service, version: p.version }));
    }
  } catch { /* ignore */ }
  return [];
}

/**
 * Sostituisce le porte di un protocollo specifico mantenendo quelle dell'altro.
 */
function mergeOpenPortsByProtocol(existing: string | null, incoming: string, replaceProtocol: "tcp" | "udp"): string {
  const existingPorts = parsePortsJson(existing);
  const incomingPorts = parsePortsJson(incoming);
  const kept = existingPorts.filter((p) => p.protocol !== replaceProtocol);
  const newOfProtocol = incomingPorts.filter((p) => p.protocol === replaceProtocol);
  const merged = [...kept, ...newOfProtocol];
  const seen = new Set<string>();
  const unique: PortEntry[] = [];
  for (const p of merged) {
    const key = `${p.port}:${p.protocol}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(p);
    }
  }
  return JSON.stringify(unique.sort((a, b) => a.port - b.port || String(a.protocol).localeCompare(b.protocol)));
}

// ═══════════════════════════════════════════════════════════════════════════
// NETWORKS
// ═══════════════════════════════════════════════════════════════════════════

export function getNetworks(): (NetworkWithStats & { router_id: number | null })[] {
  return db().prepare(`
    SELECT
      n.*,
      nr.router_id,
      COALESCE(h.total_hosts, 0) as total_hosts,
      COALESCE(h.online_count, 0) as online_count,
      COALESCE(h.offline_count, 0) as offline_count,
      COALESCE(h.unknown_count, 0) as unknown_count,
      (SELECT MAX(timestamp) FROM scan_history WHERE network_id = n.id) as last_scan
    FROM networks n
    LEFT JOIN network_router nr ON nr.network_id = n.id
    LEFT JOIN (
      SELECT
        network_id,
        COUNT(*) as total_hosts,
        SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) as online_count,
        SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END) as offline_count,
        SUM(CASE WHEN status = 'unknown' THEN 1 ELSE 0 END) as unknown_count
      FROM hosts
      GROUP BY network_id
    ) h ON h.network_id = n.id
    ORDER BY n.name
  `).all() as (NetworkWithStats & { router_id: number | null })[];
}

export function getNetworksPaginated(
  page: number,
  pageSize: number,
  search?: string,
  sort?: { key?: string; dir?: SortDirection }
): { data: (NetworkWithStats & { router_id: number | null })[]; total: number } {
  const offset = (page - 1) * pageSize;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (search && search.trim()) {
    const like = `%${search.trim()}%`;
    conditions.push("(n.name LIKE ? OR n.cidr LIKE ? OR n.location LIKE ?)");
    params.push(like, like, like);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const total = (db().prepare(`SELECT COUNT(*) as cnt FROM networks n ${whereClause}`).get(...params) as { cnt: number }).cnt;

  const orderSql = sqlOrderByNetworks(sort?.key, sort?.dir ?? "asc");

  const data = db().prepare(`
    SELECT
      n.*,
      nr.router_id,
      COALESCE(h.total_hosts, 0) as total_hosts,
      COALESCE(h.online_count, 0) as online_count,
      COALESCE(h.offline_count, 0) as offline_count,
      COALESCE(h.unknown_count, 0) as unknown_count,
      (SELECT MAX(timestamp) FROM scan_history WHERE network_id = n.id) as last_scan
    FROM networks n
    LEFT JOIN network_router nr ON nr.network_id = n.id
    LEFT JOIN (
      SELECT
        network_id,
        COUNT(*) as total_hosts,
        SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) as online_count,
        SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END) as offline_count,
        SUM(CASE WHEN status = 'unknown' THEN 1 ELSE 0 END) as unknown_count
      FROM hosts
      GROUP BY network_id
    ) h ON h.network_id = n.id
    ${whereClause}
    ORDER BY ${orderSql}
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset) as (NetworkWithStats & { router_id: number | null })[];

  return { data, total };
}

export function getNetworkById(id: number): Network | undefined {
  return db().prepare("SELECT * FROM networks WHERE id = ?").get(id) as Network | undefined;
}

/** Router ARP associato alla subnet (tabella network_router), se presente. */
export function getNetworkRouterBinding(networkId: number): { id: number; name: string; host: string } | null {
  const row = db()
    .prepare(
      `SELECT nd.id, nd.name, nd.host
       FROM network_router nr
       JOIN network_devices nd ON nd.id = nr.router_id
       WHERE nr.network_id = ?
       LIMIT 1`
    )
    .get(networkId) as { id: number; name: string; host: string } | undefined;
  return row ?? null;
}

export function getNetworkContainingIp(ip: string): Network | undefined {
  const { isIpInCidr } = require("./utils") as { isIpInCidr: (ip: string, cidr: string) => boolean };
  const networks = db().prepare("SELECT * FROM networks").all() as Network[];
  for (const net of networks) {
    if (isIpInCidr(ip, net.cidr)) {
      return net;
    }
  }
  return undefined;
}

export function buildNetworkLookup(): (ip: string) => Network | undefined {
  const { ipToLong, parseCidr } = require("./utils") as {
    ipToLong: (ip: string) => number;
    parseCidr: (cidr: string) => { networkLong: number; broadcastLong: number; prefix: number };
  };
  const networks = db().prepare("SELECT * FROM networks").all() as Network[];
  const parsed = networks.map((net) => {
    const { networkLong, broadcastLong } = parseCidr(net.cidr);
    return { net, networkLong, broadcastLong };
  });

  return (ip: string) => {
    const ipLong = ipToLong(ip);
    for (const { net, networkLong, broadcastLong } of parsed) {
      if (ipLong >= networkLong && ipLong <= broadcastLong) return net;
    }
    return undefined;
  };
}

export function createNetwork(input: NetworkInput): Network {
  const { cidrOverlaps } = require("./utils") as { cidrOverlaps: (a: string, b: string) => boolean };
  const existing = db().prepare("SELECT cidr FROM networks").all() as { cidr: string }[];
  for (const net of existing) {
    if (cidrOverlaps(input.cidr, net.cidr)) {
      throw new Error(`La rete ${input.cidr} si sovrappone alla rete esistente ${net.cidr}`);
    }
  }

  const stmt = db().prepare(
    `INSERT INTO networks (cidr, name, description, gateway, vlan_id, location, snmp_community, dns_server)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    input.cidr,
    input.name,
    input.description || "",
    input.gateway || null,
    input.vlan_id || null,
    input.location || "",
    input.snmp_community || null,
    input.dns_server || null
  );
  return db().prepare("SELECT * FROM networks WHERE id = ?").get(result.lastInsertRowid) as Network;
}

export function updateNetwork(id: number, input: Partial<NetworkInput>): Network | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.cidr !== undefined) { fields.push("cidr = ?"); values.push(input.cidr); }
  if (input.name !== undefined) { fields.push("name = ?"); values.push(input.name); }
  if (input.description !== undefined) { fields.push("description = ?"); values.push(input.description); }
  if (input.gateway !== undefined) { fields.push("gateway = ?"); values.push(input.gateway); }
  if (input.vlan_id !== undefined) { fields.push("vlan_id = ?"); values.push(input.vlan_id); }
  if (input.location !== undefined) { fields.push("location = ?"); values.push(input.location); }
  if (input.snmp_community !== undefined) { fields.push("snmp_community = ?"); values.push(input.snmp_community); }
  if (input.dns_server !== undefined) { fields.push("dns_server = ?"); values.push(input.dns_server); }

  if (fields.length === 0) return getNetworkById(id);

  fields.push("updated_at = datetime('now')");
  values.push(id);

  db().prepare(`UPDATE networks SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getNetworkById(id);
}

export function deleteNetwork(id: number): boolean {
  const result = db().prepare("DELETE FROM networks WHERE id = ?").run(id);
  return result.changes > 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// HOSTS
// ═══════════════════════════════════════════════════════════════════════════

export function getHostsByNetwork(networkId: number): Host[] {
  const hosts = db().prepare(
    "SELECT * FROM hosts WHERE network_id = ?"
  ).all(networkId) as Host[];
  return hosts.sort((a, b) => ipToNum(a.ip) - ipToNum(b.ip));
}

export function getAllHostsFlat(): Host[] {
  return db().prepare("SELECT * FROM hosts").all() as Host[];
}

export function getAllHosts(limit: number = 10000): Host[] {
  const hosts = db()
    .prepare("SELECT * FROM hosts ORDER BY network_id, ip LIMIT ?")
    .all(limit) as Host[];
  return hosts.sort((a, b) => {
    if (a.network_id !== b.network_id) return a.network_id - b.network_id;
    return ipToNum(a.ip) - ipToNum(b.ip);
  });
}

/** Tutti gli host arricchiti con nome rete, device associato, porta switch, AD. Per pagina Discovery. */
export function getAllHostsEnriched(limit = 5000): Array<Host & {
  network_name: string;
  network_cidr: string;
  vlan_id: number | null;
  location: string;
  device_id?: number;
  device_name?: string;
  device_vendor?: string;
  device_type?: string;
  switch_port?: string;
  switch_device_name?: string;
  ad_dns_host_name?: string | null;
}> {
  const rows = db().prepare(`
    SELECT h.*,
           n.name  AS _net_name,
           n.cidr  AS _net_cidr,
           n.vlan_id AS _net_vlan,
           COALESCE(n.location, '') AS _net_location,
           nd.id   AS _dev_id,
           nd.name AS _dev_name,
           nd.vendor AS _dev_vendor,
           nd.device_type AS _dev_type,
           mpe.port_name AS _sw_port,
           sw.name AS _sw_name,
           ac.ad_dns AS _ad_dns
    FROM hosts h
    JOIN networks n ON n.id = h.network_id
    LEFT JOIN network_devices nd ON nd.host = h.ip
    LEFT JOIN (
      SELECT mac, port_name, device_id,
             ROW_NUMBER() OVER (PARTITION BY mac ORDER BY timestamp DESC) AS rn
      FROM mac_port_entries
    ) mpe ON mpe.mac = h.mac AND mpe.rn = 1
    LEFT JOIN network_devices sw ON sw.id = mpe.device_id
    LEFT JOIN (
      SELECT host_id, MAX(dns_host_name) AS ad_dns
      FROM ad_computers WHERE host_id IS NOT NULL
      GROUP BY host_id
    ) ac ON ac.host_id = h.id
    ORDER BY h.network_id, h.ip
    LIMIT ?
  `).all(limit) as Array<Host & {
    _net_name: string; _net_cidr: string; _net_vlan: number | null; _net_location: string;
    _dev_id?: number; _dev_name?: string; _dev_vendor?: string; _dev_type?: string;
    _sw_port?: string; _sw_name?: string; _ad_dns?: string | null;
  }>;

  return rows.map(({ _net_name, _net_cidr, _net_vlan, _net_location, _dev_id, _dev_name, _dev_vendor, _dev_type, _sw_port, _sw_name, _ad_dns, ...h }) => ({
    ...h,
    network_name: _net_name,
    network_cidr: _net_cidr,
    vlan_id: _net_vlan,
    location: _net_location,
    device_id: _dev_id ?? undefined,
    device_name: _dev_name ?? undefined,
    device_vendor: _dev_vendor ?? undefined,
    device_type: _dev_type ?? undefined,
    switch_port: _sw_port ?? undefined,
    switch_device_name: _sw_name ?? undefined,
    ad_dns_host_name: _ad_dns ?? undefined,
  }));
}

export function getHostsByNetworkWithDevices(networkId: number): (Host & {
  device_id?: number;
  device?: { id: number; name: string; sysname: string | null; vendor: string; protocol: string };
  ad_dns_host_name?: string | null;
  multihomed?: { group_id: string; match_type: string; peers: Array<{ ip: string; network_name: string; host_id: number }> } | null;
})[] {
  const hosts = db().prepare(
    `SELECT h.*, nd.id as _dev_id, nd.name as _dev_name, nd.sysname as _dev_sysname, nd.vendor as _dev_vendor, nd.protocol as _dev_protocol,
            ac.ad_dns as _ad_dns,
            ml.group_id as _mh_group, ml.match_type as _mh_type
     FROM hosts h
     LEFT JOIN network_devices nd ON nd.host = h.ip
     LEFT JOIN (
       SELECT host_id, MAX(dns_host_name) as ad_dns
       FROM ad_computers
       WHERE host_id IS NOT NULL
       GROUP BY host_id
     ) ac ON ac.host_id = h.id
     LEFT JOIN multihomed_links ml ON ml.host_id = h.id
     WHERE h.network_id = ?`
  ).all(networkId) as (Host & {
    _dev_id?: number; _dev_name?: string; _dev_sysname?: string | null; _dev_vendor?: string; _dev_protocol?: string;
    _ad_dns?: string | null; _mh_group?: string | null; _mh_type?: string | null;
  })[];

  const groupIds = new Set<string>();
  for (const h of hosts) {
    if (h._mh_group) groupIds.add(h._mh_group);
  }
  const peersByGroup = new Map<string, Array<{ ip: string; network_name: string; host_id: number }>>();
  if (groupIds.size > 0) {
    const placeholders = [...groupIds].map(() => "?").join(",");
    const peers = db().prepare(
      `SELECT ml.group_id, h.id as host_id, h.ip, n.name as network_name
       FROM multihomed_links ml
       JOIN hosts h ON h.id = ml.host_id
       JOIN networks n ON n.id = h.network_id
       WHERE ml.group_id IN (${placeholders}) AND h.network_id != ?`
    ).all(...groupIds, networkId) as Array<{ group_id: string; host_id: number; ip: string; network_name: string }>;
    for (const p of peers) {
      if (!peersByGroup.has(p.group_id)) peersByGroup.set(p.group_id, []);
      peersByGroup.get(p.group_id)!.push({ ip: p.ip, network_name: p.network_name, host_id: p.host_id });
    }
  }

  return hosts
    .sort((a, b) => ipToNum(a.ip) - ipToNum(b.ip))
    .map(({ _dev_id, _dev_name, _dev_sysname, _dev_vendor, _dev_protocol, _ad_dns, _mh_group, _mh_type, ...h }) => ({
      ...h,
      device_id: _dev_id ?? undefined,
      device: _dev_id ? { id: _dev_id, name: _dev_name!, sysname: _dev_sysname ?? null, vendor: _dev_vendor!, protocol: _dev_protocol! } : undefined,
      ad_dns_host_name: _ad_dns ?? undefined,
      multihomed: _mh_group && peersByGroup.has(_mh_group)
        ? { group_id: _mh_group, match_type: _mh_type ?? "hostname", peers: peersByGroup.get(_mh_group)! }
        : null,
    }));
}

export function getKnownHosts(networkId?: number | null): Host[] {
  if (networkId != null) {
    return db().prepare("SELECT * FROM hosts WHERE known_host = 1 AND network_id = ?").all(networkId) as Host[];
  }
  return db().prepare("SELECT * FROM hosts WHERE known_host = 1").all() as Host[];
}

export function getHostByMac(mac: string): Host | undefined {
  const hex = macToHex(mac);
  if (hex.length < 12) return undefined;
  return db().prepare(`SELECT * FROM hosts WHERE ${MAC_HEX("mac")} = ? LIMIT 1`).get(hex) as Host | undefined;
}

export function resolveMacToNetworkDevice(mac: string, excludeDeviceId?: number): { device_id: number; device_name: string; device_type: string } | null {
  let ip: string | null = null;
  const host = getHostByMac(mac);
  if (host) ip = host.ip;
  if (!ip) {
    const hex = macToHex(mac);
    const arp = db().prepare(
      `SELECT ip FROM arp_entries WHERE ${MAC_HEX("mac")} = ? AND ip IS NOT NULL ORDER BY timestamp DESC LIMIT 1`
    ).get(hex) as { ip: string } | undefined;
    ip = arp?.ip ?? null;
  }
  if (!ip) return null;
  const nd = db().prepare(
    "SELECT id, name, device_type FROM network_devices WHERE host = ? AND (enabled = 1 OR enabled IS NULL)"
  ).get(ip) as { id: number; name: string; device_type: string } | undefined;
  if (!nd || (excludeDeviceId != null && nd.id === excludeDeviceId)) return null;
  return { device_id: nd.id, device_name: nd.name, device_type: nd.device_type };
}

export function resolveMacToDevice(mac: string): { ip: string | null; hostname: string | null; vendor: string | null; host_id: number | null } {
  const host = getHostByMac(mac);
  if (host) {
    return {
      ip: host.ip,
      hostname: host.custom_name || host.hostname,
      vendor: host.vendor,
      host_id: host.id,
    };
  }
  const hex = macToHex(mac);
  const arp = db().prepare(
    `SELECT ip FROM arp_entries WHERE ${MAC_HEX("mac")} = ? AND ip IS NOT NULL ORDER BY timestamp DESC LIMIT 1`
  ).get(hex) as { ip: string } | undefined;
  if (arp?.ip) {
    return { ip: arp.ip, hostname: null, vendor: null, host_id: null };
  }
  const mapping = db().prepare(
    "SELECT ip, hostname, vendor, host_id FROM mac_ip_mapping WHERE mac_normalized = ?"
  ).get(hex) as { ip: string; hostname: string | null; vendor: string | null; host_id: number | null } | undefined;
  return {
    ip: mapping?.ip ?? null,
    hostname: mapping?.hostname ?? null,
    vendor: mapping?.vendor ?? null,
    host_id: mapping?.host_id ?? null,
  };
}

export function getHostBasic(
  id: number
): Pick<Host, "id" | "ip" | "custom_name" | "hostname" | "vendor" | "device_manufacturer"> | undefined {
  return db()
    .prepare("SELECT id, ip, custom_name, hostname, vendor, device_manufacturer FROM hosts WHERE id = ?")
    .get(id) as Pick<Host, "id" | "ip" | "custom_name" | "hostname" | "vendor" | "device_manufacturer"> | undefined;
}

export function getHostByIp(ip: string): Host | undefined {
  return db().prepare("SELECT * FROM hosts WHERE ip = ? LIMIT 1").get(ip) as Host | undefined;
}

export function getHostById(id: number): HostDetail | undefined {
  const host = db().prepare(`
    SELECT h.*, n.cidr as network_cidr, n.name as network_name
    FROM hosts h
    JOIN networks n ON n.id = h.network_id
    WHERE h.id = ?
  `).get(id) as (Host & { network_cidr: string; network_name: string }) | undefined;

  if (!host) return undefined;

  const recentScans = db().prepare(
    "SELECT * FROM scan_history WHERE host_id = ? ORDER BY timestamp DESC LIMIT 50"
  ).all(id) as ScanHistory[];

  const arpSource = host.mac ? db().prepare(`
    SELECT nd.name as device_name, nd.vendor as device_vendor, ae.timestamp as last_query
    FROM arp_entries ae
    JOIN network_devices nd ON nd.id = ae.device_id
    WHERE ${MAC_HEX("ae.mac")} = ? AND nd.device_type = 'router'
    ORDER BY ae.timestamp DESC LIMIT 1
  `).get(macToHex(host.mac)) as { device_name: string; device_vendor: string; last_query: string } | undefined : undefined;

  const switchPort = host.mac ? db().prepare(`
    SELECT nd.name as device_name, nd.vendor as device_vendor, mpe.port_name, mpe.vlan
    FROM mac_port_entries mpe
    JOIN network_devices nd ON nd.id = mpe.device_id
    WHERE ${MAC_HEX("mpe.mac")} = ? AND nd.device_type = 'switch'
    ORDER BY mpe.timestamp DESC LIMIT 1
  `).get(macToHex(host.mac)) as { device_name: string; device_vendor: string; port_name: string; vlan: number | null } | undefined : undefined;

  const networkDevice = getNetworkDeviceByHost(host.ip);

  const scanTypesSeen = [...new Set(recentScans.map((s) => s.scan_type))];

  return {
    ...host,
    recent_scans: recentScans,
    scan_types_used: scanTypesSeen,
    detect_credentials: getHostDetectCredentialsEnriched(id),
    host_credentials: getHostCredentials(id),
    arp_source: arpSource || null,
    switch_port: switchPort || null,
    network_device: networkDevice ? { id: networkDevice.id, name: networkDevice.name, sysname: networkDevice.sysname, vendor: networkDevice.vendor, protocol: networkDevice.protocol } : null,
  };
}

export function mergeOpenPortsJson(existing: string | null, incoming: string): string {
  const toMap = (ports: PortEntry[]): Map<string, PortEntry> => {
    const map = new Map<string, PortEntry>();
    for (const p of ports) {
      const key = `${p.port}:${p.protocol}`;
      if (!map.has(key)) map.set(key, p);
    }
    return map;
  };
  const merged = toMap(parsePortsJson(existing));
  const incomingMap = toMap(parsePortsJson(incoming));
  for (const [k, v] of incomingMap) {
    merged.set(k, v);
  }
  return JSON.stringify([...merged.values()].sort((a, b) => a.port - b.port || String(a.protocol).localeCompare(b.protocol)));
}

export function upsertHost(input: HostInput & { mac?: string; vendor?: string; hostname?: string; hostname_source?: string; dns_forward?: string; dns_reverse?: string; status?: "online" | "offline" | "unknown"; open_ports?: string; open_ports_replace?: boolean; open_ports_replace_protocol?: "tcp" | "udp"; os_info?: string; model?: string; serial_number?: string; firmware?: string | null; device_manufacturer?: string | null; detection_json?: string | null; snmp_data?: string | null; preserve_existing?: boolean }): Host {
  const existing = db().prepare(
    "SELECT id FROM hosts WHERE network_id = ? AND ip = ?"
  ).get(input.network_id, input.ip) as { id: number } | undefined;

  if (existing) {
    const existingRow = db().prepare(
      "SELECT open_ports, classification_manual, model, serial_number, firmware, device_manufacturer, os_info, mac FROM hosts WHERE id = ?"
    ).get(existing.id) as { open_ports: string | null; classification_manual?: number; model?: string | null; serial_number?: string | null; firmware?: string | null; device_manufacturer?: string | null; os_info?: string | null; mac?: string | null } | undefined;
    const classificationManual = existingRow?.classification_manual === 1;
    const preserve = input.preserve_existing === true;
    const fields: string[] = ["updated_at = datetime('now')"];
    const values: unknown[] = [];

    if (input.mac !== undefined) {
      fields.push("mac = ?");
      values.push(normalizeMacForStorage(input.mac) ?? null);
    }
    if (input.vendor !== undefined) { fields.push("vendor = ?"); values.push(input.vendor); }
    if (input.hostname !== undefined) {
      const HOSTNAME_PRIORITY: Record<string, number> = { manual: 6, dhcp: 5, snmp: 4, nmap: 3, dns: 2, arp: 1 };
      const existingSource = (db().prepare("SELECT hostname_source FROM hosts WHERE id = ?").get(existing.id) as { hostname_source?: string })?.hostname_source;
      const newPriority = HOSTNAME_PRIORITY[input.hostname_source ?? ""] ?? 0;
      const oldPriority = HOSTNAME_PRIORITY[existingSource ?? ""] ?? 0;
      if (newPriority >= oldPriority || !existingSource) {
        fields.push("hostname = ?"); values.push(input.hostname);
        if (input.hostname_source) { fields.push("hostname_source = ?"); values.push(input.hostname_source); }
      }
    }
    if (input.dns_forward !== undefined) { fields.push("dns_forward = ?"); values.push(input.dns_forward); }
    if (input.dns_reverse !== undefined) { fields.push("dns_reverse = ?"); values.push(input.dns_reverse); }
    if (input.status !== undefined) {
      fields.push("status = ?");
      values.push(input.status);
      if (input.status === "online") {
        fields.push("last_seen = datetime('now')");
      }
    }
    if (input.custom_name !== undefined) { fields.push("custom_name = ?"); values.push(input.custom_name); }
    if (input.classification !== undefined && !classificationManual) {
      if (input.classification !== "unknown") {
        fields.push("classification = ?"); values.push(input.classification);
      } else {
        const cur = (db().prepare("SELECT classification FROM hosts WHERE id = ?").get(existing.id) as { classification?: string })?.classification;
        if (!cur || cur === "unknown") {
          fields.push("classification = ?"); values.push(input.classification);
        }
      }
    }
    if (input.inventory_code !== undefined) { fields.push("inventory_code = ?"); values.push(input.inventory_code); }
    if (input.notes !== undefined) { fields.push("notes = ?"); values.push(input.notes); }
    if (input.open_ports !== undefined) {
      let portsValue: string;
      if (input.open_ports_replace_protocol) {
        portsValue = mergeOpenPortsByProtocol(existingRow?.open_ports ?? null, input.open_ports, input.open_ports_replace_protocol);
      } else if (input.open_ports_replace) {
        portsValue = input.open_ports;
      } else {
        portsValue = mergeOpenPortsJson(existingRow?.open_ports ?? null, input.open_ports);
      }
      fields.push("open_ports = ?");
      values.push(portsValue);
    }
    if (input.os_info !== undefined) {
      if (!preserve || !existingRow?.os_info) { fields.push("os_info = ?"); values.push(input.os_info); }
    }
    if (input.model !== undefined) {
      if (!preserve || !existingRow?.model) { fields.push("model = ?"); values.push(input.model); }
    }
    if (input.serial_number !== undefined) {
      if (!preserve || !existingRow?.serial_number) { fields.push("serial_number = ?"); values.push(input.serial_number); }
    }
    if (input.firmware !== undefined) {
      if (!preserve || !existingRow?.firmware) { fields.push("firmware = ?"); values.push(input.firmware); }
    }
    if (input.device_manufacturer !== undefined) {
      if (!preserve || !existingRow?.device_manufacturer) { fields.push("device_manufacturer = ?"); values.push(input.device_manufacturer); }
    }
    if (input.snmp_data !== undefined) { fields.push("snmp_data = ?"); values.push(input.snmp_data); }
    if (input.detection_json !== undefined) {
      let shouldUpdate = true;
      if (input.detection_json && !input.open_ports_replace) {
        try {
          const incoming = JSON.parse(input.detection_json) as { final_confidence?: number; open_ports?: number[] };
          const existingDet = (db().prepare("SELECT detection_json FROM hosts WHERE id = ?").get(existing.id) as { detection_json?: string | null })?.detection_json;
          if (existingDet) {
            const prev = JSON.parse(existingDet) as { final_confidence?: number; open_ports?: number[] };
            const prevPorts = prev.open_ports?.length ?? 0;
            const newPorts = incoming.open_ports?.length ?? 0;
            if (prevPorts > newPorts && (prev.final_confidence ?? 0) > (incoming.final_confidence ?? 0)) {
              shouldUpdate = false;
            }
          }
        } catch { /* parse error → update anyway */ }
      }
      if (shouldUpdate) { fields.push("detection_json = ?"); values.push(input.detection_json); }
    }

    values.push(existing.id);
    db().prepare(`UPDATE hosts SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    const host = db().prepare("SELECT * FROM hosts WHERE id = ?").get(existing.id) as Host;
    if (host.mac && input.ip) {
      upsertMacIpMapping({
        mac: host.mac,
        ip: input.ip,
        source: "host",
        network_id: input.network_id,
        host_id: host.id,
        vendor: host.vendor ?? undefined,
        hostname: host.hostname ?? undefined,
      });
    }
    if (input.mac !== undefined && host.mac && existing) {
      const duplicate = db().prepare(
        "SELECT id, ip FROM hosts WHERE network_id = ? AND mac = ? AND id != ?"
      ).get(input.network_id, host.mac, existing.id) as { id: number; ip: string } | undefined;
      if (duplicate) {
        db().prepare("UPDATE hosts SET conflict_flags = ? WHERE id = ?")
          .run(`mac_duplicate:${duplicate.ip}`, existing.id);
        db().prepare("UPDATE hosts SET conflict_flags = ? WHERE id = ?")
          .run(`mac_duplicate:${input.ip}`, duplicate.id);
      }
    }
    if (input.mac !== undefined) {
      const prevHex = macToHex(existingRow?.mac ?? "");
      const newHex = macToHex(host.mac ?? "");
      if (prevHex !== newHex) {
        syncIpAssignmentsForNetwork(input.network_id);
      }
    }
    return host;
  }

  const stmt = db().prepare(`
    INSERT INTO hosts (network_id, ip, mac, vendor, hostname, hostname_source, dns_forward, dns_reverse, custom_name, classification, inventory_code, notes, status, open_ports, os_info, model, serial_number, firmware, device_manufacturer, detection_json, snmp_data, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${input.status === "online" ? "datetime('now')" : "NULL"}, ${input.status === "online" ? "datetime('now')" : "NULL"})
  `);
  const result = stmt.run(
    input.network_id,
    input.ip,
    normalizeMacForStorage(input.mac ?? "") ?? null,
    input.vendor || null,
    input.hostname || null,
    input.hostname_source || null,
    input.dns_forward || null,
    input.dns_reverse || null,
    input.custom_name || null,
    input.classification || "unknown",
    input.inventory_code || null,
    input.notes || "",
    input.status || "unknown",
    (input as { open_ports?: string }).open_ports || null,
    (input as { os_info?: string }).os_info || null,
    (input as { model?: string }).model || null,
    (input as { serial_number?: string }).serial_number || null,
    (input as { firmware?: string | null }).firmware ?? null,
    (input as { device_manufacturer?: string | null }).device_manufacturer ?? null,
    (input as { detection_json?: string | null }).detection_json ?? null,
    (input as { snmp_data?: string | null }).snmp_data ?? null
  );
  const host = db().prepare("SELECT * FROM hosts WHERE id = ?").get(result.lastInsertRowid) as Host;
  if (host.mac && input.ip) {
    upsertMacIpMapping({
      mac: host.mac,
      ip: input.ip,
      source: "host",
      network_id: input.network_id,
      host_id: host.id,
      vendor: host.vendor ?? undefined,
      hostname: host.hostname ?? undefined,
    });
  }
  return host;
}

export function updateHost(id: number, input: HostUpdate): Host | undefined {
  const prevForMac =
    input.mac !== undefined
      ? (db().prepare("SELECT network_id, mac FROM hosts WHERE id = ?").get(id) as
          | { network_id: number; mac: string | null }
          | undefined)
      : undefined;

  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.custom_name !== undefined) { fields.push("custom_name = ?"); values.push(input.custom_name); }
  if (input.classification !== undefined) {
    fields.push("classification = ?");
    values.push(input.classification);
    fields.push("classification_manual = 1");
  }
  if (input.inventory_code !== undefined) { fields.push("inventory_code = ?"); values.push(input.inventory_code); }
  if (input.notes !== undefined) { fields.push("notes = ?"); values.push(input.notes); }
  if (input.mac !== undefined) { fields.push("mac = ?"); values.push(normalizeMacForStorage(input.mac) ?? null); }
  if (input.known_host !== undefined) { fields.push("known_host = ?"); values.push(input.known_host); }
  if (input.monitor_ports !== undefined) { fields.push("monitor_ports = ?"); values.push(input.monitor_ports); }
  if (input.device_manufacturer !== undefined) { fields.push("device_manufacturer = ?"); values.push(input.device_manufacturer); }
  if (input.ip_assignment !== undefined) { fields.push("ip_assignment = ?"); values.push(input.ip_assignment); }
  if (input.status !== undefined) {
    fields.push("status = ?");
    values.push(input.status);
    if (input.status === "online") {
      fields.push("last_seen = datetime('now')");
    }
  }

  if (fields.length === 0) return db().prepare("SELECT * FROM hosts WHERE id = ?").get(id) as Host | undefined;

  fields.push("updated_at = datetime('now')");
  values.push(id);

  db().prepare(`UPDATE hosts SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  const updated = db().prepare("SELECT * FROM hosts WHERE id = ?").get(id) as Host | undefined;
  if (input.mac !== undefined && prevForMac && updated) {
    if (macToHex(prevForMac.mac ?? "") !== macToHex(updated.mac ?? "")) {
      syncIpAssignmentsForNetwork(prevForMac.network_id);
    }
  }
  return updated;
}

export function deleteHost(id: number): boolean {
  return db().prepare("DELETE FROM hosts WHERE id = ?").run(id).changes > 0;
}

export function bulkUpdateHostsKnownHost(networkId: number, hostIds: number[], knownHost: 0 | 1): number {
  if (hostIds.length === 0) return 0;
  const placeholders = hostIds.map(() => "?").join(",");
  const stmt = db().prepare(
    `UPDATE hosts SET known_host = ?, updated_at = datetime('now') WHERE network_id = ? AND id IN (${placeholders})`
  );
  return stmt.run(knownHost, networkId, ...hostIds).changes;
}

export function bulkDeleteHosts(networkId: number, hostIds: number[]): number {
  if (hostIds.length === 0) return 0;
  const placeholders = hostIds.map(() => "?").join(",");
  const stmt = db().prepare(`DELETE FROM hosts WHERE network_id = ? AND id IN (${placeholders})`);
  return stmt.run(networkId, ...hostIds).changes;
}

export function countHostsInNetwork(networkId: number, hostIds: number[]): number {
  if (hostIds.length === 0) return 0;
  const unique = [...new Set(hostIds)];
  const placeholders = unique.map(() => "?").join(",");
  const row = db()
    .prepare(`SELECT COUNT(*) AS c FROM hosts WHERE network_id = ? AND id IN (${placeholders})`)
    .get(networkId, ...unique) as { c: number };
  return row.c;
}

export function getKnownHostsWithNetwork(): KnownHostWithNetworkRow[] {
  return db()
    .prepare(
      `SELECT h.*, n.name AS network_name, n.cidr AS network_cidr
       FROM hosts h
       INNER JOIN networks n ON h.network_id = n.id
       WHERE h.known_host = 1
       ORDER BY n.name COLLATE NOCASE, h.ip`
    )
    .all() as KnownHostWithNetworkRow[];
}

export function markHostsOffline(networkId: number, onlineIps: string[], scannedIps?: string[]): void {
  if (scannedIps?.length) {
    const onlineSet = new Set(onlineIps);
    const toOffline = scannedIps.filter((ip) => !onlineSet.has(ip));
    if (toOffline.length === 0) return;
    const ph = toOffline.map(() => "?").join(",");
    db().prepare(
      `UPDATE hosts SET status = 'offline', updated_at = datetime('now') WHERE network_id = ? AND ip IN (${ph})`
    ).run(networkId, ...toOffline);
    return;
  }
  if (onlineIps.length === 0) {
    db().prepare(
      "UPDATE hosts SET status = 'offline', updated_at = datetime('now') WHERE network_id = ? AND status = 'online'"
    ).run(networkId);
    return;
  }
  const placeholders = onlineIps.map(() => "?").join(",");
  db().prepare(
    `UPDATE hosts SET status = 'offline', updated_at = datetime('now') WHERE network_id = ? AND status = 'online' AND ip NOT IN (${placeholders})`
  ).run(networkId, ...onlineIps);
}

export function noteHostsNonResponding(
  networkId: number,
  onlineIps: string[],
  scannedIps: string[],
  scanType: string
): void {
  const onlineSet = new Set(onlineIps);
  const nonResponding = scannedIps.filter((ip) => !onlineSet.has(ip));
  if (nonResponding.length === 0) return;
  const dateStr = new Date().toISOString().slice(0, 10);
  const tag = `[${dateStr}] Non risposto (${scanType}) — verificare se eliminare`;
  const d = db();
  for (const ip of nonResponding) {
    const row = d.prepare(
      "SELECT id, notes FROM hosts WHERE network_id = ? AND ip = ?"
    ).get(networkId, ip) as { id: number; notes: string } | undefined;
    if (!row) continue;
    const existingNotes = row.notes ?? "";
    if (existingNotes.includes(`[${dateStr}]`)) continue;
    const updated = existingNotes.trim() ? `${existingNotes.trim()}\n${tag}` : tag;
    d.prepare(
      "UPDATE hosts SET notes = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(updated, row.id);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SCAN HISTORY
// ═══════════════════════════════════════════════════════════════════════════

export function addScanHistory(entry: Omit<ScanHistory, "id" | "timestamp">): void {
  db().prepare(
    `INSERT INTO scan_history (host_id, network_id, scan_type, status, ports_open, raw_output, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.host_id,
    entry.network_id,
    entry.scan_type,
    entry.status,
    entry.ports_open,
    entry.raw_output,
    entry.duration_ms
  );
}

export function getScanHistory(filters: { host_id?: number; network_id?: number; limit?: number }): ScanHistory[] {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.host_id) { conditions.push("host_id = ?"); values.push(filters.host_id); }
  if (filters.network_id) { conditions.push("network_id = ?"); values.push(filters.network_id); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters.limit || 100;

  return db().prepare(
    `SELECT * FROM scan_history ${where} ORDER BY timestamp DESC LIMIT ?`
  ).all(...values, limit) as ScanHistory[];
}

// ═══════════════════════════════════════════════════════════════════════════
// NETWORK DEVICES
// ═══════════════════════════════════════════════════════════════════════════

export function getNetworkDevices(): NetworkDevice[] {
  return db().prepare("SELECT * FROM network_devices ORDER BY name").all() as NetworkDevice[];
}

export function getRouters(): NetworkDevice[] {
  return db().prepare("SELECT * FROM network_devices WHERE device_type = 'router' ORDER BY name").all() as NetworkDevice[];
}

export function getSwitches(): NetworkDevice[] {
  return db().prepare("SELECT * FROM network_devices WHERE device_type = 'switch' ORDER BY name").all() as NetworkDevice[];
}

export function getDevicesByClassification(classification: string): NetworkDevice[] {
  if (classification === "storage") {
    return db()
      .prepare("SELECT * FROM network_devices WHERE classification IN ('storage', 'nas', 'nas_synology', 'nas_qnap') ORDER BY name")
      .all() as NetworkDevice[];
  }
  return db()
    .prepare("SELECT * FROM network_devices WHERE classification = ? ORDER BY name")
    .all(classification) as NetworkDevice[];
}

export function getDevicesByClassificationOrLegacy(classification: string): NetworkDevice[] {
  if (classification === "router") {
    return db().prepare(
      "SELECT * FROM network_devices WHERE classification = 'router' OR (device_type = 'router' AND (classification IS NULL OR classification = '')) ORDER BY name"
    ).all() as NetworkDevice[];
  }
  if (classification === "switch") {
    return db().prepare(
      "SELECT * FROM network_devices WHERE classification = 'switch' OR (device_type = 'switch' AND (classification IS NULL OR classification = '')) ORDER BY name"
    ).all() as NetworkDevice[];
  }
  return getDevicesByClassification(classification);
}

export function getHostsByClassification(classification: string): (Host & { network_name?: string })[] {
  if (classification === "storage") {
    return db()
      .prepare(
        `SELECT h.*, n.name as network_name FROM hosts h
         JOIN networks n ON n.id = h.network_id
         WHERE h.classification IN ('storage', 'nas', 'nas_synology', 'nas_qnap') ORDER BY h.custom_name, h.hostname, h.ip`
      )
      .all() as (Host & { network_name?: string })[];
  }
  return db()
    .prepare(
      `SELECT h.*, n.name as network_name FROM hosts h
       JOIN networks n ON n.id = h.network_id
       WHERE h.classification = ? ORDER BY h.custom_name, h.hostname, h.ip`
    )
    .all(classification) as (Host & { network_name?: string })[];
}

export function getNetworkRouterId(networkId: number): number | null {
  const row = db().prepare("SELECT router_id FROM network_router WHERE network_id = ?").get(networkId) as { router_id: number } | undefined;
  return row?.router_id ?? null;
}

export function setNetworkRouter(networkId: number, routerId: number): void {
  db().prepare(
    "INSERT OR REPLACE INTO network_router (network_id, router_id) VALUES (?, ?)"
  ).run(networkId, routerId);
}

export function deleteNetworkRouter(networkId: number): void {
  db().prepare("DELETE FROM network_router WHERE network_id = ?").run(networkId);
}

export function getNetworkDeviceById(id: number): NetworkDevice | undefined {
  return db().prepare("SELECT * FROM network_devices WHERE id = ?").get(id) as NetworkDevice | undefined;
}

export function getNetworkDeviceByHost(ip: string): NetworkDevice | undefined {
  return db().prepare("SELECT * FROM network_devices WHERE host = ?").get(ip) as NetworkDevice | undefined;
}

type CreateDeviceInput = Omit<NetworkDevice, "id" | "created_at" | "updated_at" | "sysname" | "sysdescr" | "model" | "firmware" | "serial_number" | "part_number" | "last_info_update" | "last_device_info_json" | "classification" | "stp_info" | "last_proxmox_scan_at" | "last_proxmox_scan_result" | "scan_target" | "product_profile"> & {
  classification?: string | null;
  scan_target?: string | null;
  product_profile?: string | null;
};

export function createNetworkDevice(input: CreateDeviceInput): NetworkDevice {
  const stmt = db().prepare(
    `INSERT INTO network_devices (name, host, device_type, vendor, vendor_subtype, protocol, credential_id, snmp_credential_id, username, encrypted_password, community_string, api_token, api_url, port, enabled, classification, scan_target, product_profile)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    input.name, input.host, input.device_type, input.vendor,
    input.vendor_subtype ?? null, input.protocol,
    input.credential_id ?? null, (input as { snmp_credential_id?: number | null }).snmp_credential_id ?? null,
    input.username, input.encrypted_password,
    input.community_string, input.api_token, input.api_url, input.port, input.enabled,
    (input as { classification?: string | null }).classification ?? null,
    (input as { scan_target?: string | null }).scan_target ?? null,
    (input as { product_profile?: string | null }).product_profile ?? null
  );
  return db().prepare("SELECT * FROM network_devices WHERE id = ?").get(result.lastInsertRowid) as NetworkDevice;
}

export function updateNetworkDevice(id: number, input: Partial<Omit<NetworkDevice, "id" | "created_at" | "updated_at">>): NetworkDevice | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];

  const keys = ["name", "host", "device_type", "vendor", "vendor_subtype", "protocol", "credential_id", "snmp_credential_id", "username", "encrypted_password", "community_string", "api_token", "api_url", "port", "enabled", "classification", "sysname", "sysdescr", "model", "firmware", "serial_number", "part_number", "last_info_update", "last_device_info_json", "stp_info", "last_proxmox_scan_at", "last_proxmox_scan_result", "scan_target", "product_profile"] as const;
  for (const key of keys) {
    if (input[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(input[key]);
    }
  }

  if (fields.length === 0) return getNetworkDeviceById(id);

  fields.push("updated_at = datetime('now')");
  values.push(id);
  db().prepare(`UPDATE network_devices SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getNetworkDeviceById(id);
}

export function deleteNetworkDevice(id: number): boolean {
  return db().prepare("DELETE FROM network_devices WHERE id = ?").run(id).changes > 0;
}

export function getDevicesPaginated(
  page: number,
  pageSize: number,
  search?: string
): { data: NetworkDevice[]; total: number } {
  const offset = (page - 1) * pageSize;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (search && search.trim()) {
    const like = `%${search.trim()}%`;
    conditions.push("(name LIKE ? OR host LIKE ? OR vendor LIKE ? OR classification LIKE ?)");
    params.push(like, like, like, like);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const total = (db().prepare(`SELECT COUNT(*) as cnt FROM network_devices ${whereClause}`).get(...params) as { cnt: number }).cnt;

  const data = db().prepare(`
    SELECT * FROM network_devices ${whereClause} ORDER BY name LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset) as NetworkDevice[];

  return { data, total };
}

export function syncDeviceToHost(deviceId: number): void {
  const device = getNetworkDeviceById(deviceId);
  if (!device) return;

  const host = db().prepare("SELECT id, vendor, device_manufacturer FROM hosts WHERE ip = ? LIMIT 1")
    .get(device.host) as { id: number; vendor: string | null; device_manufacturer: string | null } | undefined;
  if (!host) return;

  // Parse last_device_info_json per campi estesi (manufacturer, os_name, os_version)
  let extInfo: Record<string, unknown> = {};
  if (device.last_device_info_json) {
    try { extInfo = JSON.parse(device.last_device_info_json); } catch { /* ignore */ }
  }

  const updates: string[] = ["updated_at = datetime('now')"];
  const values: unknown[] = [];

  if (device.model) { updates.push("model = ?"); values.push(device.model); }
  if (device.serial_number) { updates.push("serial_number = ?"); values.push(device.serial_number); }
  if (device.firmware) { updates.push("firmware = ?"); values.push(device.firmware); }
  if (device.sysname && !device.sysname.match(/^[\d.]+$/)) {
    updates.push("hostname = ?"); values.push(device.sysname);
    updates.push("hostname_source = ?"); values.push("snmp");
  }

  // OS info: preferisci os_name+os_version (WinRM/SSH) se presenti, altrimenti sysdescr
  const osName = typeof extInfo.os_name === "string" ? extInfo.os_name : null;
  const osVersion = typeof extInfo.os_version === "string" ? extInfo.os_version : null;
  if (osName) {
    updates.push("os_info = ?");
    values.push(osVersion ? `${osName} ${osVersion}` : osName);
  } else if (device.sysdescr) {
    updates.push("os_info = ?");
    values.push(device.sysdescr);
  }

  // Produttore: da device info > da SNMP manufacturer > fallback MAC vendor dell'host
  const mfr = typeof extInfo.manufacturer === "string" ? extInfo.manufacturer : null;
  const manufacturer = mfr || host.vendor || null;
  if (manufacturer && !host.device_manufacturer) {
    updates.push("device_manufacturer = ?");
    values.push(manufacturer);
  } else if (mfr) {
    // Se abbiamo un produttore specifico da SNMP/SSH/WinRM, sovrascrive sempre
    updates.push("device_manufacturer = ?");
    values.push(mfr);
  }

  if (values.length > 0) {
    values.push(host.id);
    db().prepare(`UPDATE hosts SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  }
}

export function trackDeviceInfoChanges(deviceId: number, newInfoObj: object): string[] {
  const device = getNetworkDeviceById(deviceId);
  if (!device || !device.last_device_info_json) return [];

  const newInfo = newInfoObj as Record<string, unknown>;
  let oldInfo: Record<string, unknown>;
  try { oldInfo = JSON.parse(device.last_device_info_json); } catch { return []; }

  const changes: string[] = [];
  const importantFields = ["firmware", "model", "serial_number", "os_name", "os_version", "hostname", "sysname", "sysdescr"];

  for (const field of importantFields) {
    const oldVal = oldInfo[field];
    const newVal = newInfo[field];
    if (newVal != null && oldVal != null && String(oldVal) !== String(newVal)) {
      changes.push(field);
    }
  }

  if (changes.length > 0) {
    const hostRow = db().prepare("SELECT id FROM hosts WHERE ip = ? LIMIT 1").get(device.host) as { id: number } | undefined;
    db().prepare(
      "INSERT INTO scan_history (host_id, network_id, scan_type, status, raw_output, duration_ms) VALUES (?, NULL, 'snmp', ?, ?, 0)"
    ).run(
      hostRow?.id ?? null,
      `device_info_changed: ${changes.join(", ")}`,
      JSON.stringify({ device_id: deviceId, device_name: device.name, changes: changes.map(f => ({ field: f, old: String(oldInfo[f] ?? ""), new: String(newInfo[f] ?? "") })) })
    );
  }

  return changes;
}

export function syncNetworkDeviceFromHostScan(ip: string, hostOpenPorts: Array<{ port: number; protocol?: string }>, hostClassification: string | null): void {
  const device = getNetworkDeviceByHost(ip);
  if (!device) return;

  const tcpPorts = new Set(hostOpenPorts.filter((p) => (p.protocol ?? "tcp") === "tcp").map((p) => p.port));
  const updates: Partial<NetworkDevice> = {};

  const candidatesMap: Record<string, number[]> = {
    ssh: [22, 2222],
    snmp_v2: [161],
    snmp_v3: [161],
    api: [443, 8728, 8006, 80],
    winrm: [5985, 5986],
  };
  const candidatesVendor: Record<string, number[]> = {
    mikrotik: [8291, 8728, 22, 443],
    proxmox: [8006, 443],
    omada: [443],
    cisco: [22, 23, 443],
    ubiquiti: [443, 22],
    hp: [22, 23, 443],
    fortinet: [443, 22],
    vmware: [443],
    generic: [22, 443, 80],
  };

  const currentPort = device.port ?? 22;
  const protocol = device.protocol ?? "ssh";
  const vendor = (device.vendor ?? "generic").toLowerCase();

  if (!tcpPorts.has(currentPort)) {
    const vendorCandidates = candidatesVendor[vendor] ?? [];
    const protoCandidates = candidatesMap[protocol] ?? [];
    const orderedCandidates = [...new Set([...vendorCandidates, ...protoCandidates])];
    for (const c of orderedCandidates) {
      if (tcpPorts.has(c)) {
        updates.port = c;
        break;
      }
    }
  }

  if (hostClassification && hostClassification !== "unknown") {
    const deviceClassification = device.classification ?? device.device_type;
    const isInfra = ["router", "switch", "hypervisor"].includes(device.device_type);
    if (isInfra && deviceClassification !== hostClassification) {
      const infraSpecific = ["router", "switch", "hypervisor", "firewall", "access_point", "load_balancer", "vpn_gateway", "server", "server_linux", "server_windows", "nas", "nas_synology", "nas_qnap", "storage"];
      if (infraSpecific.includes(hostClassification)) {
        updates.classification = hostClassification;
      }
    }
  }

  if (Object.keys(updates).length > 0) {
    updateNetworkDevice(device.id, updates);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CREDENTIALS
// ═══════════════════════════════════════════════════════════════════════════

export function getAllCredentials(): Credential[] {
  return db().prepare("SELECT * FROM credentials ORDER BY name").all() as Credential[];
}

export function getCredentialById(id: number): Credential | undefined {
  return db().prepare("SELECT * FROM credentials WHERE id = ?").get(id) as Credential | undefined;
}

export function createCredential(input: CredentialInput & { encrypted_username?: string | null; encrypted_password?: string | null }): Credential {
  const stmt = db().prepare(
    `INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password)
     VALUES (?, ?, ?, ?)`
  );
  const result = stmt.run(
    input.name,
    input.credential_type,
    input.encrypted_username ?? null,
    input.encrypted_password ?? null
  );
  return db().prepare("SELECT * FROM credentials WHERE id = ?").get(result.lastInsertRowid) as Credential;
}

export function updateCredential(id: number, input: Partial<CredentialInput> & { encrypted_username?: string | null; encrypted_password?: string | null }): Credential | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];
  const keys = ["name", "credential_type", "encrypted_username", "encrypted_password"] as const;
  for (const key of keys) {
    if (input[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(input[key]);
    }
  }
  if (fields.length === 0) return getCredentialById(id);
  fields.push("updated_at = datetime('now')");
  values.push(id);
  db().prepare(`UPDATE credentials SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getCredentialById(id);
}

export function deleteCredential(id: number): boolean {
  return db().prepare("DELETE FROM credentials WHERE id = ?").run(id).changes > 0;
}

/**
 * Restituisce le credenziali host Windows (da settings host_windows_credential_id).
 * Importa getSetting dal hub.
 */
export function getHostWindowsCredentials(): { username: string; password: string } | null {
  // getSetting lives in the hub DB — lazy import to avoid circular deps
  const { getSetting } = require("./db") as { getSetting: (key: string) => string | null };
  const idStr = getSetting("host_windows_credential_id");
  if (!idStr?.trim()) return null;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return null;
  const cred = getCredentialById(id);
  if (!cred || String(cred.credential_type || "").toLowerCase() !== "windows") return null;
  const username = cred.encrypted_username ? safeDecrypt(cred.encrypted_username) : "";
  const password = cred.encrypted_password ? safeDecrypt(cred.encrypted_password) : "";
  if (username?.trim() && password?.trim()) return { username: username.trim(), password: password.trim() };
  return null;
}

export function getHostLinuxCredentials(): { username: string; password: string } | null {
  const { getSetting } = require("./db") as { getSetting: (key: string) => string | null };
  const idStr = getSetting("host_linux_credential_id");
  if (!idStr?.trim()) return null;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return null;
  const cred = getCredentialById(id);
  if (!cred || String(cred.credential_type || "").toLowerCase() !== "linux") return null;
  const username = cred.encrypted_username ? safeDecrypt(cred.encrypted_username) : "";
  const password = cred.encrypted_password ? safeDecrypt(cred.encrypted_password) : "";
  if (username?.trim() && password?.trim()) return { username: username.trim(), password: password.trim() };
  return null;
}

export function getCredentialLoginPair(
  credentialId: number,
  expectedType: "windows" | "linux"
): { username: string; password: string } | null {
  const cred = getCredentialById(credentialId);
  if (!cred) return null;
  const type = String(cred.credential_type || "").toLowerCase();
  if (type !== expectedType) return null;
  const username = cred.encrypted_username ? safeDecrypt(cred.encrypted_username) : "";
  const password = cred.encrypted_password ? safeDecrypt(cred.encrypted_password) : "";
  if (username?.trim() && password?.trim()) return { username: username.trim(), password: password.trim() };
  return null;
}

export function getSshLinuxCredentialPair(credentialId: number): { username: string; password: string } | null {
  const cred = getCredentialById(credentialId);
  if (!cred) return null;
  const type = String(cred.credential_type || "").toLowerCase();
  if (type !== "ssh" && type !== "linux") return null;
  const username = cred.encrypted_username ? safeDecrypt(cred.encrypted_username) : "";
  const password = cred.encrypted_password ? safeDecrypt(cred.encrypted_password) : "";
  if (username?.trim() && password?.trim()) return { username: username.trim(), password: password.trim() };
  return null;
}

export type NetworkCredentialRole = "windows" | "linux" | "ssh" | "snmp";

function credentialMatchesNetworkRole(
  credentialType: string,
  role: NetworkCredentialRole
): boolean {
  const t = credentialType.toLowerCase();
  if (role === "windows") return t === "windows";
  if (role === "linux") return t === "linux";
  if (role === "ssh") return t === "ssh";
  if (role === "snmp") return t === "snmp";
  return false;
}

export function getNetworkHostCredentialIds(networkId: number, role: NetworkCredentialRole): number[] {
  const rows = db()
    .prepare(
      `SELECT credential_id FROM network_host_credentials WHERE network_id = ? AND role = ? ORDER BY sort_order ASC, id ASC`
    )
    .all(networkId, role) as { credential_id: number }[];
  return rows.map((r) => r.credential_id);
}

export function replaceNetworkHostCredentials(
  networkId: number,
  role: NetworkCredentialRole,
  credentialIds: number[]
): void {
  const seen = new Set<number>();
  const unique: number[] = [];
  for (const id of credentialIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const c = getCredentialById(id);
    if (!c || !credentialMatchesNetworkRole(String(c.credential_type), role)) {
      throw new Error(`Credenziale #${id} non valida per ruolo ${role}`);
    }
    unique.push(id);
  }
  const d = db();
  d.transaction(() => {
    d.prepare(`DELETE FROM network_host_credentials WHERE network_id = ? AND role = ?`).run(networkId, role);
    const ins = d.prepare(
      `INSERT INTO network_host_credentials (network_id, credential_id, role, sort_order) VALUES (?,?,?,?)`
    );
    unique.forEach((cid, i) => ins.run(networkId, cid, role, i));
  })();
}

export type HostDetectCredentialRole = "windows" | "linux" | "ssh" | "snmp";

export function getHostDetectCredentialId(hostId: number, role: HostDetectCredentialRole): number | null {
  const row = db()
    .prepare(`SELECT credential_id FROM host_detect_credential WHERE host_id = ? AND role = ?`)
    .get(hostId, role) as { credential_id: number } | undefined;
  return row?.credential_id ?? null;
}

function credentialMatchesDetectRole(credentialType: string, role: HostDetectCredentialRole): boolean {
  const t = credentialType.toLowerCase();
  if (role === "windows") return t === "windows";
  if (role === "linux") return t === "linux" || t === "ssh";
  if (role === "ssh") return t === "ssh";
  if (role === "snmp") return t === "snmp";
  return false;
}

export function setHostDetectCredential(hostId: number, role: HostDetectCredentialRole, credentialId: number): void {
  const c = getCredentialById(credentialId);
  if (!c || !credentialMatchesDetectRole(String(c.credential_type), role)) return;
  db()
    .prepare(
      `INSERT INTO host_detect_credential (host_id, role, credential_id, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(host_id, role) DO UPDATE SET credential_id = excluded.credential_id, updated_at = datetime('now')`
    )
    .run(hostId, role, credentialId);
}

export function deleteHostDetectCredential(hostId: number, role: HostDetectCredentialRole): void {
  db().prepare(`DELETE FROM host_detect_credential WHERE host_id = ? AND role = ?`).run(hostId, role);
}

export function getHostDetectCredentialsEnriched(hostId: number): Array<{
  role: HostDetectCredentialRole;
  credential_id: number;
  credential_name: string;
}> {
  const rows = db()
    .prepare(`SELECT role, credential_id FROM host_detect_credential WHERE host_id = ? ORDER BY role`)
    .all(hostId) as Array<{ role: HostDetectCredentialRole; credential_id: number }>;
  return rows.map((r) => {
    const c = getCredentialById(r.credential_id);
    return {
      role: r.role,
      credential_id: r.credential_id,
      credential_name: c?.name ?? `#${r.credential_id}`,
    };
  });
}

export function getOrderedDetectCredentialIds(networkId: number, role: "windows" | "linux"): number[] {
  const { getSetting } = require("./db") as { getSetting: (key: string) => string | null };
  const netIds = getNetworkHostCredentialIds(networkId, role);
  const globalKey = role === "windows" ? "host_windows_credential_id" : "host_linux_credential_id";
  const gStr = getSetting(globalKey);
  const gId = gStr?.trim() ? parseInt(gStr, 10) : NaN;
  const out: number[] = [...netIds];
  if (!Number.isNaN(gId) && gId > 0 && !out.includes(gId)) out.push(gId);
  return out;
}

export function getOrderedSshLinuxCredentialIds(networkId: number): number[] {
  const { getSetting } = require("./db") as { getSetting: (key: string) => string | null };
  const sshIds = getNetworkHostCredentialIds(networkId, "ssh");
  const linuxIds = getNetworkHostCredentialIds(networkId, "linux");
  const out: number[] = [];
  const seen = new Set<number>();
  for (const id of [...sshIds, ...linuxIds]) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  const gStr = getSetting("host_linux_credential_id");
  const gId = gStr?.trim() ? parseInt(gStr, 10) : NaN;
  if (!Number.isNaN(gId) && gId > 0 && !seen.has(gId)) out.push(gId);
  return out;
}

export function buildSnmpCommunitiesForNetwork(networkId: number, profileOrOverride?: string | null): string[] {
  const fromCreds: string[] = [];
  for (const credId of getNetworkHostCredentialIds(networkId, "snmp")) {
    const com = getCredentialCommunityString(credId);
    if (com?.trim()) fromCreds.push(com.trim());
  }
  const net = getNetworkById(networkId);
  const pushSplit = (s: string | null | undefined, into: string[]) => {
    const t = s?.trim();
    if (!t) return;
    for (const part of t.split(",").map((x) => x.trim()).filter(Boolean)) into.push(part);
  };
  const mid: string[] = [];
  pushSplit(profileOrOverride, mid);
  pushSplit(net?.snmp_community ?? null, mid);
  const ordered = [...fromCreds, ...mid, "public", "private"];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of ordered) {
    if (!x || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

export function buildSnmpCommunitiesForHost(
  networkId: number,
  hostId: number | null,
  profileOrOverride?: string | null
): string[] {
  if (hostId != null) {
    const boundId = getHostDetectCredentialId(hostId, "snmp");
    if (boundId != null) {
      const com = getCredentialCommunityString(boundId);
      if (com?.trim()) return [com.trim()];
    }
  }
  return buildSnmpCommunitiesForNetwork(networkId, profileOrOverride);
}

// ── network_credentials v2 ──

export interface NetworkCredentialRow {
  id: number;
  network_id: number;
  credential_id: number;
  sort_order: number;
  credential_name: string;
  credential_type: string;
}

export function getNetworkCredentials(networkId: number): NetworkCredentialRow[] {
  return db()
    .prepare(
      `SELECT nc.id, nc.network_id, nc.credential_id, nc.sort_order,
              c.name AS credential_name, c.credential_type
       FROM network_credentials nc
       JOIN credentials c ON c.id = nc.credential_id
       WHERE nc.network_id = ?
       ORDER BY nc.sort_order ASC, nc.id ASC`
    )
    .all(networkId) as NetworkCredentialRow[];
}

export function replaceNetworkCredentials(networkId: number, credentialIds: number[]): void {
  const seen = new Set<number>();
  const unique: number[] = [];
  for (const id of credentialIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  const d = db();
  d.transaction(() => {
    d.prepare(`DELETE FROM network_credentials WHERE network_id = ?`).run(networkId);
    const ins = d.prepare(
      `INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, ?)`
    );
    unique.forEach((cid, i) => ins.run(networkId, cid, i));
  })();
}

export function addNetworkCredential(networkId: number, credentialId: number): void {
  const d = db();
  const max = d.prepare(
    `SELECT COALESCE(MAX(sort_order), -1) AS m FROM network_credentials WHERE network_id = ?`
  ).get(networkId) as { m: number };
  d.prepare(
    `INSERT OR IGNORE INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, ?)`
  ).run(networkId, credentialId, max.m + 1);
}

export function removeNetworkCredential(networkId: number, credentialId: number): void {
  db().prepare(
    `DELETE FROM network_credentials WHERE network_id = ? AND credential_id = ?`
  ).run(networkId, credentialId);
}

export function reorderNetworkCredentials(networkId: number, orderedCredentialIds: number[]): void {
  const d = db();
  d.transaction(() => {
    const upd = d.prepare(
      `UPDATE network_credentials SET sort_order = ? WHERE network_id = ? AND credential_id = ?`
    );
    orderedCredentialIds.forEach((cid, i) => upd.run(i, networkId, cid));
  })();
}

export function copyNetworkCredentials(sourceNetworkId: number, targetNetworkId: number): number {
  const d = db();
  const source = getNetworkCredentials(sourceNetworkId);
  const existing = new Set(
    getNetworkCredentials(targetNetworkId).map((r) => r.credential_id)
  );
  const max = d.prepare(
    `SELECT COALESCE(MAX(sort_order), -1) AS m FROM network_credentials WHERE network_id = ?`
  ).get(targetNetworkId) as { m: number };
  let order = max.m + 1;
  let added = 0;
  const ins = d.prepare(
    `INSERT OR IGNORE INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, ?)`
  );
  d.transaction(() => {
    for (const s of source) {
      if (existing.has(s.credential_id)) continue;
      ins.run(targetNetworkId, s.credential_id, order++);
      added++;
    }
  })();
  return added;
}

export function getNetworksWithCredentials(): Array<{ id: number; name: string; cidr: string; credential_count: number }> {
  return db()
    .prepare(
      `SELECT n.id, n.name, n.cidr, COUNT(nc.id) AS credential_count
       FROM networks n
       JOIN network_credentials nc ON nc.network_id = n.id
       GROUP BY n.id
       HAVING credential_count > 0
       ORDER BY n.name`
    )
    .all() as Array<{ id: number; name: string; cidr: string; credential_count: number }>;
}

// ── host_credentials ──

export interface HostCredentialRow {
  id: number;
  host_id: number;
  credential_id: number;
  protocol_type: "ssh" | "snmp" | "winrm" | "api";
  port: number;
  validated: number;
  validated_at: string | null;
  sort_order: number;
  auto_detected: number;
  created_at: string;
  credential_name: string;
  credential_type: string;
}

export function getHostCredentials(hostId: number): HostCredentialRow[] {
  return db()
    .prepare(
      `SELECT hc.*, c.name AS credential_name, c.credential_type
       FROM host_credentials hc
       JOIN credentials c ON c.id = hc.credential_id
       WHERE hc.host_id = ?
       ORDER BY hc.sort_order ASC, hc.id ASC`
    )
    .all(hostId) as HostCredentialRow[];
}

export function getHostValidatedProtocolsByNetwork(networkId: number): Map<number, string[]> {
  const rows = db()
    .prepare(
      `SELECT hc.host_id, hc.protocol_type
       FROM host_credentials hc
       JOIN hosts h ON h.id = hc.host_id
       WHERE h.network_id = ? AND hc.validated = 1
       ORDER BY hc.host_id, hc.protocol_type`
    )
    .all(networkId) as Array<{ host_id: number; protocol_type: string }>;
  const map = new Map<number, string[]>();
  for (const r of rows) {
    const arr = map.get(r.host_id) || [];
    if (!arr.includes(r.protocol_type)) arr.push(r.protocol_type);
    map.set(r.host_id, arr);
  }
  return map;
}

/** Mappa batch: per TUTTI gli host, i protocol_type validati. Per pagina Discovery. */
export function getAllHostValidatedProtocols(): Map<number, string[]> {
  const rows = db()
    .prepare(
      `SELECT hc.host_id, hc.protocol_type
       FROM host_credentials hc
       WHERE hc.validated = 1
       ORDER BY hc.host_id, hc.protocol_type`
    )
    .all() as Array<{ host_id: number; protocol_type: string }>;
  const map = new Map<number, string[]>();
  for (const r of rows) {
    const arr = map.get(r.host_id) || [];
    if (!arr.includes(r.protocol_type)) arr.push(r.protocol_type);
    map.set(r.host_id, arr);
  }
  return map;
}

/** Tutti i link multihomed con i peer, per la pagina Discovery. */
export function getAllMultihomedLinks(): Map<number, { group_id: string; match_type: string; peers: Array<{ ip: string; network_name: string; host_id: number }> }> {
  const rows = db().prepare(
    `SELECT ml.host_id, ml.group_id, ml.match_type
     FROM multihomed_links ml`
  ).all() as Array<{ host_id: number; group_id: string; match_type: string }>;

  const groupIds = new Set<string>();
  const hostToGroup = new Map<number, { group_id: string; match_type: string }>();
  for (const r of rows) {
    groupIds.add(r.group_id);
    hostToGroup.set(r.host_id, { group_id: r.group_id, match_type: r.match_type });
  }
  if (groupIds.size === 0) return new Map();

  const placeholders = [...groupIds].map(() => "?").join(",");
  const peers = db().prepare(
    `SELECT ml.group_id, ml.host_id, h.ip, n.name AS network_name
     FROM multihomed_links ml
     JOIN hosts h ON h.id = ml.host_id
     JOIN networks n ON n.id = h.network_id
     WHERE ml.group_id IN (${placeholders})`
  ).all(...groupIds) as Array<{ group_id: string; host_id: number; ip: string; network_name: string }>;

  const peersByGroup = new Map<string, Array<{ ip: string; network_name: string; host_id: number }>>();
  for (const p of peers) {
    const arr = peersByGroup.get(p.group_id) || [];
    arr.push({ ip: p.ip, network_name: p.network_name, host_id: p.host_id });
    peersByGroup.set(p.group_id, arr);
  }

  const result = new Map<number, { group_id: string; match_type: string; peers: Array<{ ip: string; network_name: string; host_id: number }> }>();
  for (const [hostId, { group_id, match_type }] of hostToGroup) {
    const allPeers = peersByGroup.get(group_id) || [];
    const otherPeers = allPeers.filter((p) => p.host_id !== hostId);
    if (otherPeers.length > 0) {
      result.set(hostId, { group_id, match_type, peers: otherPeers });
    }
  }
  return result;
}

export function addHostCredential(
  hostId: number,
  credentialId: number,
  protocolType: "ssh" | "snmp" | "winrm" | "api",
  port: number,
  options?: { validated?: boolean; auto_detected?: boolean }
): void {
  const d = db();
  const max = d.prepare(
    `SELECT COALESCE(MAX(sort_order), -1) AS m FROM host_credentials WHERE host_id = ?`
  ).get(hostId) as { m: number };
  d.prepare(
    `INSERT OR IGNORE INTO host_credentials (host_id, credential_id, protocol_type, port, validated, validated_at, sort_order, auto_detected)
     VALUES (?, ?, ?, ?, ?, ${options?.validated ? "datetime('now')" : "NULL"}, ?, ?)`
  ).run(
    hostId,
    credentialId,
    protocolType,
    port,
    options?.validated ? 1 : 0,
    max.m + 1,
    options?.auto_detected ? 1 : 0
  );
}

export function removeHostCredential(id: number): void {
  db().prepare(`DELETE FROM host_credentials WHERE id = ?`).run(id);
}

/** Riordina credenziali host assegnando sort_order sequenziale. */
export function reorderHostCredentials(hostId: number, bindingIds: number[]): void {
  const d = db();
  const stmt = d.prepare(`UPDATE host_credentials SET sort_order = ? WHERE id = ? AND host_id = ?`);
  d.transaction(() => {
    for (let i = 0; i < bindingIds.length; i++) {
      stmt.run(i, bindingIds[i], hostId);
    }
  })();
}

export function setHostCredentialValidated(id: number, validated: boolean): void {
  db()
    .prepare(
      `UPDATE host_credentials SET validated = ?, validated_at = ${validated ? "datetime('now')" : "NULL"} WHERE id = ?`
    )
    .run(validated ? 1 : 0, id);
}

export function getCredentialCommunityString(credentialId: number): string | null {
  const cred = getCredentialById(credentialId);
  if (!cred) return null;
  const type = String(cred.credential_type || "").toLowerCase();
  if (type !== "snmp") return null;
  const enc = cred.encrypted_password || cred.encrypted_username;
  if (!enc) return null;
  const s = safeDecrypt(enc);
  return s && s.trim() ? s : null;
}

export function getDeviceSnmpV3Credentials(device: NetworkDevice): { username: string; authKey: string } | null {
  const isSnmpPrimary = device.protocol === "snmp_v2" || device.protocol === "snmp_v3";
  const credIds = isSnmpPrimary
    ? [device.credential_id, device.snmp_credential_id]
    : [device.snmp_credential_id, device.credential_id];
  for (const credId of credIds) {
    if (!credId) continue;
    const cred = getCredentialById(credId);
    if (!cred || String(cred.credential_type || "").toLowerCase() !== "snmp") continue;
    const username = cred.encrypted_username ? safeDecrypt(cred.encrypted_username) : "";
    const authKey = cred.encrypted_password ? safeDecrypt(cred.encrypted_password) : "";
    if (username?.trim() && authKey?.trim()) return { username: username.trim(), authKey: authKey.trim() };
  }
  return null;
}

export function getEffectiveSnmpPort(_device: NetworkDevice): number {
  // SNMP usa sempre porta standard 161, indipendentemente da device.port
  return 161;
}

export function getDeviceCommunityString(device: NetworkDevice): string {
  const snmpBinding = db().prepare(`
    SELECT * FROM device_credential_bindings
    WHERE device_id = ? AND protocol_type = 'snmp'
    ORDER BY sort_order LIMIT 1
  `).get(device.id) as DeviceCredentialBinding | undefined;

  if (snmpBinding) {
    if (snmpBinding.credential_id) {
      const fromCred = getCredentialCommunityString(snmpBinding.credential_id);
      if (fromCred) return fromCred;
    } else if (snmpBinding.inline_encrypted_password) {
      const s = safeDecrypt(snmpBinding.inline_encrypted_password);
      if (s?.trim()) return s;
    }
  }

  const isSnmpPrimary = device.protocol === "snmp_v2" || device.protocol === "snmp_v3";
  const tryCredIds = isSnmpPrimary
    ? [device.credential_id, device.snmp_credential_id]
    : [device.snmp_credential_id, device.credential_id];
  for (const credId of tryCredIds) {
    if (!credId) continue;
    const fromCred = getCredentialCommunityString(credId);
    if (fromCred) return fromCred;
  }
  if (device.community_string) {
    const s = safeDecrypt(device.community_string);
    if (s && s.trim()) return s;
    if (typeof device.community_string === "string") return device.community_string;
  }
  return "public";
}

export function getDeviceCredentials(device: NetworkDevice): { username: string; password: string } | null {
  const protoType = device.protocol === "winrm" ? "winrm"
    : device.protocol === "api" ? "api"
    : "ssh";
  const binding = db().prepare(`
    SELECT * FROM device_credential_bindings
    WHERE device_id = ? AND protocol_type = ?
    ORDER BY sort_order LIMIT 1
  `).get(device.id, protoType) as DeviceCredentialBinding | undefined;

  if (binding) {
    if (binding.credential_id) {
      const cred = getCredentialById(binding.credential_id);
      if (cred?.encrypted_username && cred?.encrypted_password) {
        const u = safeDecrypt(cred.encrypted_username);
        const p = safeDecrypt(cred.encrypted_password);
        if (u && p) return { username: u, password: p };
      }
    } else if (binding.inline_username && binding.inline_encrypted_password) {
      const p = safeDecrypt(binding.inline_encrypted_password);
      if (p) return { username: binding.inline_username, password: p };
    }
  }

  if (device.credential_id) {
    const cred = getCredentialById(device.credential_id);
    if (cred?.encrypted_username && cred?.encrypted_password) {
      const u = safeDecrypt(cred.encrypted_username);
      const p = safeDecrypt(cred.encrypted_password);
      if (u && p) return { username: u, password: p };
      return null;
    }
  }
  if (device.username && device.encrypted_password) {
    const p = safeDecrypt(device.encrypted_password);
    if (p) return { username: device.username, password: p };
    return null;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// ARP ENTRIES
// ═══════════════════════════════════════════════════════════════════════════

export function upsertArpEntries(
  deviceId: number,
  entries: { mac: string; ip: string | null; interface_name: string | null }[],
  getNetworkIdForIp?: (ip: string) => number | null
): void {
  const d = db();

  const stmt = d.prepare(
    `INSERT INTO arp_entries (device_id, host_id, mac, ip, interface_name)
     VALUES (?, (SELECT id FROM hosts WHERE ${MAC_HEX("mac")} = ? LIMIT 1), ?, ?, ?)`
  );

  const replaceAll = d.transaction((items: typeof entries) => {
    d.prepare("DELETE FROM arp_entries WHERE device_id = ?").run(deviceId);

    for (const entry of items) {
      const hex = macToHex(entry.mac);
      stmt.run(deviceId, hex, entry.mac, entry.ip, entry.interface_name);
      if (entry.ip && entry.mac) {
        const networkId = getNetworkIdForIp?.(entry.ip) ?? null;
        try {
          upsertMacIpMapping({
            mac: entry.mac,
            ip: entry.ip,
            source: "arp",
            source_device_id: deviceId,
            network_id: networkId,
          });
        } catch (err) {
          // Diagnostica FK: dump valori e stato FK esistenti
          const macHex = macToHex(entry.mac);
          const existingMapping = d.prepare("SELECT source_device_id, network_id, host_id FROM mac_ip_mapping WHERE mac_normalized = ?").get(macHex) as { source_device_id: number | null; network_id: number | null; host_id: number | null } | undefined;
          const deviceOk = d.prepare("SELECT id FROM network_devices WHERE id = ?").get(deviceId);
          console.error(`[upsertArpEntries] FK error per MAC ${entry.mac} IP ${entry.ip}:`, {
            deviceId,
            deviceExists: !!deviceOk,
            networkId,
            existingMapping,
            error: err instanceof Error ? err.message : err,
          });
          // Non propagare: skippa questa entry e continua
        }
      }
    }
  });

  replaceAll(entries);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAC-IP MAPPING
// ═══════════════════════════════════════════════════════════════════════════

export type MacIpMappingSource = "arp" | "dhcp" | "host" | "switch";

export function upsertMacIpMapping(input: {
  mac: string;
  ip: string;
  source: MacIpMappingSource;
  source_device_id?: number | null;
  network_id?: number | null;
  host_id?: number | null;
  vendor?: string | null;
  hostname?: string | null;
}): void {
  const d = db();
  const hex = macToHex(input.mac);
  const display = normalizeMac(input.mac);
  const now = new Date().toISOString();

  const existing = d.prepare(
    "SELECT id, ip, last_seen FROM mac_ip_mapping WHERE mac_normalized = ?"
  ).get(hex) as { id: number; ip: string; last_seen: string } | undefined;

  if (existing) {
    const ipChanged = existing.ip !== input.ip;
    d.prepare(`
      UPDATE mac_ip_mapping SET
        ip = ?,
        source = ?,
        source_device_id = COALESCE(?, source_device_id),
        network_id = COALESCE(?, network_id),
        host_id = COALESCE(?, host_id),
        vendor = COALESCE(?, vendor),
        hostname = COALESCE(?, hostname),
        last_seen = ?,
        previous_ip = CASE WHEN ? = 1 THEN ? ELSE previous_ip END
      WHERE mac_normalized = ?
    `).run(
      input.ip,
      input.source,
      input.source_device_id ?? null,
      input.network_id ?? null,
      input.host_id ?? null,
      input.vendor ?? null,
      input.hostname ?? null,
      now,
      ipChanged ? 1 : 0,
      ipChanged ? existing.ip : null,
      hex
    );
    if (ipChanged) {
      d.prepare(
        "INSERT INTO mac_ip_history (mac_normalized, ip, source) VALUES (?, ?, ?)"
      ).run(hex, input.ip, input.source);
    }
  } else {
    d.prepare(`
      INSERT INTO mac_ip_mapping (mac_normalized, mac_display, ip, source, source_device_id, network_id, host_id, vendor, hostname, first_seen, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      hex,
      display,
      input.ip,
      input.source,
      input.source_device_id ?? null,
      input.network_id ?? null,
      input.host_id ?? null,
      input.vendor ?? null,
      input.hostname ?? null,
      now,
      now
    );
  }
}

export function getMacIpMappings(opts?: {
  network_id?: number;
  source?: MacIpMappingSource;
  q?: string;
  limit?: number;
}): import("@/types").MacIpMapping[] {
  let sql = `
    SELECT m.*, n.name as network_name, nd.name as source_device_name
    FROM mac_ip_mapping m
    LEFT JOIN networks n ON n.id = m.network_id
    LEFT JOIN network_devices nd ON nd.id = m.source_device_id
    WHERE 1=1
  `;
  const params: unknown[] = [];
  if (opts?.network_id) {
    sql += " AND m.network_id = ?";
    params.push(opts.network_id);
  }
  if (opts?.source) {
    sql += " AND m.source = ?";
    params.push(opts.source);
  }
  if (opts?.q?.trim()) {
    const q = `%${opts.q.trim()}%`;
    const qNorm = `%${opts.q.trim().replace(/[:-]/g, "")}%`;
    sql += " AND (m.mac_display LIKE ? OR m.mac_normalized LIKE ? OR m.ip LIKE ? OR m.hostname LIKE ?)";
    params.push(q, qNorm, q, q);
  }
  sql += " ORDER BY m.last_seen DESC";
  if (opts?.limit) {
    sql += " LIMIT ?";
    params.push(opts.limit);
  }
  return db().prepare(sql).all(...params) as import("@/types").MacIpMapping[];
}

export function getArpEntriesByDevice(deviceId: number): (ArpEntry & { host_ip?: string; host_name?: string })[] {
  return db().prepare(`
    SELECT ae.*, h.ip as host_ip, COALESCE(h.custom_name, h.hostname) as host_name
    FROM arp_entries ae
    LEFT JOIN hosts h ON h.id = ae.host_id
    WHERE ae.device_id = ?
    ORDER BY ae.ip
  `).all(deviceId) as (ArpEntry & { host_ip?: string; host_name?: string })[];
}

// ═══════════════════════════════════════════════════════════════════════════
// MAC PORT ENTRIES
// ═══════════════════════════════════════════════════════════════════════════

export function upsertMacPortEntries(deviceId: number, entries: { mac: string; port_name: string; vlan: number | null; port_status: "up" | "down" | null; speed: string | null }[]): void {
  const d = db();
  d.prepare("DELETE FROM mac_port_entries WHERE device_id = ?").run(deviceId);

  const stmt = d.prepare(
    `INSERT INTO mac_port_entries (device_id, mac, port_name, vlan, port_status, speed)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const insertMany = d.transaction((items: typeof entries) => {
    for (const entry of items) {
      stmt.run(deviceId, entry.mac, entry.port_name, entry.vlan, entry.port_status, entry.speed);
    }
  });

  insertMany(entries);
}

export function getMacPortEntriesByDevice(deviceId: number): (MacPortEntry & { host_ip?: string; host_name?: string })[] {
  return db().prepare(`
    SELECT mpe.*,
      COALESCE(h.ip, (SELECT ae.ip FROM arp_entries ae WHERE ${MAC_HEX("ae.mac")} = ${MAC_HEX("mpe.mac")} AND ae.ip IS NOT NULL ORDER BY ae.timestamp DESC LIMIT 1)) as host_ip,
      COALESCE(h.custom_name, h.hostname) as host_name
    FROM mac_port_entries mpe
    LEFT JOIN hosts h ON ${MAC_HEX("h.mac")} = ${MAC_HEX("mpe.mac")}
    WHERE mpe.device_id = ?
    ORDER BY mpe.port_name
  `).all(deviceId) as (MacPortEntry & { host_ip?: string; host_name?: string })[];
}

// ═══════════════════════════════════════════════════════════════════════════
// SWITCH PORTS
// ═══════════════════════════════════════════════════════════════════════════

export function upsertSwitchPorts(deviceId: number, ports: Omit<import("@/types").SwitchPort, "id" | "device_id" | "timestamp">[]): void {
  const d = db();
  d.prepare("DELETE FROM switch_ports WHERE device_id = ?").run(deviceId);

  // Valida FK prima dell'inserimento: host_id e trunk_primary_device_id potrebbero essere stale
  const hostExists = d.prepare("SELECT id FROM hosts WHERE id = ?");
  const deviceExists = d.prepare("SELECT id FROM network_devices WHERE id = ?");

  const stmt = d.prepare(
    `INSERT INTO switch_ports (device_id, port_index, port_name, status, speed, duplex, vlan, poe_status, poe_power_mw, mac_count, is_trunk, single_mac, single_mac_vendor, single_mac_ip, single_mac_hostname, host_id, trunk_neighbor_name, trunk_neighbor_port, trunk_primary_device_id, trunk_primary_name, stp_state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const insertMany = d.transaction((items: typeof ports) => {
    for (const p of items) {
      const hostId = p.host_id != null && hostExists.get(p.host_id) ? p.host_id : null;
      const trunkDeviceId = p.trunk_primary_device_id != null && deviceExists.get(p.trunk_primary_device_id) ? p.trunk_primary_device_id : null;
      stmt.run(deviceId, p.port_index, p.port_name, p.status, p.speed, p.duplex, p.vlan, p.poe_status, p.poe_power_mw, p.mac_count, p.is_trunk, p.single_mac, p.single_mac_vendor, p.single_mac_ip, p.single_mac_hostname, hostId, p.trunk_neighbor_name ?? null, p.trunk_neighbor_port ?? null, trunkDeviceId, trunkDeviceId ? (p.trunk_primary_name ?? null) : null, p.stp_state ?? null);
    }
  });

  insertMany(ports);
}

export function getSwitchPortsByDevice(deviceId: number): import("@/types").SwitchPort[] {
  return db().prepare(
    "SELECT * FROM switch_ports WHERE device_id = ? ORDER BY port_index"
  ).all(deviceId) as import("@/types").SwitchPort[];
}

// ═══════════════════════════════════════════════════════════════════════════
// DEVICE NEIGHBORS (LLDP/CDP/MNDP)
// ═══════════════════════════════════════════════════════════════════════════

export interface DbNeighborEntry {
  id: number;
  device_id: number;
  local_port: string;
  remote_device_name: string;
  remote_port: string;
  protocol: string;
  remote_ip: string | null;
  remote_mac: string | null;
  remote_platform: string | null;
  timestamp: string;
}

export function upsertNeighbors(
  deviceId: number,
  neighbors: Array<{
    localPort: string;
    remoteDevice: string;
    remotePort: string;
    protocol: string;
    remoteIp?: string;
    remoteMac?: string;
    remotePlatform?: string;
  }>
): void {
  const d = db();
  const del = d.prepare("DELETE FROM device_neighbors WHERE device_id = ?");
  const ins = d.prepare(`
    INSERT INTO device_neighbors (device_id, local_port, remote_device_name, remote_port, protocol, remote_ip, remote_mac, remote_platform)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  d.transaction(() => {
    del.run(deviceId);
    for (const n of neighbors) {
      ins.run(deviceId, n.localPort, n.remoteDevice, n.remotePort, n.protocol, n.remoteIp ?? null, n.remoteMac ?? null, n.remotePlatform ?? null);
    }
  })();
}

export function getNeighborsByDevice(deviceId: number): DbNeighborEntry[] {
  return db().prepare(
    "SELECT * FROM device_neighbors WHERE device_id = ? ORDER BY local_port, protocol"
  ).all(deviceId) as DbNeighborEntry[];
}

// ═══════════════════════════════════════════════════════════════════════════
// DEVICE ROUTES (Routing Table)
// ═══════════════════════════════════════════════════════════════════════════

export interface DbRouteEntry {
  id: number;
  device_id: number;
  destination: string;
  gateway: string | null;
  interface_name: string | null;
  protocol: string;
  metric: number | null;
  distance: number | null;
  active: number;
  timestamp: string;
}

export function upsertRoutes(
  deviceId: number,
  routes: Array<{
    destination: string;
    gateway: string | null;
    interface_name: string | null;
    protocol: string;
    metric?: number;
    distance?: number;
    active: boolean;
  }>
): void {
  const d = db();
  const del = d.prepare("DELETE FROM routing_table WHERE device_id = ?");
  const ins = d.prepare(`
    INSERT INTO routing_table (device_id, destination, gateway, interface_name, protocol, metric, distance, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  d.transaction(() => {
    del.run(deviceId);
    for (const r of routes) {
      ins.run(deviceId, r.destination, r.gateway ?? null, r.interface_name ?? null, r.protocol, r.metric ?? null, r.distance ?? null, r.active ? 1 : 0);
    }
  })();
}

export function getRoutesByDevice(deviceId: number, activeOnly = false): DbRouteEntry[] {
  const sql = activeOnly
    ? "SELECT * FROM routing_table WHERE device_id = ? AND active = 1 ORDER BY protocol, destination"
    : "SELECT * FROM routing_table WHERE device_id = ? ORDER BY active DESC, protocol, destination";
  return db().prepare(sql).all(deviceId) as DbRouteEntry[];
}

// ═══════════════════════════════════════════════════════════════════════════
// DEVICE CREDENTIAL BINDINGS
// ═══════════════════════════════════════════════════════════════════════════

export interface DeviceCredentialBinding {
  id: number;
  device_id: number;
  credential_id: number | null;
  protocol_type: "ssh" | "snmp" | "winrm" | "api";
  port: number;
  sort_order: number;
  inline_username: string | null;
  inline_encrypted_password: string | null;
  test_status: "success" | "failed" | "untested";
  test_message: string | null;
  tested_at: string | null;
  auto_detected: number;
  created_at: string;
  credential_name?: string | null;
  credential_type?: string | null;
}

export function getDeviceCredentialBindings(deviceId: number): DeviceCredentialBinding[] {
  return db().prepare(`
    SELECT dcb.*, c.name AS credential_name, c.credential_type
    FROM device_credential_bindings dcb
    LEFT JOIN credentials c ON c.id = dcb.credential_id
    WHERE dcb.device_id = ?
    ORDER BY dcb.sort_order, dcb.id
  `).all(deviceId) as DeviceCredentialBinding[];
}

/** Protocolli credenziali con test_status='success' per tutti i device (batch, no N+1) */
export function getDeviceCredentialProtocolsSummary(): Map<number, string[]> {
  const rows = db().prepare(
    `SELECT device_id, protocol_type
     FROM device_credential_bindings
     WHERE test_status = 'success'
     GROUP BY device_id, protocol_type
     ORDER BY device_id`
  ).all() as Array<{ device_id: number; protocol_type: string }>;
  const map = new Map<number, string[]>();
  for (const r of rows) {
    const arr = map.get(r.device_id) || [];
    arr.push(r.protocol_type);
    map.set(r.device_id, arr);
  }
  return map;
}

export function addDeviceCredentialBinding(input: {
  device_id: number;
  credential_id?: number | null;
  protocol_type: string;
  port: number;
  sort_order?: number;
  inline_username?: string | null;
  inline_encrypted_password?: string | null;
  auto_detected?: boolean;
}): DeviceCredentialBinding {
  const d = db();
  const maxOrder = (d.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) as m FROM device_credential_bindings WHERE device_id = ?"
  ).get(input.device_id) as { m: number }).m;
  const sortOrder = input.sort_order ?? maxOrder + 1;

  const result = d.prepare(`
    INSERT INTO device_credential_bindings
      (device_id, credential_id, protocol_type, port, sort_order, inline_username, inline_encrypted_password, auto_detected)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.device_id,
    input.credential_id ?? null,
    input.protocol_type,
    input.port,
    sortOrder,
    input.inline_username ?? null,
    input.inline_encrypted_password ?? null,
    input.auto_detected ? 1 : 0
  );

  return d.prepare(`
    SELECT dcb.*, c.name AS credential_name, c.credential_type
    FROM device_credential_bindings dcb
    LEFT JOIN credentials c ON c.id = dcb.credential_id
    WHERE dcb.id = ?
  `).get(result.lastInsertRowid) as DeviceCredentialBinding;
}

export function updateDeviceCredentialBinding(bindingId: number, updates: {
  credential_id?: number | null;
  protocol_type?: string;
  port?: number;
  inline_username?: string | null;
  inline_encrypted_password?: string | null;
}): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (updates.credential_id !== undefined) { sets.push("credential_id = ?"); params.push(updates.credential_id); }
  if (updates.protocol_type !== undefined) { sets.push("protocol_type = ?"); params.push(updates.protocol_type); }
  if (updates.port !== undefined) { sets.push("port = ?"); params.push(updates.port); }
  if (updates.inline_username !== undefined) { sets.push("inline_username = ?"); params.push(updates.inline_username); }
  if (updates.inline_encrypted_password !== undefined) { sets.push("inline_encrypted_password = ?"); params.push(updates.inline_encrypted_password); }
  if (sets.length === 0) return;
  if (updates.credential_id != null) {
    sets.push("inline_username = NULL", "inline_encrypted_password = NULL");
  } else if (updates.inline_username !== undefined || updates.inline_encrypted_password !== undefined) {
    sets.push("credential_id = NULL");
  }
  params.push(bindingId);
  db().prepare(`UPDATE device_credential_bindings SET ${sets.join(", ")} WHERE id = ?`).run(...params);
}

export function deleteDeviceCredentialBinding(bindingId: number): void {
  db().prepare("DELETE FROM device_credential_bindings WHERE id = ?").run(bindingId);
}

export function reorderDeviceCredentialBindings(deviceId: number, orderedIds: number[]): void {
  const d = db();
  const stmt = d.prepare("UPDATE device_credential_bindings SET sort_order = ? WHERE id = ? AND device_id = ?");
  d.transaction(() => {
    for (let i = 0; i < orderedIds.length; i++) {
      stmt.run(i, orderedIds[i], deviceId);
    }
  })();
}

export function updateBindingTestStatus(bindingId: number, status: "success" | "failed", message: string): void {
  db().prepare(`
    UPDATE device_credential_bindings SET test_status = ?, test_message = ?, tested_at = datetime('now') WHERE id = ?
  `).run(status, message, bindingId);
}

export function findExistingBinding(deviceId: number, credentialId: number, protocolType: string, port: number): DeviceCredentialBinding | null {
  return db().prepare(`
    SELECT dcb.*, c.name AS credential_name, c.credential_type
    FROM device_credential_bindings dcb
    LEFT JOIN credentials c ON c.id = dcb.credential_id
    WHERE dcb.device_id = ? AND dcb.credential_id = ? AND dcb.protocol_type = ? AND dcb.port = ?
  `).get(deviceId, credentialId, protocolType, port) as DeviceCredentialBinding | null;
}

export function getPrimaryBindingForProtocol(deviceId: number, protocolType: string): DeviceCredentialBinding | null {
  return db().prepare(`
    SELECT dcb.*, c.name AS credential_name, c.credential_type
    FROM device_credential_bindings dcb
    LEFT JOIN credentials c ON c.id = dcb.credential_id
    WHERE dcb.device_id = ? AND dcb.protocol_type = ? AND dcb.test_status = 'success'
    ORDER BY dcb.sort_order LIMIT 1
  `).get(deviceId, protocolType) as DeviceCredentialBinding | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHEDULED JOBS
// ═══════════════════════════════════════════════════════════════════════════

export function getScheduledJobs(): ScheduledJob[] {
  return db().prepare("SELECT * FROM scheduled_jobs ORDER BY id").all() as ScheduledJob[];
}

export function getEnabledJobs(): ScheduledJob[] {
  return db().prepare("SELECT * FROM scheduled_jobs WHERE enabled = 1").all() as ScheduledJob[];
}

export function createScheduledJob(input: ScheduledJobInput): ScheduledJob {
  const stmt = db().prepare(
    `INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, config, next_run)
     VALUES (?, ?, ?, ?, datetime('now', '+' || ? || ' minutes'))`
  );
  const result = stmt.run(
    input.network_id || null,
    input.job_type,
    input.interval_minutes,
    JSON.stringify(input.config || {}),
    input.interval_minutes
  );
  return db().prepare("SELECT * FROM scheduled_jobs WHERE id = ?").get(result.lastInsertRowid) as ScheduledJob;
}

export function updateJobLastRun(id: number): void {
  const job = db().prepare("SELECT interval_minutes FROM scheduled_jobs WHERE id = ?").get(id) as { interval_minutes: number } | undefined;
  if (!job) return;
  db().prepare(
    `UPDATE scheduled_jobs SET last_run = datetime('now'), next_run = datetime('now', '+' || ? || ' minutes'), updated_at = datetime('now') WHERE id = ?`
  ).run(job.interval_minutes, id);
}

export function toggleJob(id: number, enabled: boolean): void {
  db().prepare("UPDATE scheduled_jobs SET enabled = ?, updated_at = datetime('now') WHERE id = ?").run(enabled ? 1 : 0, id);
}

export function deleteScheduledJob(id: number): boolean {
  return db().prepare("DELETE FROM scheduled_jobs WHERE id = ?").run(id).changes > 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// STATUS HISTORY
// ═══════════════════════════════════════════════════════════════════════════

export function addStatusHistory(hostId: number, status: "online" | "offline", responseTimeMs?: number | null): void {
  db().prepare(
    "INSERT INTO status_history (host_id, status, response_time_ms) VALUES (?, ?, ?)"
  ).run(hostId, status, responseTimeMs ?? null);
}

export function getStatusHistory(hostId: number, limit: number = 100): StatusHistory[] {
  return db().prepare(
    "SELECT * FROM status_history WHERE host_id = ? ORDER BY checked_at DESC LIMIT ?"
  ).all(hostId, limit) as StatusHistory[];
}

export function getHostLatencyHistory(hostId: number, hours: number = 24): { time: string; response_time_ms: number | null; status: string }[] {
  return db().prepare(`
    SELECT strftime('%Y-%m-%dT%H:%M:00', checked_at) as time, response_time_ms, status
    FROM status_history
    WHERE host_id = ? AND checked_at >= datetime('now', '-' || ? || ' hours')
    ORDER BY checked_at ASC
  `).all(hostId, hours) as { time: string; response_time_ms: number | null; status: string }[];
}

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD / STATS
// ═══════════════════════════════════════════════════════════════════════════

export function getKnownHostStats(): { total: number; online: number; offline: number; avg_latency: number | null } {
  return db().prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) as online,
      SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END) as offline,
      AVG(last_response_time_ms) as avg_latency
    FROM hosts WHERE known_host = 1
  `).get() as { total: number; online: number; offline: number; avg_latency: number | null };
}

export function getOfflineKnownHosts(): { id: number; ip: string; hostname: string | null; custom_name: string | null; last_seen: string | null }[] {
  return db().prepare(`
    SELECT id, ip, hostname, custom_name, last_seen
    FROM hosts WHERE known_host = 1 AND status = 'offline'
    ORDER BY last_seen DESC LIMIT 20
  `).all() as { id: number; ip: string; hostname: string | null; custom_name: string | null; last_seen: string | null }[];
}

export function getDashboardStats(): {
  total_networks: number;
  total_hosts: number;
  online_hosts: number;
  offline_hosts: number;
  unknown_hosts: number;
} {
  const row = db().prepare(`
    SELECT
      (SELECT COUNT(*) FROM networks) as total_networks,
      (SELECT COUNT(*) FROM hosts) as total_hosts,
      (SELECT COUNT(*) FROM hosts WHERE status = 'online') as online_hosts,
      (SELECT COUNT(*) FROM hosts WHERE status = 'offline') as offline_hosts,
      (SELECT COUNT(*) FROM hosts WHERE status = 'unknown') as unknown_hosts
  `).get() as {
    total_networks: number;
    total_hosts: number;
    online_hosts: number;
    offline_hosts: number;
    unknown_hosts: number;
  };
  return row;
}

export function getRecentActivity(limit: number = 10): ScanHistory[] {
  return db().prepare(
    "SELECT * FROM scan_history ORDER BY timestamp DESC LIMIT ?"
  ).all(limit) as ScanHistory[];
}

export function cleanupStaleHosts(daysUntilStale: number, daysUntilDelete: number): { flagged: number; deleted: number } {
  const flagged = db().prepare(
    `UPDATE hosts SET classification = 'stale', updated_at = datetime('now')
     WHERE status = 'offline' AND last_seen < datetime('now', '-' || ? || ' days')
     AND classification != 'stale'`
  ).run(daysUntilStale);

  const deleted = db().prepare(
    `DELETE FROM hosts
     WHERE classification = 'stale' AND last_seen < datetime('now', '-' || ? || ' days')`
  ).run(daysUntilDelete);

  return { flagged: flagged.changes, deleted: deleted.changes };
}

export function globalSearch(query: string, limit: number = 20): {
  hosts: Host[];
  networks: Network[];
} {
  const like = `%${query}%`;
  const hosts = db().prepare(`
    SELECT * FROM hosts
    WHERE ip LIKE ? OR mac LIKE ? OR hostname LIKE ? OR custom_name LIKE ?
      OR dns_forward LIKE ? OR dns_reverse LIKE ? OR notes LIKE ? OR vendor LIKE ?
    LIMIT ?
  `).all(like, like, like, like, like, like, like, like, limit) as Host[];
  hosts.sort((a, b) => ipToNum(a.ip) - ipToNum(b.ip));

  const networks = db().prepare(`
    SELECT * FROM networks
    WHERE cidr LIKE ? OR name LIKE ? OR description LIKE ? OR location LIKE ?
    ORDER BY name ASC
    LIMIT ?
  `).all(like, like, like, like, limit) as Network[];

  return { hosts, networks };
}

export function getOnlineCountsOverTime(
  hours: number = 24
): { time: string; online: number; offline: number }[] {
  return db().prepare(`
    SELECT
      strftime('%Y-%m-%dT%H:00:00', checked_at) as time,
      SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) as online,
      SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END) as offline
    FROM status_history
    WHERE checked_at >= datetime('now', '-' || ? || ' hours')
    GROUP BY strftime('%Y-%m-%dT%H:00:00', checked_at)
    ORDER BY time ASC
  `).all(hours) as { time: string; online: number; offline: number }[];
}

// ═══════════════════════════════════════════════════════════════════════════
// INVENTORY ASSETS
// ═══════════════════════════════════════════════════════════════════════════

const INVENTORY_COLUMNS = [
  "asset_id", "asset_tag", "serial_number", "network_device_id", "host_id", "hostname", "nome_prodotto",
  "categoria", "marca", "modello", "part_number", "sede", "reparto", "utente_assegnatario_id", "asset_assignee_id", "location_id", "posizione_fisica",
  "data_assegnazione", "data_acquisto", "data_installazione", "data_dismissione", "stato", "fine_garanzia",
  "fine_supporto", "vita_utile_prevista", "sistema_operativo", "versione_os", "cpu", "ram_gb", "storage_gb",
  "storage_tipo", "mac_address", "ip_address", "vlan", "firmware_version", "prezzo_acquisto", "fornitore",
  "numero_ordine", "numero_fattura", "valore_attuale", "metodo_ammortamento", "centro_di_costo",
  "crittografia_disco", "antivirus", "gestito_da_mdr", "classificazione_dati", "in_scope_gdpr", "in_scope_nis2",
  "ultimo_audit", "contratto_supporto", "tipo_garanzia", "contatto_supporto", "ultimo_intervento",
  "prossima_manutenzione", "note_tecniche", "technical_data",
];

export function getInventoryAssetById(id: number): import("@/types").InventoryAsset | undefined {
  return db().prepare("SELECT * FROM inventory_assets WHERE id = ?").get(id) as import("@/types").InventoryAsset | undefined;
}

export function getInventoryAssetByNetworkDevice(deviceId: number): import("@/types").InventoryAsset | undefined {
  return db().prepare("SELECT * FROM inventory_assets WHERE network_device_id = ?").get(deviceId) as import("@/types").InventoryAsset | undefined;
}

export function getDeviceIdsWithInventoryAsset(): Set<number> {
  const rows = db().prepare("SELECT network_device_id FROM inventory_assets WHERE network_device_id IS NOT NULL").all() as { network_device_id: number }[];
  return new Set(rows.map((r) => r.network_device_id));
}

function mapClassificationToInventoryCategoria(classification: string | null, deviceType: string): import("@/types").InventoryAssetCategoria | null {
  const c = (classification ?? deviceType ?? "").toLowerCase();
  if (["firewall"].includes(c)) return "Firewall";
  if (["access_point"].includes(c)) return "Access Point";
  if (["router", "load_balancer", "vpn_gateway"].includes(c)) return "Router";
  if (["switch"].includes(c)) return "Switch";
  if (["server", "hypervisor"].includes(c)) return "Server";
  if (["nas", "nas_synology", "nas_qnap", "storage"].includes(c)) return "NAS";
  if (["stampante", "scanner", "fotocopiatrice", "multifunzione"].includes(c)) return "Stampante";
  return deviceType === "router" ? "Router" : "Switch";
}

function mapVendorToMarca(vendor: string): string | null {
  const v = vendor?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    mikrotik: "MikroTik", ubiquiti: "Ubiquiti", hp: "HP", cisco: "Cisco",
    omada: "TP-Link", stormshield: "Stormshield", proxmox: "Proxmox",
    vmware: "VMware", linux: "Linux", windows: "Windows",
  };
  return map[v] ?? null;
}

function mapHostClassificationToInventoryCategoria(classification: string | null): import("@/types").InventoryAssetCategoria | null {
  const c = (classification ?? "").toLowerCase();
  if (["workstation", "desktop", "pc"].includes(c)) return "Desktop";
  if (["notebook", "laptop"].includes(c)) return "Laptop";
  if (["vm"].includes(c)) return "VM";
  if (["server", "hypervisor", "web_server", "database_server", "mail_server", "backup_server", "nfs_server"].includes(c)) return "Server";
  if (["switch"].includes(c)) return "Switch";
  if (["router", "load_balancer", "vpn_gateway"].includes(c)) return "Router";
  if (["firewall"].includes(c)) return "Firewall";
  if (["access_point"].includes(c)) return "Access Point";
  if (["nas", "nas_synology", "nas_qnap", "storage"].includes(c)) return "NAS";
  if (["stampante", "scanner", "fotocopiatrice", "multifunzione"].includes(c)) return "Stampante";
  if (["iot", "smart_tv", "telecamera", "voip", "phone"].includes(c)) return "Other";
  return null;
}

function extractProxmoxTechData(
  lastResult: string | null
): Partial<import("@/types").InventoryAssetInput> & { technical_data?: string } {
  const out: Partial<import("@/types").InventoryAssetInput> & { technical_data?: string } = {};
  if (!lastResult?.trim()) return out;
  try {
    const parsed = JSON.parse(lastResult) as {
      hosts?: Array<{
        hostname?: string; cpu_model?: string; cpu_mhz?: number; cpu_sockets?: number; cpu_cores?: number;
        memory_total_gb?: number; proxmox_version?: string; kernel_version?: string; rootfs_total_gb?: number;
        hardware_serial?: string; hardware_model?: string; hardware_manufacturer?: string;
        storage?: Array<{ total_gb?: number; used_gb?: number; type?: string }>;
      }>;
    };
    out.technical_data = lastResult;
    const host = parsed?.hosts?.[0];
    if (!host) return out;
    if (host.cpu_model) {
      const parts = [host.cpu_model];
      if (host.cpu_mhz) parts.push(`${host.cpu_mhz} MHz`);
      if (host.cpu_sockets != null) parts.push(`${host.cpu_sockets} socket`);
      if (host.cpu_cores != null) parts.push(`${host.cpu_cores} core`);
      out.cpu = parts.join(", ");
    }
    if (host.memory_total_gb != null) out.ram_gb = Math.round(host.memory_total_gb);
    if (host.proxmox_version) out.firmware_version = host.proxmox_version;
    if (host.kernel_version) out.versione_os = host.kernel_version;
    if (host.hardware_serial) out.serial_number = host.hardware_serial;
    if (host.hardware_model) out.modello = host.hardware_model;
    if (host.hardware_manufacturer) out.marca = host.hardware_manufacturer;
    if (host.rootfs_total_gb != null) {
      const storageTotal = host.storage?.reduce((s, st) => s + (st.total_gb ?? 0), 0) ?? 0;
      out.storage_gb = Math.round(Math.max(host.rootfs_total_gb, storageTotal));
    }
    out.sistema_operativo = "Proxmox VE";
  } catch { /* ignore */ }
  return out;
}

export function ensureInventoryAssetForNetworkDevice(device: NetworkDevice): import("@/types").InventoryAsset {
  const existing = getInventoryAssetByNetworkDevice(device.id);
  if (existing) return existing;
  const categoria = mapClassificationToInventoryCategoria(device.classification, device.device_type);
  const marca = mapVendorToMarca(device.vendor);
  return createInventoryAsset({
    network_device_id: device.id, hostname: device.name, nome_prodotto: device.name,
    categoria, marca, modello: device.model ?? null, serial_number: device.serial_number ?? null,
    ip_address: device.host, firmware_version: device.firmware ?? null, stato: "Attivo",
  });
}

export function syncInventoryFromDevice(device: NetworkDevice): import("@/types").InventoryAsset | null {
  const asset = getInventoryAssetByNetworkDevice(device.id);
  if (!asset) return null;
  const marca = mapVendorToMarca(device.vendor);
  const categoria = mapClassificationToInventoryCategoria(device.classification, device.device_type);
  const base: Partial<import("@/types").InventoryAssetInput> = {
    hostname: device.name, nome_prodotto: device.name,
    categoria: categoria ?? asset.categoria, marca: marca ?? asset.marca,
    modello: device.model ?? asset.modello, serial_number: device.serial_number ?? asset.serial_number,
    part_number: device.part_number ?? asset.part_number, ip_address: device.host,
    firmware_version: device.firmware ?? asset.firmware_version,
  };
  const dev = device as { last_proxmox_scan_result?: string | null };
  const proxmox = extractProxmoxTechData(dev.last_proxmox_scan_result ?? null);
  let technicalData = proxmox.technical_data;
  if (!technicalData && (device.sysname || device.sysdescr || device.model || device.firmware)) {
    technicalData = JSON.stringify({
      source: "device", sysname: device.sysname, sysdescr: device.sysdescr,
      model: device.model, firmware: device.firmware, serial_number: device.serial_number,
      part_number: device.part_number, last_info_update: (device as { last_info_update?: string | null }).last_info_update,
    });
  }
  const merged: import("@/types").InventoryAssetInput = { ...base, ...proxmox, technical_data: technicalData ?? undefined };
  return updateInventoryAsset(asset.id, merged) ?? null;
}

export function getInventoryAssetByHost(hostId: number): import("@/types").InventoryAsset | undefined {
  return db().prepare("SELECT * FROM inventory_assets WHERE host_id = ?").get(hostId) as import("@/types").InventoryAsset | undefined;
}

export function getHostIdsWithInventoryAsset(): Set<number> {
  const rows = db().prepare("SELECT host_id FROM inventory_assets WHERE host_id IS NOT NULL").all() as { host_id: number }[];
  return new Set(rows.map((r) => r.host_id));
}

export function ensureInventoryAssetForHost(host: Host): import("@/types").InventoryAsset {
  const existing = getInventoryAssetByHost(host.id);
  if (existing) return existing;
  const categoria = mapHostClassificationToInventoryCategoria(host.classification ?? null);
  return createInventoryAsset({
    host_id: host.id, hostname: host.custom_name ?? host.hostname ?? host.ip,
    nome_prodotto: host.model ?? host.hostname ?? host.ip, categoria: categoria ?? "Other",
    marca: host.vendor ?? null, modello: host.model ?? null, serial_number: host.serial_number ?? null,
    ip_address: host.ip, mac_address: host.mac ?? null, sistema_operativo: host.os_info ?? null, stato: "Attivo",
  });
}

export function syncInventoryFromHost(host: Host): import("@/types").InventoryAsset | null {
  const asset = getInventoryAssetByHost(host.id);
  if (!asset) return null;
  const categoria = mapHostClassificationToInventoryCategoria(host.classification ?? null) ?? asset.categoria;
  const merged: import("@/types").InventoryAssetInput = {
    hostname: host.custom_name ?? host.hostname ?? host.ip,
    nome_prodotto: host.model ?? host.hostname ?? asset.nome_prodotto,
    categoria, marca: host.vendor ?? asset.marca, modello: host.model ?? asset.modello,
    serial_number: host.serial_number ?? asset.serial_number, ip_address: host.ip,
    mac_address: host.mac ?? asset.mac_address, sistema_operativo: host.os_info ?? asset.sistema_operativo,
  };
  return updateInventoryAsset(asset.id, merged) ?? null;
}

export function getInventoryAssets(opts?: {
  network_device_id?: number; host_id?: number; stato?: string; categoria?: string; q?: string; limit?: number;
}): (import("@/types").InventoryAsset & { network_device_name?: string; host_ip?: string })[] {
  let sql = `
    SELECT a.*, nd.name as network_device_name, h.ip as host_ip
    FROM inventory_assets a
    LEFT JOIN network_devices nd ON nd.id = a.network_device_id
    LEFT JOIN hosts h ON h.id = a.host_id
    WHERE 1=1
  `;
  const params: unknown[] = [];
  if (opts?.network_device_id) { sql += " AND a.network_device_id = ?"; params.push(opts.network_device_id); }
  if (opts?.host_id) { sql += " AND a.host_id = ?"; params.push(opts.host_id); }
  if (opts?.stato) { sql += " AND a.stato = ?"; params.push(opts.stato); }
  if (opts?.categoria) { sql += " AND a.categoria = ?"; params.push(opts.categoria); }
  if (opts?.q?.trim()) {
    const q = `%${opts.q.trim()}%`;
    sql += " AND (a.asset_tag LIKE ? OR a.serial_number LIKE ? OR a.hostname LIKE ? OR a.nome_prodotto LIKE ? OR a.marca LIKE ? OR a.modello LIKE ?)";
    params.push(q, q, q, q, q, q);
  }
  sql += " ORDER BY a.updated_at DESC";
  if (opts?.limit) { sql += " LIMIT ?"; params.push(opts.limit); }
  return db().prepare(sql).all(...params) as (import("@/types").InventoryAsset & { network_device_name?: string; host_ip?: string })[];
}

export function createInventoryAsset(input: import("@/types").InventoryAssetInput): import("@/types").InventoryAsset {
  const assetId = randomUUID();
  const cols = ["asset_id", ...INVENTORY_COLUMNS.slice(1)];
  const placeholders = cols.map(() => "?").join(", ");
  const values = [
    assetId, input.asset_tag ?? null, input.serial_number ?? null,
    input.network_device_id ?? null, input.host_id ?? null, input.hostname ?? null,
    input.nome_prodotto ?? null, input.categoria ?? null, input.marca ?? null,
    input.modello ?? null, input.part_number ?? null, input.sede ?? null, input.reparto ?? null,
    input.utente_assegnatario_id ?? null, input.asset_assignee_id ?? null, input.location_id ?? null,
    input.posizione_fisica ?? null, input.data_assegnazione ?? null, input.data_acquisto ?? null,
    input.data_installazione ?? null, input.data_dismissione ?? null, input.stato ?? null,
    input.fine_garanzia ?? null, input.fine_supporto ?? null, input.vita_utile_prevista ?? null,
    input.sistema_operativo ?? null, input.versione_os ?? null, input.cpu ?? null, input.ram_gb ?? null,
    input.storage_gb ?? null, input.storage_tipo ?? null, input.mac_address ?? null, input.ip_address ?? null,
    input.vlan ?? null, input.firmware_version ?? null, input.prezzo_acquisto ?? null, input.fornitore ?? null,
    input.numero_ordine ?? null, input.numero_fattura ?? null, input.valore_attuale ?? null,
    input.metodo_ammortamento ?? null, input.centro_di_costo ?? null, input.crittografia_disco ?? 0,
    input.antivirus ?? null, input.gestito_da_mdr ?? 0, input.classificazione_dati ?? null,
    input.in_scope_gdpr ?? 0, input.in_scope_nis2 ?? 0, input.ultimo_audit ?? null,
    input.contratto_supporto ?? null, input.tipo_garanzia ?? null, input.contatto_supporto ?? null,
    input.ultimo_intervento ?? null, input.prossima_manutenzione ?? null, input.note_tecniche ?? null,
    input.technical_data ?? null,
  ];
  const result = db().prepare(`INSERT INTO inventory_assets (${cols.join(", ")}) VALUES (${placeholders})`).run(...values);
  return db().prepare("SELECT * FROM inventory_assets WHERE id = ?").get(result.lastInsertRowid as number) as import("@/types").InventoryAsset;
}

export function updateInventoryAsset(id: number, input: import("@/types").InventoryAssetInput, auditUserId?: number | null): import("@/types").InventoryAsset | undefined {
  const oldAsset = getInventoryAssetById(id);
  if (!oldAsset) return undefined;
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const col of INVENTORY_COLUMNS) {
    const key = col as keyof import("@/types").InventoryAssetInput;
    if (input[key] !== undefined) {
      fields.push(`${col} = ?`);
      values.push(key === "crittografia_disco" || key === "gestito_da_mdr" || key === "in_scope_gdpr" || key === "in_scope_nis2"
        ? (input[key] ? 1 : 0) : input[key]);
    }
  }
  if (fields.length === 0) return oldAsset;
  fields.push("updated_at = datetime('now')");
  values.push(id);
  db().prepare(`UPDATE inventory_assets SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  if (auditUserId != null) {
    for (const col of INVENTORY_COLUMNS) {
      const key = col as keyof import("@/types").InventoryAssetInput;
      if (input[key] !== undefined) {
        const oldVal = (oldAsset as unknown as Record<string, unknown>)[key];
        const newVal = input[key];
        const oldStr = oldVal != null ? String(oldVal) : null;
        const newStr = newVal != null ? String(newVal) : null;
        if (oldStr !== newStr) {
          db().prepare(
            "INSERT INTO inventory_audit_log (asset_id, user_id, action, field_name, old_value, new_value) VALUES (?, ?, 'update', ?, ?, ?)"
          ).run(id, auditUserId, col, oldStr, newStr);
        }
      }
    }
  }
  return getInventoryAssetById(id);
}

export function deleteInventoryAsset(id: number, auditUserId?: number | null): boolean {
  if (auditUserId != null) {
    db().prepare(
      "INSERT INTO inventory_audit_log (asset_id, user_id, action) VALUES (?, ?, 'delete')"
    ).run(id, auditUserId);
  }
  return db().prepare("DELETE FROM inventory_assets WHERE id = ?").run(id).changes > 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// ASSET ASSIGNEES
// ═══════════════════════════════════════════════════════════════════════════

export function getAssetAssignees(): import("@/types").AssetAssignee[] {
  return db().prepare("SELECT * FROM asset_assignees ORDER BY name").all() as import("@/types").AssetAssignee[];
}

export function getAssetAssigneeById(id: number): import("@/types").AssetAssignee | undefined {
  return db().prepare("SELECT * FROM asset_assignees WHERE id = ?").get(id) as import("@/types").AssetAssignee | undefined;
}

export function createAssetAssignee(input: { name: string; email?: string | null; phone?: string | null; note?: string | null }): import("@/types").AssetAssignee {
  const result = db().prepare(
    "INSERT INTO asset_assignees (name, email, phone, note) VALUES (?, ?, ?, ?)"
  ).run(input.name, input.email ?? null, input.phone ?? null, input.note ?? null);
  return db().prepare("SELECT * FROM asset_assignees WHERE id = ?").get(result.lastInsertRowid) as import("@/types").AssetAssignee;
}

export function updateAssetAssignee(id: number, input: { name?: string; email?: string | null; phone?: string | null; note?: string | null }): import("@/types").AssetAssignee | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (input.name !== undefined) { fields.push("name = ?"); values.push(input.name); }
  if (input.email !== undefined) { fields.push("email = ?"); values.push(input.email); }
  if (input.phone !== undefined) { fields.push("phone = ?"); values.push(input.phone); }
  if (input.note !== undefined) { fields.push("note = ?"); values.push(input.note); }
  if (fields.length === 0) return getAssetAssigneeById(id);
  fields.push("updated_at = datetime('now')");
  values.push(id);
  db().prepare(`UPDATE asset_assignees SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getAssetAssigneeById(id);
}

export function deleteAssetAssignee(id: number): boolean {
  return db().prepare("DELETE FROM asset_assignees WHERE id = ?").run(id).changes > 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// LOCATIONS
// ═══════════════════════════════════════════════════════════════════════════

export function getLocations(): import("@/types").Location[] {
  return db().prepare("SELECT * FROM locations ORDER BY name").all() as import("@/types").Location[];
}

export function getLocationById(id: number): import("@/types").Location | undefined {
  return db().prepare("SELECT * FROM locations WHERE id = ?").get(id) as import("@/types").Location | undefined;
}

export function createLocation(input: { name: string; parent_id?: number | null; address?: string | null }): import("@/types").Location {
  const result = db().prepare(
    "INSERT INTO locations (name, parent_id, address) VALUES (?, ?, ?)"
  ).run(input.name, input.parent_id ?? null, input.address ?? null);
  return db().prepare("SELECT * FROM locations WHERE id = ?").get(result.lastInsertRowid) as import("@/types").Location;
}

export function updateLocation(id: number, input: { name?: string; parent_id?: number | null; address?: string | null }): import("@/types").Location | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (input.name !== undefined) { fields.push("name = ?"); values.push(input.name); }
  if (input.parent_id !== undefined) { fields.push("parent_id = ?"); values.push(input.parent_id); }
  if (input.address !== undefined) { fields.push("address = ?"); values.push(input.address); }
  if (fields.length === 0) return getLocationById(id);
  fields.push("updated_at = datetime('now')");
  values.push(id);
  db().prepare(`UPDATE locations SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getLocationById(id);
}

export function deleteLocation(id: number): boolean {
  return db().prepare("DELETE FROM locations WHERE id = ?").run(id).changes > 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// LICENSES
// ═══════════════════════════════════════════════════════════════════════════

export function getLicenses(): (import("@/types").License & { used_seats?: number; free_seats?: number })[] {
  const rows = db().prepare(`
    SELECT l.*, COALESCE(ls.cnt, 0) as used_seats
    FROM licenses l
    LEFT JOIN (SELECT license_id, COUNT(*) as cnt FROM license_seats GROUP BY license_id) ls
      ON ls.license_id = l.id
    ORDER BY l.name
  `).all() as (import("@/types").License & { used_seats: number })[];
  return rows.map((row) => ({ ...row, used_seats: row.used_seats || 0, free_seats: Math.max(0, row.seats - (row.used_seats || 0)) }));
}

export function getLicenseById(id: number): (import("@/types").License & { used_seats?: number; free_seats?: number }) | undefined {
  const row = db().prepare(`
    SELECT l.*, COALESCE(ls.cnt, 0) as used_seats
    FROM licenses l
    LEFT JOIN (SELECT license_id, COUNT(*) as cnt FROM license_seats WHERE license_id = ? GROUP BY license_id) ls
      ON ls.license_id = l.id
    WHERE l.id = ?
  `).get(id, id) as (import("@/types").License & { used_seats: number }) | undefined;
  if (!row) return undefined;
  return { ...row, used_seats: row.used_seats || 0, free_seats: Math.max(0, row.seats - (row.used_seats || 0)) };
}

export function createLicense(input: {
  name: string; serial?: string | null; seats?: number; category?: string | null;
  expiration_date?: string | null; purchase_cost?: number | null; min_amt?: number;
  fornitore?: string | null; note?: string | null;
}): import("@/types").License {
  const result = db().prepare(
    "INSERT INTO licenses (name, serial, seats, category, expiration_date, purchase_cost, min_amt, fornitore, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(input.name, input.serial ?? null, input.seats ?? 1, input.category ?? null, input.expiration_date ?? null, input.purchase_cost ?? null, input.min_amt ?? 0, input.fornitore ?? null, input.note ?? null);
  return db().prepare("SELECT * FROM licenses WHERE id = ?").get(result.lastInsertRowid) as import("@/types").License;
}

export function updateLicense(id: number, input: Partial<Omit<import("@/types").License, "id" | "created_at" | "updated_at">>): import("@/types").License | undefined {
  const keys = ["name", "serial", "seats", "category", "expiration_date", "purchase_cost", "min_amt", "fornitore", "note"] as const;
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const k of keys) {
    if (input[k] !== undefined) { fields.push(`${k} = ?`); values.push(input[k]); }
  }
  if (fields.length === 0) return getLicenseById(id) as import("@/types").License | undefined;
  fields.push("updated_at = datetime('now')");
  values.push(id);
  db().prepare(`UPDATE licenses SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return db().prepare("SELECT * FROM licenses WHERE id = ?").get(id) as import("@/types").License;
}

export function deleteLicense(id: number): boolean {
  const del = db().transaction(() => {
    db().prepare("DELETE FROM license_seats WHERE license_id = ?").run(id);
    return db().prepare("DELETE FROM licenses WHERE id = ?").run(id).changes > 0;
  });
  return del();
}

export function getLicenseSeatsByLicense(licenseId: number): import("@/types").LicenseSeat[] {
  return db().prepare("SELECT * FROM license_seats WHERE license_id = ? ORDER BY assigned_at DESC").all(licenseId) as import("@/types").LicenseSeat[];
}

export function getLicenseSeatsByAsset(assetType: "inventory_asset" | "host", assetId: number): (import("@/types").LicenseSeat & { license_name?: string })[] {
  return db().prepare(`
    SELECT ls.*, l.name as license_name FROM license_seats ls
    JOIN licenses l ON l.id = ls.license_id
    WHERE ls.asset_type = ? AND ls.asset_id = ?
  `).all(assetType, assetId) as (import("@/types").LicenseSeat & { license_name?: string })[];
}

export function assignLicenseSeat(licenseId: number, assetType: "inventory_asset" | "host", assetId: number, note?: string | null): import("@/types").LicenseSeat | undefined {
  const lic = getLicenseById(licenseId);
  if (!lic || (lic.free_seats ?? 0) < 1) return undefined;
  const result = db().prepare(
    "INSERT INTO license_seats (license_id, asset_type, asset_id, note) VALUES (?, ?, ?, ?)"
  ).run(licenseId, assetType, assetId, note ?? null);
  return db().prepare("SELECT * FROM license_seats WHERE id = ?").get(result.lastInsertRowid) as import("@/types").LicenseSeat;
}

export function assignLicenseSeatToAssignee(licenseId: number, assetAssigneeId: number, note?: string | null): import("@/types").LicenseSeat | undefined {
  const lic = getLicenseById(licenseId);
  if (!lic || (lic.free_seats ?? 0) < 1) return undefined;
  const result = db().prepare(
    "INSERT INTO license_seats (license_id, asset_assignee_id, note) VALUES (?, ?, ?)"
  ).run(licenseId, assetAssigneeId, note ?? null);
  return db().prepare("SELECT * FROM license_seats WHERE id = ?").get(result.lastInsertRowid) as import("@/types").LicenseSeat;
}

export function unassignLicenseSeat(seatId: number): boolean {
  return db().prepare("DELETE FROM license_seats WHERE id = ?").run(seatId).changes > 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT LOG
// ═══════════════════════════════════════════════════════════════════════════

export function getInventoryAuditLog(assetId: number, limit = 50): import("@/types").InventoryAuditLog[] {
  return db().prepare(
    "SELECT * FROM inventory_audit_log WHERE asset_id = ? ORDER BY created_at DESC LIMIT ?"
  ).all(assetId, limit) as import("@/types").InventoryAuditLog[];
}

// ═══════════════════════════════════════════════════════════════════════════
// PROXMOX HOSTS
// ═══════════════════════════════════════════════════════════════════════════

export function getProxmoxHosts(): import("@/types").ProxmoxHost[] {
  return db().prepare("SELECT * FROM proxmox_hosts ORDER BY name").all() as import("@/types").ProxmoxHost[];
}

export function getProxmoxHostById(id: number): import("@/types").ProxmoxHost | undefined {
  return db().prepare("SELECT * FROM proxmox_hosts WHERE id = ?").get(id) as import("@/types").ProxmoxHost | undefined;
}

export function createProxmoxHost(input: { name: string; host: string; port?: number; credential_id?: number | null }): import("@/types").ProxmoxHost {
  const result = db().prepare(
    "INSERT INTO proxmox_hosts (name, host, port, credential_id) VALUES (?, ?, ?, ?)"
  ).run(input.name, input.host, input.port ?? 8006, input.credential_id ?? null);
  return db().prepare("SELECT * FROM proxmox_hosts WHERE id = ?").get(result.lastInsertRowid) as import("@/types").ProxmoxHost;
}

export function updateProxmoxHost(id: number, input: { name?: string; host?: string; port?: number; credential_id?: number | null; enabled?: number }): import("@/types").ProxmoxHost | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (input.name !== undefined) { fields.push("name = ?"); values.push(input.name); }
  if (input.host !== undefined) { fields.push("host = ?"); values.push(input.host); }
  if (input.port !== undefined) { fields.push("port = ?"); values.push(input.port); }
  if (input.credential_id !== undefined) { fields.push("credential_id = ?"); values.push(input.credential_id); }
  if (input.enabled !== undefined) { fields.push("enabled = ?"); values.push(input.enabled); }
  if (fields.length === 0) return getProxmoxHostById(id);
  fields.push("updated_at = datetime('now')");
  values.push(id);
  db().prepare(`UPDATE proxmox_hosts SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getProxmoxHostById(id);
}

export function updateProxmoxHostScanResult(id: number, resultJson: string): void {
  db().prepare(
    "UPDATE proxmox_hosts SET last_scan_at = datetime('now'), last_scan_result = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(resultJson, id);
}

export function deleteProxmoxHost(id: number): boolean {
  return db().prepare("DELETE FROM proxmox_hosts WHERE id = ?").run(id).changes > 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTIVE DIRECTORY
// ═══════════════════════════════════════════════════════════════════════════

export interface AdIntegration { id: number; name: string; dc_host: string; domain: string; base_dn: string; encrypted_username: string; encrypted_password: string; use_ssl: number; port: number; enabled: number; winrm_credential_id: number | null; dhcp_leases_count: number; last_sync_at: string | null; last_sync_status: string | null; computers_count: number; users_count: number; groups_count: number; created_at: string; updated_at: string; }
export interface AdComputer { id: number; integration_id: number; object_guid: string; sam_account_name: string; dns_host_name: string | null; display_name: string | null; distinguished_name: string; operating_system: string | null; operating_system_version: string | null; last_logon_at: string | null; enabled: number; host_id: number | null; ip_address: string | null; ou: string | null; raw_data: string | null; synced_at: string; }
export interface AdUser { id: number; integration_id: number; object_guid: string; sam_account_name: string; user_principal_name: string | null; display_name: string | null; email: string | null; department: string | null; title: string | null; phone: string | null; ou: string | null; enabled: number; last_logon_at: string | null; password_last_set_at: string | null; raw_data: string | null; synced_at: string; }
export interface AdDhcpLease { id: number; integration_id: number; scope_id: string; scope_name: string | null; ip_address: string; mac_address: string; hostname: string | null; lease_expires: string | null; address_state: string | null; description: string | null; last_synced: string; }
export interface AdGroup { id: number; integration_id: number; object_guid: string; sam_account_name: string; display_name: string | null; description: string | null; distinguished_name: string; group_type: number | null; member_guids: string | null; synced_at: string; }

export function getAdIntegrations(): AdIntegration[] {
  return db().prepare("SELECT * FROM ad_integrations ORDER BY name").all() as AdIntegration[];
}

export function getAdRealm(): { realm: string; dcHost: string } | null {
  const row = db().prepare("SELECT domain, dc_host FROM ad_integrations WHERE enabled = 1 ORDER BY id LIMIT 1").get() as { domain: string; dc_host: string } | undefined;
  if (!row) return null;
  return { realm: row.domain, dcHost: row.dc_host };
}

export function getAdIntegrationById(id: number): AdIntegration | undefined {
  return db().prepare("SELECT * FROM ad_integrations WHERE id = ?").get(id) as AdIntegration | undefined;
}

export function createAdIntegration(input: { name: string; dc_host: string; domain: string; base_dn: string; encrypted_username: string; encrypted_password: string; use_ssl?: number; port?: number; enabled?: number; winrm_credential_id?: number | null }): AdIntegration {
  const r = db().prepare(`INSERT INTO ad_integrations (name, dc_host, domain, base_dn, encrypted_username, encrypted_password, use_ssl, port, enabled, winrm_credential_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.name, input.dc_host, input.domain, input.base_dn, input.encrypted_username, input.encrypted_password, input.use_ssl ?? 1, input.port ?? 636, input.enabled ?? 1, input.winrm_credential_id ?? null);
  return getAdIntegrationById(Number(r.lastInsertRowid))!;
}

export function updateAdIntegration(id: number, input: Partial<{ name: string; dc_host: string; domain: string; base_dn: string; encrypted_username: string; encrypted_password: string; use_ssl: number; port: number; enabled: number; winrm_credential_id: number | null; dhcp_leases_count: number; last_sync_at: string | null; last_sync_status: string | null; computers_count: number; users_count: number; groups_count: number }>): AdIntegration | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined) { fields.push(`${k} = ?`); values.push(v); }
  }
  if (fields.length === 0) return getAdIntegrationById(id);
  fields.push("updated_at = datetime('now')");
  values.push(id);
  db().prepare(`UPDATE ad_integrations SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getAdIntegrationById(id);
}

export function deleteAdIntegration(id: number): boolean {
  return db().prepare("DELETE FROM ad_integrations WHERE id = ?").run(id).changes > 0;
}

export function getAdComputers(integrationId: number): AdComputer[] {
  return db().prepare("SELECT * FROM ad_computers WHERE integration_id = ? ORDER BY sam_account_name").all(integrationId) as AdComputer[];
}

export function getAdComputersPaginated(integrationId: number, page: number, pageSize: number, search?: string, activeDays?: number): { rows: AdComputer[]; total: number } {
  const offset = (page - 1) * pageSize;
  let whereClause = "WHERE integration_id = ?";
  const params: unknown[] = [integrationId];
  if (search?.trim()) { whereClause += " AND (sam_account_name LIKE ? OR dns_host_name LIKE ? OR display_name LIKE ? OR operating_system LIKE ?)"; const s = `%${search.trim()}%`; params.push(s, s, s, s); }
  if (activeDays && activeDays > 0) { whereClause += ` AND last_logon_at IS NOT NULL AND last_logon_at >= datetime('now', '-${activeDays} days')`; }
  const total = (db().prepare(`SELECT COUNT(*) as c FROM ad_computers ${whereClause}`).get(...params) as { c: number }).c;
  const rows = db().prepare(`SELECT * FROM ad_computers ${whereClause} ORDER BY sam_account_name LIMIT ? OFFSET ?`).all(...params, pageSize, offset) as AdComputer[];
  return { rows, total };
}

export function upsertAdComputer(integrationId: number, input: { object_guid: string; sam_account_name: string; dns_host_name?: string | null; display_name?: string | null; distinguished_name: string; operating_system?: string | null; operating_system_version?: string | null; last_logon_at?: string | null; enabled?: number; host_id?: number | null; ip_address?: string | null; ou?: string | null; raw_data?: string | null }): void {
  db().prepare(`INSERT INTO ad_computers (integration_id, object_guid, sam_account_name, dns_host_name, display_name, distinguished_name, operating_system, operating_system_version, last_logon_at, enabled, host_id, ip_address, ou, raw_data, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(integration_id, object_guid) DO UPDATE SET sam_account_name = excluded.sam_account_name, dns_host_name = excluded.dns_host_name, display_name = excluded.display_name, distinguished_name = excluded.distinguished_name, operating_system = excluded.operating_system, operating_system_version = excluded.operating_system_version, last_logon_at = excluded.last_logon_at, enabled = excluded.enabled, host_id = excluded.host_id, ip_address = excluded.ip_address, ou = excluded.ou, raw_data = excluded.raw_data, synced_at = datetime('now')`).run(integrationId, input.object_guid, input.sam_account_name, input.dns_host_name ?? null, input.display_name ?? null, input.distinguished_name, input.operating_system ?? null, input.operating_system_version ?? null, input.last_logon_at ?? null, input.enabled ?? 1, input.host_id ?? null, input.ip_address ?? null, input.ou ?? null, input.raw_data ?? null);
}

export function linkAdComputerToHost(integrationId: number, objectGuid: string, hostId: number): void {
  db().prepare("UPDATE ad_computers SET host_id = ? WHERE integration_id = ? AND object_guid = ?").run(hostId, integrationId, objectGuid);
}

export function relinkAdComputersForNetwork(networkId: number): { linked: number; enriched: number } {
  const d = db();
  let linked = 0;
  let enriched = 0;
  const hosts = d.prepare(`SELECT id, ip, mac, hostname, dns_forward, dns_reverse, os_info, classification FROM hosts WHERE network_id = ?`).all(networkId) as Array<{ id: number; ip: string; mac: string | null; hostname: string | null; dns_forward: string | null; dns_reverse: string | null; os_info: string | null; classification: string | null }>;
  if (hosts.length === 0) return { linked: 0, enriched: 0 };
  const unlinked = d.prepare(`SELECT ac.id, ac.integration_id, ac.object_guid, ac.dns_host_name, ac.sam_account_name, ac.ip_address, ac.operating_system, ac.host_id FROM ad_computers ac WHERE ac.host_id IS NULL OR ac.host_id IN (SELECT id FROM hosts WHERE network_id = ?)`).all(networkId) as Array<{ id: number; integration_id: number; object_guid: string; dns_host_name: string | null; sam_account_name: string; ip_address: string | null; operating_system: string | null; host_id: number | null }>;
  const hostByIp = new Map(hosts.map((h) => [h.ip, h]));
  const hostByHostname = new Map<string, typeof hosts[0]>();
  for (const h of hosts) {
    if (h.hostname) hostByHostname.set(h.hostname.toLowerCase(), h);
    if (h.dns_reverse) hostByHostname.set(h.dns_reverse.toLowerCase(), h);
    if (h.dns_forward) hostByHostname.set(h.dns_forward.toLowerCase(), h);
  }
  const linkStmt = d.prepare(`UPDATE ad_computers SET host_id = ? WHERE integration_id = ? AND object_guid = ?`);
  function enrichHost(hostId: number, comp: typeof unlinked[0], currentHost: typeof hosts[0]) {
    const adHostname = comp.dns_host_name || comp.sam_account_name.replace(/\$$/, "");
    const osRaw = comp.operating_system ?? "";
    const osLower = osRaw.toLowerCase();
    const classification = osLower.includes("server") ? "server_windows" : "workstation";
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (adHostname) { sets.push("hostname = ?", "hostname_source = 'ad'"); vals.push(adHostname); }
    if (adHostname && !currentHost.hostname) { sets.push("custom_name = CASE WHEN custom_name IS NULL OR custom_name = '' THEN ? ELSE custom_name END"); vals.push(adHostname); }
    if (osRaw && (!currentHost.os_info || currentHost.os_info === "unknown")) { sets.push("os_info = ?"); vals.push(osRaw); }
    if (!currentHost.classification || currentHost.classification === "unknown") { sets.push("classification = ?"); vals.push(classification); }
    if (sets.length > 0) { sets.push("updated_at = datetime('now')"); d.prepare(`UPDATE hosts SET ${sets.join(", ")} WHERE id = ?`).run(...vals, hostId); enriched++; }
  }
  d.transaction(() => {
    for (const comp of unlinked) {
      const dnsHostName = comp.dns_host_name?.toLowerCase() ?? "";
      const samName = comp.sam_account_name.replace(/\$$/, "").toLowerCase();
      const shortDns = dnsHostName.split(".")[0];
      let host = hostByHostname.get(dnsHostName) ?? hostByHostname.get(samName) ?? hostByHostname.get(shortDns);
      if (!host && comp.ip_address) { host = hostByIp.get(comp.ip_address); }
      if (!host) continue;
      if (comp.host_id !== host.id) { linkStmt.run(host.id, comp.integration_id, comp.object_guid); linked++; }
      enrichHost(host.id, comp, host);
    }
  })();
  return { linked, enriched };
}

const MH_HOSTNAME_BLACKLIST = new Set(["localhost", "router", "switch", "firewall", "gateway", "server", "ap", "nas", "printer", "unknown", "default", "test"]);

export function recomputeMultihomedLinks(): { groups: number; hosts_linked: number } {
  const d = db();
  const hosts = d.prepare(`SELECT h.id, h.network_id, h.ip, h.hostname, h.serial_number, h.snmp_data, h.custom_name, nd.sysname AS dev_sysname, nd.serial_number AS dev_serial, ac.dns_host_name AS ad_dns FROM hosts h LEFT JOIN network_devices nd ON nd.host = h.ip LEFT JOIN (SELECT host_id, MAX(dns_host_name) as dns_host_name FROM ad_computers WHERE host_id IS NOT NULL GROUP BY host_id) ac ON ac.host_id = h.id`).all() as Array<{ id: number; network_id: number; ip: string; hostname: string | null; serial_number: string | null; snmp_data: string | null; custom_name: string | null; dev_sysname: string | null; dev_serial: string | null; ad_dns: string | null }>;
  const buckets = new Map<string, Set<number>>();
  const hostNet = new Map<number, number>();
  const PRIORITY: Record<string, number> = { serial_number: 4, sysname: 3, hostname: 2, ad_dns: 1 };
  const hostBest = new Map<number, { type: string; value: string; priority: number }>();
  function addToBucket(key: string, hostId: number, type: string, value: string) {
    if (!buckets.has(key)) buckets.set(key, new Set());
    buckets.get(key)!.add(hostId);
    const p = PRIORITY[type] ?? 0;
    const cur = hostBest.get(hostId);
    if (!cur || p > cur.priority) hostBest.set(hostId, { type, value, priority: p });
  }
  for (const h of hosts) {
    hostNet.set(h.id, h.network_id);
    const serial = (h.serial_number || h.dev_serial || "").trim().toUpperCase();
    if (serial && serial.length >= 4) addToBucket(`serial:${serial}`, h.id, "serial_number", serial);
    let sysName = h.dev_sysname ?? null;
    if (!sysName && h.snmp_data) { try { sysName = (JSON.parse(h.snmp_data) as { sysName?: string }).sysName ?? null; } catch { /* skip */ } }
    if (sysName?.trim() && !MH_HOSTNAME_BLACKLIST.has(sysName.trim().toLowerCase())) addToBucket(`sysname:${sysName.trim().toLowerCase()}`, h.id, "sysname", sysName.trim());
    const hn = (h.hostname ?? "").trim().toLowerCase();
    if (hn && hn.length >= 3 && !MH_HOSTNAME_BLACKLIST.has(hn)) { const shortHn = hn.split(".")[0]; if (shortHn.length >= 3) addToBucket(`hostname:${shortHn}`, h.id, "hostname", h.hostname!.trim()); }
    const adDns = (h.ad_dns ?? "").trim().toLowerCase();
    if (adDns && adDns.length >= 3) { const shortAd = adDns.split(".")[0]; if (shortAd.length >= 3 && !MH_HOSTNAME_BLACKLIST.has(shortAd)) addToBucket(`ad_dns:${shortAd}`, h.id, "ad_dns", h.ad_dns!.trim()); }
  }
  const parent = new Map<number, number>();
  function find(x: number): number { if (!parent.has(x)) parent.set(x, x); if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!)); return parent.get(x)!; }
  function union(a: number, b: number) { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); }
  for (const [, hostIds] of buckets) { if (hostIds.size < 2) continue; const nets = new Set<number>(); for (const hid of hostIds) nets.add(hostNet.get(hid)!); if (nets.size < 2) continue; const arr = [...hostIds]; for (let i = 1; i < arr.length; i++) union(arr[0], arr[i]); }
  const finalGroups = new Map<number, Set<number>>();
  for (const [hid] of parent) { const root = find(hid); if (!finalGroups.has(root)) finalGroups.set(root, new Set()); finalGroups.get(root)!.add(hid); }
  let groupCount = 0;
  let totalLinked = 0;
  d.transaction(() => {
    d.prepare("DELETE FROM multihomed_links").run();
    const ins = d.prepare("INSERT OR IGNORE INTO multihomed_links (group_id, host_id, match_type, match_value) VALUES (?, ?, ?, ?)");
    for (const [, members] of finalGroups) { if (members.size < 2) continue; const nets = new Set<number>(); for (const hid of members) nets.add(hostNet.get(hid)!); if (nets.size < 2) continue; const groupId = randomUUID(); groupCount++; for (const hid of members) { const best = hostBest.get(hid); if (best) { ins.run(groupId, hid, best.type, best.value); totalLinked++; } } }
  })();
  return { groups: groupCount, hosts_linked: totalLinked };
}

export function getAdUsers(integrationId: number): AdUser[] {
  return db().prepare("SELECT * FROM ad_users WHERE integration_id = ? ORDER BY sam_account_name").all(integrationId) as AdUser[];
}

export function getAdUsersPaginated(integrationId: number, page: number, pageSize: number, search?: string, activeDays?: number): { rows: AdUser[]; total: number } {
  const offset = (page - 1) * pageSize;
  let whereClause = "WHERE integration_id = ?";
  const params: unknown[] = [integrationId];
  if (search?.trim()) { whereClause += " AND (sam_account_name LIKE ? OR user_principal_name LIKE ? OR display_name LIKE ? OR email LIKE ? OR department LIKE ?)"; const s = `%${search.trim()}%`; params.push(s, s, s, s, s); }
  if (activeDays && activeDays > 0) { whereClause += ` AND last_logon_at IS NOT NULL AND last_logon_at >= datetime('now', '-${activeDays} days')`; }
  const total = (db().prepare(`SELECT COUNT(*) as c FROM ad_users ${whereClause}`).get(...params) as { c: number }).c;
  const rows = db().prepare(`SELECT * FROM ad_users ${whereClause} ORDER BY sam_account_name LIMIT ? OFFSET ?`).all(...params, pageSize, offset) as AdUser[];
  return { rows, total };
}

export function upsertAdUser(integrationId: number, input: { object_guid: string; sam_account_name: string; user_principal_name?: string | null; display_name?: string | null; email?: string | null; department?: string | null; title?: string | null; phone?: string | null; ou?: string | null; enabled?: number; last_logon_at?: string | null; password_last_set_at?: string | null; raw_data?: string | null }): void {
  db().prepare(`INSERT INTO ad_users (integration_id, object_guid, sam_account_name, user_principal_name, display_name, email, department, title, phone, ou, enabled, last_logon_at, password_last_set_at, raw_data, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(integration_id, object_guid) DO UPDATE SET sam_account_name = excluded.sam_account_name, user_principal_name = excluded.user_principal_name, display_name = excluded.display_name, email = excluded.email, department = excluded.department, title = excluded.title, phone = excluded.phone, ou = excluded.ou, enabled = excluded.enabled, last_logon_at = excluded.last_logon_at, password_last_set_at = excluded.password_last_set_at, raw_data = excluded.raw_data, synced_at = datetime('now')`).run(integrationId, input.object_guid, input.sam_account_name, input.user_principal_name ?? null, input.display_name ?? null, input.email ?? null, input.department ?? null, input.title ?? null, input.phone ?? null, input.ou ?? null, input.enabled ?? 1, input.last_logon_at ?? null, input.password_last_set_at ?? null, input.raw_data ?? null);
}

export function getAdGroups(integrationId: number): AdGroup[] {
  return db().prepare("SELECT * FROM ad_groups WHERE integration_id = ? ORDER BY sam_account_name").all(integrationId) as AdGroup[];
}

export function getAdGroupsPaginated(integrationId: number, page: number, pageSize: number, search?: string): { rows: AdGroup[]; total: number } {
  const offset = (page - 1) * pageSize;
  let whereClause = "WHERE integration_id = ?";
  const params: unknown[] = [integrationId];
  if (search?.trim()) { whereClause += " AND (sam_account_name LIKE ? OR display_name LIKE ? OR description LIKE ?)"; const s = `%${search.trim()}%`; params.push(s, s, s); }
  const total = (db().prepare(`SELECT COUNT(*) as c FROM ad_groups ${whereClause}`).get(...params) as { c: number }).c;
  const rows = db().prepare(`SELECT * FROM ad_groups ${whereClause} ORDER BY sam_account_name LIMIT ? OFFSET ?`).all(...params, pageSize, offset) as AdGroup[];
  return { rows, total };
}

export function upsertAdGroup(integrationId: number, input: { object_guid: string; sam_account_name: string; display_name?: string | null; description?: string | null; distinguished_name: string; group_type?: number | null; member_guids?: string | null }): void {
  db().prepare(`INSERT INTO ad_groups (integration_id, object_guid, sam_account_name, display_name, description, distinguished_name, group_type, member_guids, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(integration_id, object_guid) DO UPDATE SET sam_account_name = excluded.sam_account_name, display_name = excluded.display_name, description = excluded.description, distinguished_name = excluded.distinguished_name, group_type = excluded.group_type, member_guids = excluded.member_guids, synced_at = datetime('now')`).run(integrationId, input.object_guid, input.sam_account_name, input.display_name ?? null, input.description ?? null, input.distinguished_name, input.group_type ?? null, input.member_guids ?? null);
}

export function clearAdData(integrationId: number): void {
  db().prepare("DELETE FROM ad_computers WHERE integration_id = ?").run(integrationId);
  db().prepare("DELETE FROM ad_users WHERE integration_id = ?").run(integrationId);
  db().prepare("DELETE FROM ad_groups WHERE integration_id = ?").run(integrationId);
  db().prepare("DELETE FROM ad_dhcp_leases WHERE integration_id = ?").run(integrationId);
}

export function getAdDhcpLeasesPaginated(integrationId: number, page: number, pageSize: number, search?: string): { rows: AdDhcpLease[]; total: number } {
  const offset = (page - 1) * pageSize;
  let whereClause = "WHERE integration_id = ?";
  const params: unknown[] = [integrationId];
  if (search?.trim()) { whereClause += " AND (hostname LIKE ? OR ip_address LIKE ? OR mac_address LIKE ? OR scope_id LIKE ?)"; const s = `%${search.trim()}%`; params.push(s, s, s, s); }
  const total = (db().prepare(`SELECT COUNT(*) as c FROM ad_dhcp_leases ${whereClause}`).get(...params) as { c: number }).c;
  const rows = db().prepare(`SELECT * FROM ad_dhcp_leases ${whereClause} ORDER BY ip_address LIMIT ? OFFSET ?`).all(...params, pageSize, offset) as AdDhcpLease[];
  return { rows, total };
}

export function upsertAdDhcpLease(integrationId: number, input: { scope_id: string; scope_name?: string | null; ip_address: string; mac_address: string; hostname?: string | null; lease_expires?: string | null; address_state?: string | null; description?: string | null }): void {
  const macNorm = normalizeMacForStorage(input.mac_address) ?? input.mac_address.trim();
  db().prepare(`INSERT INTO ad_dhcp_leases (integration_id, scope_id, scope_name, ip_address, mac_address, hostname, lease_expires, address_state, description, last_synced) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(integration_id, ip_address) DO UPDATE SET scope_id = excluded.scope_id, scope_name = excluded.scope_name, mac_address = excluded.mac_address, hostname = excluded.hostname, lease_expires = excluded.lease_expires, address_state = excluded.address_state, description = excluded.description, last_synced = datetime('now')`).run(integrationId, input.scope_id, input.scope_name ?? null, input.ip_address, macNorm, input.hostname ?? null, input.lease_expires ?? null, input.address_state ?? null, input.description ?? null);
}

export function clearAdDhcpLeases(integrationId: number): void {
  db().prepare("DELETE FROM ad_dhcp_leases WHERE integration_id = ?").run(integrationId);
}

// ═══════════════════════════════════════════════════════════════════════════
// DHCP LEASES
// ═══════════════════════════════════════════════════════════════════════════

export interface DhcpLease { id: number; source_type: "mikrotik" | "windows" | "cisco" | "other"; source_device_id: number | null; source_name: string | null; server_name: string | null; scope_id: string | null; scope_name: string | null; ip_address: string; mac_address: string; hostname: string | null; status: string | null; lease_start: string | null; lease_expires: string | null; description: string | null; dynamic_lease: number | null; host_id: number | null; network_id: number | null; last_synced: string; }
export interface DhcpLeaseWithRelations extends DhcpLease { host_hostname?: string | null; host_ip?: string | null; network_name?: string | null; network_cidr?: string | null; device_name?: string | null; }

export function getDhcpLeases(): DhcpLeaseWithRelations[] {
  return db().prepare(`SELECT d.*, h.hostname as host_hostname, h.ip as host_ip, n.name as network_name, n.cidr as network_cidr, nd.name as device_name FROM dhcp_leases d LEFT JOIN hosts h ON h.id = d.host_id LEFT JOIN networks n ON n.id = d.network_id LEFT JOIN network_devices nd ON nd.id = d.source_device_id ORDER BY d.last_synced DESC`).all() as DhcpLeaseWithRelations[];
}

export function getDhcpLeasesPaginated(
  page: number,
  pageSize: number,
  filters?: {
    search?: string;
    sourceType?: string;
    sourceDeviceId?: number;
    networkId?: number;
    sortKey?: string;
    sortDir?: SortDirection;
  }
): { rows: DhcpLeaseWithRelations[]; total: number } {
  const offset = (page - 1) * pageSize;
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters?.search?.trim()) { const s = `%${filters.search.trim()}%`; conditions.push("(d.ip_address LIKE ? OR d.mac_address LIKE ? OR d.hostname LIKE ?)"); params.push(s, s, s); }
  if (filters?.sourceType) { conditions.push("d.source_type = ?"); params.push(filters.sourceType); }
  if (filters?.sourceDeviceId) { conditions.push("d.source_device_id = ?"); params.push(filters.sourceDeviceId); }
  if (filters?.networkId) { conditions.push("d.network_id = ?"); params.push(filters.networkId); }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = (db().prepare(`SELECT COUNT(*) as c FROM dhcp_leases d ${whereClause}`).get(...params) as { c: number }).c;
  const orderSql = sqlOrderByDhcpLeases(filters?.sortKey, filters?.sortDir ?? "desc");
  const rows = db().prepare(`SELECT d.*, h.hostname as host_hostname, h.ip as host_ip, n.name as network_name, n.cidr as network_cidr, nd.name as device_name FROM dhcp_leases d LEFT JOIN hosts h ON h.id = d.host_id LEFT JOIN networks n ON n.id = d.network_id LEFT JOIN network_devices nd ON nd.id = d.source_device_id ${whereClause} ORDER BY ${orderSql} LIMIT ? OFFSET ?`).all(...params, pageSize, offset) as DhcpLeaseWithRelations[];
  return { rows, total };
}

export function getDhcpLeasesByDevice(deviceId: number): DhcpLease[] {
  return db().prepare("SELECT * FROM dhcp_leases WHERE source_device_id = ? ORDER BY ip_address").all(deviceId) as DhcpLease[];
}

export function upsertDhcpLease(input: { source_type: "mikrotik" | "windows" | "cisco" | "other"; source_device_id: number; source_name?: string | null; server_name?: string | null; scope_id?: string | null; scope_name?: string | null; ip_address: string; mac_address: string; hostname?: string | null; status?: string | null; lease_start?: string | null; lease_expires?: string | null; description?: string | null; host_id?: number | null; network_id?: number | null; dynamic_lease?: number | null }): void {
  const d = db();
  const macNorm = normalizeMacForStorage(input.mac_address) ?? input.mac_address.trim();
  d.prepare(`INSERT INTO dhcp_leases (source_type, source_device_id, source_name, server_name, scope_id, scope_name, ip_address, mac_address, hostname, status, lease_start, lease_expires, description, dynamic_lease, host_id, network_id, last_synced) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(source_device_id, ip_address) DO UPDATE SET source_name = excluded.source_name, server_name = excluded.server_name, scope_id = excluded.scope_id, scope_name = excluded.scope_name, mac_address = excluded.mac_address, hostname = excluded.hostname, status = excluded.status, lease_start = excluded.lease_start, lease_expires = excluded.lease_expires, description = excluded.description, dynamic_lease = COALESCE(excluded.dynamic_lease, dhcp_leases.dynamic_lease), host_id = COALESCE(excluded.host_id, dhcp_leases.host_id), network_id = COALESCE(excluded.network_id, dhcp_leases.network_id), last_synced = datetime('now')`).run(input.source_type, input.source_device_id, input.source_name ?? null, input.server_name ?? null, input.scope_id ?? null, input.scope_name ?? null, input.ip_address, macNorm, input.hostname ?? null, input.status ?? null, input.lease_start ?? null, input.lease_expires ?? null, input.description ?? null, input.dynamic_lease ?? null, input.host_id ?? null, input.network_id ?? null);
}

export function syncIpAssignmentsForNetwork(networkId: number): number {
  const network = getNetworkById(networkId);
  if (!network) return 0;
  const rows = db().prepare(`SELECT id, ip, mac FROM hosts WHERE network_id = ?`).all(networkId) as { id: number; ip: string; mac: string | null }[];
  if (rows.length === 0) return 0;
  const dhcpLeases = db().prepare(`SELECT * FROM dhcp_leases WHERE network_id = ?`).all(networkId) as DhcpLease[];
  const ips = rows.map((r) => r.ip);
  const placeholders = ips.map(() => "?").join(",");
  const adLeasesByIp = db().prepare(`SELECT * FROM ad_dhcp_leases WHERE ip_address IN (${placeholders})`).all(...ips) as AdDhcpLease[];
  const byIpAd = new Map<string, AdDhcpLease>();
  for (const a of adLeasesByIp) { if (!byIpAd.has(a.ip_address)) byIpAd.set(a.ip_address, a); }
  const needsFullAdForMac = rows.some((h) => !!h.mac?.trim() && !byIpAd.get(h.ip));
  const adAllRows = needsFullAdForMac ? (db().prepare(`SELECT * FROM ad_dhcp_leases`).all() as AdDhcpLease[]) : [];
  const stmt = db().prepare(`UPDATE hosts SET ip_assignment = ?, updated_at = datetime('now') WHERE id = ?`);
  let n = 0;
  for (const h of rows) {
    const dhcpLease = resolveDhcpLeaseForHost(h.ip, h.mac, dhcpLeases);
    const adLease = resolveAdDhcpLeaseForHost(h.ip, h.mac, byIpAd, adAllRows);
    const next = inferIpAssignment(dhcpLease, adLease);
    stmt.run(next, h.id);
    n++;
  }
  return n;
}

export function syncIpAssignmentsForAllNetworks(): number {
  const nets = getNetworks();
  let t = 0;
  for (const n of nets) { t += syncIpAssignmentsForNetwork(n.id); }
  return t;
}

export function bulkUpsertDhcpLeases(leases: Array<{ source_type: "mikrotik" | "windows" | "cisco" | "other"; source_device_id: number; source_name?: string | null; server_name?: string | null; ip_address: string; mac_address: string; hostname?: string | null; status?: string | null; lease_expires?: string | null; description?: string | null; network_id?: number | null; dynamic_lease?: number | null }>): { inserted: number; updated: number } {
  let inserted = 0;
  let updated = 0;
  const netIds = new Set<number | null>();
  const t = db().transaction(() => {
    for (const lease of leases) {
      const existing = db().prepare("SELECT id FROM dhcp_leases WHERE source_device_id = ? AND ip_address = ?").get(lease.source_device_id, lease.ip_address);
      upsertDhcpLease(lease);
      if (existing) updated++; else inserted++;
      if (lease.network_id != null) netIds.add(lease.network_id);
    }
  });
  t();
  for (const nid of netIds) { if (nid != null) syncIpAssignmentsForNetwork(nid); }
  return { inserted, updated };
}

export function deleteDhcpLeasesByDevice(deviceId: number): number {
  return db().prepare("DELETE FROM dhcp_leases WHERE source_device_id = ?").run(deviceId).changes;
}

export function getDhcpLeaseStats(): { total: number; bySource: Record<string, number>; byNetwork: Array<{ network_id: number; network_name: string; count: number }> } {
  const total = (db().prepare("SELECT COUNT(*) as c FROM dhcp_leases").get() as { c: number }).c;
  const bySourceRows = db().prepare("SELECT source_type, COUNT(*) as c FROM dhcp_leases GROUP BY source_type").all() as Array<{ source_type: string; c: number }>;
  const bySource: Record<string, number> = {};
  for (const r of bySourceRows) bySource[r.source_type] = r.c;
  const byNetwork = db().prepare(`SELECT d.network_id, COALESCE(n.name, 'Sconosciuta') as network_name, COUNT(*) as count FROM dhcp_leases d LEFT JOIN networks n ON n.id = d.network_id GROUP BY d.network_id ORDER BY count DESC`).all() as Array<{ network_id: number; network_name: string; count: number }>;
  return { total, bySource, byNetwork };
}

// ═══════════════════════════════════════════════════════════════════════════
// MISC
// ═══════════════════════════════════════════════════════════════════════════

/** Reset configurazione tenant (solo tabelle tenant, non hub). */
export function resetConfiguration(): void {
  const d = db();
  d.transaction(() => {
    d.exec(`
      DELETE FROM scan_history;
      DELETE FROM status_history;
      DELETE FROM host_detect_credential;
      DELETE FROM network_host_credentials;
      DELETE FROM host_credentials;
      DELETE FROM network_credentials;
      DELETE FROM arp_entries;
      DELETE FROM mac_port_entries;
      DELETE FROM mac_ip_history;
      DELETE FROM mac_ip_mapping;
      DELETE FROM switch_ports;
      DELETE FROM network_router;
      DELETE FROM device_credential_bindings;
      DELETE FROM device_neighbors;
      DELETE FROM routing_table;
      DELETE FROM multihomed_links;
      DELETE FROM hosts;
      DELETE FROM network_devices;
      DELETE FROM networks;
      DELETE FROM ad_dhcp_leases;
      DELETE FROM ad_computers;
      DELETE FROM ad_users;
      DELETE FROM ad_groups;
      DELETE FROM ad_integrations;
      DELETE FROM credentials;
      DELETE FROM scheduled_jobs;
      DELETE FROM proxmox_hosts;
      DELETE FROM inventory_audit_log;
      DELETE FROM license_seats;
      DELETE FROM licenses;
      DELETE FROM asset_assignees;
      DELETE FROM inventory_assets;
      DELETE FROM locations;
      DELETE FROM dhcp_leases;
    `);
  })();
}

export function getDistinctHostVendorHints(limit = 400): string[] {
  const rows = db()
    .prepare(
      `SELECT DISTINCT trim(v) AS v FROM (
        SELECT vendor AS v FROM hosts WHERE vendor IS NOT NULL AND trim(vendor) != ''
        UNION
        SELECT device_manufacturer AS v FROM hosts WHERE device_manufacturer IS NOT NULL AND trim(device_manufacturer) != ''
      ) ORDER BY v COLLATE NOCASE LIMIT ?`
    )
    .all(limit) as { v: string }[];
  return rows.map((r) => r.v);
}

// ═══════════════════════════════════════════════════════════════════════════
// CROSS-TENANT AGGREGATION (superadmin)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Esegue una query su TUTTI i tenant attivi e unisce i risultati.
 * Ogni item viene annotato con _tenantCode e _tenantName.
 */
export function queryAllTenants<T extends Record<string, unknown>>(
  fn: () => T[]
): (T & { _tenantCode: string; _tenantName: string })[] {
  const tenants = getActiveTenants();
  const results: (T & { _tenantCode: string; _tenantName: string })[] = [];
  for (const t of tenants) {
    try {
      const items = withTenant(t.codice_cliente, fn);
      for (const item of items) {
        results.push({ ...item, _tenantCode: t.codice_cliente, _tenantName: t.ragione_sociale });
      }
    } catch { /* skip tenant con errori */ }
  }
  return results;
}

/**
 * Esegue una query scalare/aggregata su TUTTI i tenant attivi.
 * Restituisce un array con il risultato per ogni tenant.
 */
export function queryAllTenantsScalar<T>(
  fn: () => T
): Array<{ tenant: { code: string; name: string }; data: T }> {
  const tenants = getActiveTenants();
  return tenants.map(t => {
    try {
      return { tenant: { code: t.codice_cliente, name: t.ragione_sociale }, data: withTenant(t.codice_cliente, fn) };
    } catch {
      return { tenant: { code: t.codice_cliente, name: t.ragione_sociale }, data: null as unknown as T };
    }
  });
}
