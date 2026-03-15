import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { SCHEMA_SQL } from "./db-schema";
import { macToHex } from "./utils";

/** Convert IPv4 string to numeric value for sorting */
function ipToNum(ip: string): number {
  const p = ip.split(".").map(Number);
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}
import type {
  Network,
  NetworkWithStats,
  Host,
  HostDetail,
  ScanHistory,
  NetworkDevice,
  ArpEntry,
  MacPortEntry,
  ScheduledJob,
  StatusHistory,
  User,
  NetworkInput,
  HostInput,
  HostUpdate,
  ScheduledJobInput,
} from "@/types";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "ipam.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  // Migrations for existing DBs (before schema so INSERT with new columns works)
  try {
    _db.exec("ALTER TABLE hosts ADD COLUMN open_ports TEXT");
  } catch { /* column already exists or table missing */ }
  try {
    _db.exec("ALTER TABLE hosts ADD COLUMN os_info TEXT");
  } catch { /* column already exists or table missing */ }
  try {
    _db.exec("ALTER TABLE nmap_profiles ADD COLUMN snmp_community TEXT");
  } catch { /* column already exists or table missing */ }
  try {
    _db.exec("ALTER TABLE networks ADD COLUMN snmp_community TEXT");
  } catch { /* column already exists or table missing */ }
  try {
    _db.exec("ALTER TABLE nmap_profiles ADD COLUMN custom_ports TEXT");
  } catch { /* column already exists */ }
  try {
    _db.exec("ALTER TABLE networks ADD COLUMN dns_server TEXT");
  } catch { /* column already exists */ }
  try {
    _db.exec("ALTER TABLE hosts ADD COLUMN known_host INTEGER DEFAULT 0");
  } catch { /* column already exists */ }
  try {
    _db.exec("ALTER TABLE switch_ports ADD COLUMN host_id INTEGER");
  } catch { /* column already exists or table missing */ }
  try {
    _db.exec("ALTER TABLE switch_ports ADD COLUMN trunk_neighbor_name TEXT");
  } catch { /* column already exists or table missing */ }
  try {
    _db.exec("ALTER TABLE switch_ports ADD COLUMN trunk_neighbor_port TEXT");
  } catch { /* column already exists or table missing */ }
  try {
    _db.exec("ALTER TABLE switch_ports ADD COLUMN trunk_primary_device_id INTEGER");
  } catch { /* column already exists or table missing */ }
  try {
    _db.exec("ALTER TABLE switch_ports ADD COLUMN trunk_primary_name TEXT");
  } catch { /* column already exists or table missing */ }
  try {
    _db.exec(`CREATE TABLE IF NOT EXISTS network_router (
      network_id INTEGER NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
      router_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
      PRIMARY KEY (network_id)
    )`);
  } catch { /* table already exists */ }

  _db.exec(SCHEMA_SQL);

  try {
    _db.exec(`UPDATE nmap_profiles SET name = 'Personalizzato', description = 'Top 100 TCP + porte esplicite + UDP note + SNMP con community', args = '', snmp_community = 'public', custom_ports = '' WHERE name = 'SNMP + porte custom'`);
  } catch { /* ignore */ }
  try {
    _db.exec(`INSERT OR IGNORE INTO nmap_profiles (name, description, args, snmp_community, custom_ports, is_default)
      VALUES ('Personalizzato', 'Top 100 TCP + porte esplicite + UDP note + SNMP con community', '', 'public', '', 0)`);
  } catch { /* profile may exist */ }

  return _db;
}

// ========================
// Users
// ========================

export function getUserByUsername(username: string): User | undefined {
  return getDb().prepare("SELECT * FROM users WHERE username = ?").get(username) as User | undefined;
}

export function getUserCount(): number {
  const row = getDb().prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
  return row.count;
}

export function createUser(username: string, passwordHash: string, role: "admin" | "viewer" = "admin"): User {
  const stmt = getDb().prepare(
    "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)"
  );
  const result = stmt.run(username, passwordHash, role);
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid) as User;
}

export function updateUserLastLogin(userId: number): void {
  getDb().prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(userId);
}

// ========================
// Networks
// ========================

export function getNetworks(): NetworkWithStats[] {
  return getDb().prepare(`
    SELECT
      n.*,
      COALESCE(h.total_hosts, 0) as total_hosts,
      COALESCE(h.online_count, 0) as online_count,
      COALESCE(h.offline_count, 0) as offline_count,
      COALESCE(h.unknown_count, 0) as unknown_count,
      (SELECT MAX(timestamp) FROM scan_history WHERE network_id = n.id) as last_scan
    FROM networks n
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
  `).all() as NetworkWithStats[];
}

export function getNetworkById(id: number): Network | undefined {
  return getDb().prepare("SELECT * FROM networks WHERE id = ?").get(id) as Network | undefined;
}

export function createNetwork(input: NetworkInput): Network {
  const stmt = getDb().prepare(
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
  return getDb().prepare("SELECT * FROM networks WHERE id = ?").get(result.lastInsertRowid) as Network;
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

  getDb().prepare(`UPDATE networks SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getNetworkById(id);
}

export function deleteNetwork(id: number): boolean {
  const result = getDb().prepare("DELETE FROM networks WHERE id = ?").run(id);
  return result.changes > 0;
}

// ========================
// Hosts
// ========================

export function getHostsByNetwork(networkId: number): Host[] {
  const hosts = getDb().prepare(
    "SELECT * FROM hosts WHERE network_id = ?"
  ).all(networkId) as Host[];
  // Sort by numeric IP value (not lexicographic)
  return hosts.sort((a, b) => ipToNum(a.ip) - ipToNum(b.ip));
}

/** Confronto MAC normalizzato (ignora : - .) per match cross-vendor */
const MAC_HEX = (col: string) => `UPPER(REPLACE(REPLACE(REPLACE(COALESCE(${col},''), ':', ''), '-', ''), '.', ''))`;

export function getHostByMac(mac: string): Host | undefined {
  const hex = macToHex(mac);
  if (hex.length < 12) return undefined;
  return getDb().prepare(`SELECT * FROM hosts WHERE ${MAC_HEX("mac")} = ? LIMIT 1`).get(hex) as Host | undefined;
}

/** Resolve MAC to a registered network device (router/switch) via ARP or hosts. Used to identify trunk peer when LLDP/CDP unavailable. */
export function resolveMacToNetworkDevice(mac: string, excludeDeviceId?: number): { device_id: number; device_name: string; device_type: string } | null {
  let ip: string | null = null;
  const host = getHostByMac(mac);
  if (host) ip = host.ip;
  if (!ip) {
    const hex = macToHex(mac);
    const arp = getDb().prepare(
      `SELECT ip FROM arp_entries WHERE ${MAC_HEX("mac")} = ? AND ip IS NOT NULL ORDER BY timestamp DESC LIMIT 1`
    ).get(hex) as { ip: string } | undefined;
    ip = arp?.ip ?? null;
  }
  if (!ip) return null;
  const nd = getDb().prepare(
    "SELECT id, name, device_type FROM network_devices WHERE host = ? AND (enabled = 1 OR enabled IS NULL)"
  ).get(ip) as { id: number; name: string; device_type: string } | undefined;
  if (!nd || (excludeDeviceId != null && nd.id === excludeDeviceId)) return null;
  return { device_id: nd.id, device_name: nd.name, device_type: nd.device_type };
}

/** Resolve MAC to device info from hosts (IPAM) and arp_entries, for switch port assignment */
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
  const arp = getDb().prepare(
    `SELECT ip FROM arp_entries WHERE ${MAC_HEX("mac")} = ? AND ip IS NOT NULL ORDER BY timestamp DESC LIMIT 1`
  ).get(hex) as { ip: string } | undefined;
  return {
    ip: arp?.ip ?? null,
    hostname: null,
    vendor: null,
    host_id: null,
  };
}

export function getHostById(id: number): HostDetail | undefined {
  const host = getDb().prepare(`
    SELECT h.*, n.cidr as network_cidr, n.name as network_name
    FROM hosts h
    JOIN networks n ON n.id = h.network_id
    WHERE h.id = ?
  `).get(id) as (Host & { network_cidr: string; network_name: string }) | undefined;

  if (!host) return undefined;

  const recentScans = getDb().prepare(
    "SELECT * FROM scan_history WHERE host_id = ? ORDER BY timestamp DESC LIMIT 50"
  ).all(id) as ScanHistory[];

  // Find ARP source (router that provided this host's MAC)
  const arpSource = host.mac ? getDb().prepare(`
    SELECT nd.name as device_name, nd.vendor as device_vendor, ae.timestamp as last_query
    FROM arp_entries ae
    JOIN network_devices nd ON nd.id = ae.device_id
    WHERE ${MAC_HEX("ae.mac")} = ? AND nd.device_type = 'router'
    ORDER BY ae.timestamp DESC LIMIT 1
  `).get(macToHex(host.mac)) as { device_name: string; device_vendor: string; last_query: string } | undefined : undefined;

  // Find switch port mapping
  const switchPort = host.mac ? getDb().prepare(`
    SELECT nd.name as device_name, nd.vendor as device_vendor, mpe.port_name, mpe.vlan
    FROM mac_port_entries mpe
    JOIN network_devices nd ON nd.id = mpe.device_id
    WHERE ${MAC_HEX("mpe.mac")} = ? AND nd.device_type = 'switch'
    ORDER BY mpe.timestamp DESC LIMIT 1
  `).get(macToHex(host.mac)) as { device_name: string; device_vendor: string; port_name: string; vlan: number | null } | undefined : undefined;

  return {
    ...host,
    recent_scans: recentScans,
    arp_source: arpSource || null,
    switch_port: switchPort || null,
  };
}

/** Merge existing open_ports JSON with new scan result (union by port+protocol) */
function mergeOpenPorts(existing: string | null, incoming: string): string {
  const toMap = (json: string): Map<string, { port: number; protocol: string; service?: string | null; version?: string | null }> => {
    const map = new Map<string, { port: number; protocol: string; service?: string | null; version?: string | null }>();
    try {
      const arr = JSON.parse(json) as Array<{ port: number; protocol?: string; service?: string | null; version?: string | null }>;
      if (Array.isArray(arr)) {
        for (const p of arr) {
          const key = `${p.port}:${p.protocol || "tcp"}`;
          if (!map.has(key)) map.set(key, { port: p.port, protocol: p.protocol || "tcp", service: p.service, version: p.version });
        }
      }
    } catch { /* ignore */ }
    return map;
  };
  const merged = toMap(existing || "[]");
  const incomingMap = toMap(incoming);
  for (const [k, v] of incomingMap) {
    merged.set(k, v);
  }
  return JSON.stringify([...merged.values()].sort((a, b) => a.port - b.port || String(a.protocol).localeCompare(b.protocol)));
}

export function upsertHost(input: HostInput & { mac?: string; vendor?: string; hostname?: string; dns_forward?: string; dns_reverse?: string; status?: "online" | "offline" | "unknown"; open_ports?: string; os_info?: string }): Host {
  const existing = getDb().prepare(
    "SELECT id FROM hosts WHERE network_id = ? AND ip = ?"
  ).get(input.network_id, input.ip) as { id: number } | undefined;

  if (existing) {
    const existingRow = getDb().prepare("SELECT open_ports FROM hosts WHERE id = ?").get(existing.id) as { open_ports: string | null } | undefined;
    const fields: string[] = ["updated_at = datetime('now')"];
    const values: unknown[] = [];

    if (input.mac !== undefined) { fields.push("mac = ?"); values.push(input.mac); }
    if (input.vendor !== undefined) { fields.push("vendor = ?"); values.push(input.vendor); }
    if (input.hostname !== undefined) { fields.push("hostname = ?"); values.push(input.hostname); }
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
    if (input.classification !== undefined) { fields.push("classification = ?"); values.push(input.classification); }
    if (input.inventory_code !== undefined) { fields.push("inventory_code = ?"); values.push(input.inventory_code); }
    if (input.notes !== undefined) { fields.push("notes = ?"); values.push(input.notes); }
    if (input.open_ports !== undefined) {
      const merged = mergeOpenPorts(existingRow?.open_ports ?? null, input.open_ports);
      fields.push("open_ports = ?");
      values.push(merged);
    }
    if (input.os_info !== undefined) { fields.push("os_info = ?"); values.push(input.os_info); }

    values.push(existing.id);
    getDb().prepare(`UPDATE hosts SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    return getDb().prepare("SELECT * FROM hosts WHERE id = ?").get(existing.id) as Host;
  }

  const stmt = getDb().prepare(`
    INSERT INTO hosts (network_id, ip, mac, vendor, hostname, dns_forward, dns_reverse, custom_name, classification, inventory_code, notes, status, open_ports, os_info, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${input.status === "online" ? "datetime('now')" : "NULL"}, ${input.status === "online" ? "datetime('now')" : "NULL"})
  `);
  const result = stmt.run(
    input.network_id,
    input.ip,
    input.mac || null,
    input.vendor || null,
    input.hostname || null,
    input.dns_forward || null,
    input.dns_reverse || null,
    input.custom_name || null,
    input.classification || "unknown",
    input.inventory_code || null,
    input.notes || "",
    input.status || "unknown",
    (input as { open_ports?: string }).open_ports || null,
    (input as { os_info?: string }).os_info || null
  );
  return getDb().prepare("SELECT * FROM hosts WHERE id = ?").get(result.lastInsertRowid) as Host;
}

export function updateHost(id: number, input: HostUpdate): Host | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.custom_name !== undefined) { fields.push("custom_name = ?"); values.push(input.custom_name); }
  if (input.classification !== undefined) { fields.push("classification = ?"); values.push(input.classification); }
  if (input.inventory_code !== undefined) { fields.push("inventory_code = ?"); values.push(input.inventory_code); }
  if (input.notes !== undefined) { fields.push("notes = ?"); values.push(input.notes); }
  if (input.mac !== undefined) { fields.push("mac = ?"); values.push(input.mac); }
  if (input.known_host !== undefined) { fields.push("known_host = ?"); values.push(input.known_host); }

  if (fields.length === 0) return getDb().prepare("SELECT * FROM hosts WHERE id = ?").get(id) as Host | undefined;

  fields.push("updated_at = datetime('now')");
  values.push(id);

  getDb().prepare(`UPDATE hosts SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getDb().prepare("SELECT * FROM hosts WHERE id = ?").get(id) as Host | undefined;
}

export function deleteHost(id: number): boolean {
  return getDb().prepare("DELETE FROM hosts WHERE id = ?").run(id).changes > 0;
}

export function markHostsOffline(networkId: number, onlineIps: string[]): void {
  if (onlineIps.length === 0) {
    getDb().prepare(
      "UPDATE hosts SET status = 'offline', updated_at = datetime('now') WHERE network_id = ? AND status = 'online'"
    ).run(networkId);
    return;
  }
  const placeholders = onlineIps.map(() => "?").join(",");
  getDb().prepare(
    `UPDATE hosts SET status = 'offline', updated_at = datetime('now') WHERE network_id = ? AND status = 'online' AND ip NOT IN (${placeholders})`
  ).run(networkId, ...onlineIps);
}

// ========================
// Scan History
// ========================

export function addScanHistory(entry: Omit<ScanHistory, "id" | "timestamp">): void {
  getDb().prepare(
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

  return getDb().prepare(
    `SELECT * FROM scan_history ${where} ORDER BY timestamp DESC LIMIT ?`
  ).all(...values, limit) as ScanHistory[];
}

// ========================
// Network Devices
// ========================

export function getNetworkDevices(): NetworkDevice[] {
  return getDb().prepare("SELECT * FROM network_devices ORDER BY name").all() as NetworkDevice[];
}

export function getRouters(): NetworkDevice[] {
  return getDb().prepare("SELECT * FROM network_devices WHERE device_type = 'router' ORDER BY name").all() as NetworkDevice[];
}

export function getSwitches(): NetworkDevice[] {
  return getDb().prepare("SELECT * FROM network_devices WHERE device_type = 'switch' ORDER BY name").all() as NetworkDevice[];
}

// ========================
// Network Router (ARP assignment per subnet)
// ========================

export function getNetworkRouterId(networkId: number): number | null {
  const row = getDb().prepare("SELECT router_id FROM network_router WHERE network_id = ?").get(networkId) as { router_id: number } | undefined;
  return row?.router_id ?? null;
}

export function setNetworkRouter(networkId: number, routerId: number): void {
  getDb().prepare(
    "INSERT OR REPLACE INTO network_router (network_id, router_id) VALUES (?, ?)"
  ).run(networkId, routerId);
}

export function deleteNetworkRouter(networkId: number): void {
  getDb().prepare("DELETE FROM network_router WHERE network_id = ?").run(networkId);
}

export function getNetworkDeviceById(id: number): NetworkDevice | undefined {
  return getDb().prepare("SELECT * FROM network_devices WHERE id = ?").get(id) as NetworkDevice | undefined;
}

export function createNetworkDevice(input: Omit<NetworkDevice, "id" | "created_at" | "updated_at">): NetworkDevice {
  const stmt = getDb().prepare(
    `INSERT INTO network_devices (name, host, device_type, vendor, protocol, username, encrypted_password, community_string, api_token, api_url, port, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    input.name, input.host, input.device_type, input.vendor, input.protocol,
    input.username, input.encrypted_password, input.community_string,
    input.api_token, input.api_url, input.port, input.enabled
  );
  return getDb().prepare("SELECT * FROM network_devices WHERE id = ?").get(result.lastInsertRowid) as NetworkDevice;
}

export function updateNetworkDevice(id: number, input: Partial<Omit<NetworkDevice, "id" | "created_at" | "updated_at">>): NetworkDevice | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];

  const keys = ["name", "host", "device_type", "vendor", "protocol", "username", "encrypted_password", "community_string", "api_token", "api_url", "port", "enabled"] as const;
  for (const key of keys) {
    if (input[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(input[key]);
    }
  }

  if (fields.length === 0) return getNetworkDeviceById(id);

  fields.push("updated_at = datetime('now')");
  values.push(id);
  getDb().prepare(`UPDATE network_devices SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getNetworkDeviceById(id);
}

export function deleteNetworkDevice(id: number): boolean {
  return getDb().prepare("DELETE FROM network_devices WHERE id = ?").run(id).changes > 0;
}

// ========================
// ARP Entries
// ========================

export function upsertArpEntries(deviceId: number, entries: { mac: string; ip: string | null; interface_name: string | null }[]): void {
  const db = getDb();
  // Clear old entries for this device
  db.prepare("DELETE FROM arp_entries WHERE device_id = ?").run(deviceId);

  const stmt = db.prepare(
    `INSERT INTO arp_entries (device_id, host_id, mac, ip, interface_name)
     VALUES (?, (SELECT id FROM hosts WHERE ${MAC_HEX("mac")} = ? LIMIT 1), ?, ?, ?)`
  );

  const insertMany = db.transaction((items: typeof entries) => {
    for (const entry of items) {
      const hex = macToHex(entry.mac);
      stmt.run(deviceId, hex, entry.mac, entry.ip, entry.interface_name);
    }
  });

  insertMany(entries);
}

export function getArpEntriesByDevice(deviceId: number): (ArpEntry & { host_ip?: string; host_name?: string })[] {
  return getDb().prepare(`
    SELECT ae.*, h.ip as host_ip, COALESCE(h.custom_name, h.hostname) as host_name
    FROM arp_entries ae
    LEFT JOIN hosts h ON h.id = ae.host_id
    WHERE ae.device_id = ?
    ORDER BY ae.ip
  `).all(deviceId) as (ArpEntry & { host_ip?: string; host_name?: string })[];
}

// ========================
// MAC Port Entries
// ========================

export function upsertMacPortEntries(deviceId: number, entries: { mac: string; port_name: string; vlan: number | null; port_status: "up" | "down" | null; speed: string | null }[]): void {
  const db = getDb();
  db.prepare("DELETE FROM mac_port_entries WHERE device_id = ?").run(deviceId);

  const stmt = db.prepare(
    `INSERT INTO mac_port_entries (device_id, mac, port_name, vlan, port_status, speed)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const insertMany = db.transaction((items: typeof entries) => {
    for (const entry of items) {
      stmt.run(deviceId, entry.mac, entry.port_name, entry.vlan, entry.port_status, entry.speed);
    }
  });

  insertMany(entries);
}

export function getMacPortEntriesByDevice(deviceId: number): (MacPortEntry & { host_ip?: string; host_name?: string })[] {
  return getDb().prepare(`
    SELECT mpe.*,
      COALESCE(h.ip, (SELECT ae.ip FROM arp_entries ae WHERE ${MAC_HEX("ae.mac")} = ${MAC_HEX("mpe.mac")} AND ae.ip IS NOT NULL ORDER BY ae.timestamp DESC LIMIT 1)) as host_ip,
      COALESCE(h.custom_name, h.hostname) as host_name
    FROM mac_port_entries mpe
    LEFT JOIN hosts h ON ${MAC_HEX("h.mac")} = ${MAC_HEX("mpe.mac")}
    WHERE mpe.device_id = ?
    ORDER BY mpe.port_name
  `).all(deviceId) as (MacPortEntry & { host_ip?: string; host_name?: string })[];
}

// ========================
// Switch Ports
// ========================

export function upsertSwitchPorts(deviceId: number, ports: Omit<import("@/types").SwitchPort, "id" | "device_id" | "timestamp">[]): void {
  const db = getDb();
  db.prepare("DELETE FROM switch_ports WHERE device_id = ?").run(deviceId);

  const stmt = db.prepare(
    `INSERT INTO switch_ports (device_id, port_index, port_name, status, speed, duplex, vlan, poe_status, poe_power_mw, mac_count, is_trunk, single_mac, single_mac_vendor, single_mac_ip, single_mac_hostname, host_id, trunk_neighbor_name, trunk_neighbor_port, trunk_primary_device_id, trunk_primary_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const insertMany = db.transaction((items: typeof ports) => {
    for (const p of items) {
      stmt.run(deviceId, p.port_index, p.port_name, p.status, p.speed, p.duplex, p.vlan, p.poe_status, p.poe_power_mw, p.mac_count, p.is_trunk, p.single_mac, p.single_mac_vendor, p.single_mac_ip, p.single_mac_hostname, p.host_id ?? null, p.trunk_neighbor_name ?? null, p.trunk_neighbor_port ?? null, p.trunk_primary_device_id ?? null, p.trunk_primary_name ?? null);
    }
  });

  insertMany(ports);
}

export function getSwitchPortsByDevice(deviceId: number): import("@/types").SwitchPort[] {
  return getDb().prepare(
    "SELECT * FROM switch_ports WHERE device_id = ? ORDER BY port_index"
  ).all(deviceId) as import("@/types").SwitchPort[];
}

// ========================
// Scheduled Jobs
// ========================

export function getScheduledJobs(): ScheduledJob[] {
  return getDb().prepare("SELECT * FROM scheduled_jobs ORDER BY id").all() as ScheduledJob[];
}

export function getEnabledJobs(): ScheduledJob[] {
  return getDb().prepare("SELECT * FROM scheduled_jobs WHERE enabled = 1").all() as ScheduledJob[];
}

export function createScheduledJob(input: ScheduledJobInput): ScheduledJob {
  const stmt = getDb().prepare(
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
  return getDb().prepare("SELECT * FROM scheduled_jobs WHERE id = ?").get(result.lastInsertRowid) as ScheduledJob;
}

export function updateJobLastRun(id: number): void {
  const job = getDb().prepare("SELECT interval_minutes FROM scheduled_jobs WHERE id = ?").get(id) as { interval_minutes: number } | undefined;
  if (!job) return;
  getDb().prepare(
    `UPDATE scheduled_jobs SET last_run = datetime('now'), next_run = datetime('now', '+' || ? || ' minutes'), updated_at = datetime('now') WHERE id = ?`
  ).run(job.interval_minutes, id);
}

export function toggleJob(id: number, enabled: boolean): void {
  getDb().prepare("UPDATE scheduled_jobs SET enabled = ?, updated_at = datetime('now') WHERE id = ?").run(enabled ? 1 : 0, id);
}

export function deleteScheduledJob(id: number): boolean {
  return getDb().prepare("DELETE FROM scheduled_jobs WHERE id = ?").run(id).changes > 0;
}

// ========================
// Status History
// ========================

export function addStatusHistory(hostId: number, status: "online" | "offline"): void {
  getDb().prepare(
    "INSERT INTO status_history (host_id, status) VALUES (?, ?)"
  ).run(hostId, status);
}

export function getStatusHistory(hostId: number, limit: number = 100): StatusHistory[] {
  return getDb().prepare(
    "SELECT * FROM status_history WHERE host_id = ? ORDER BY checked_at DESC LIMIT ?"
  ).all(hostId, limit) as StatusHistory[];
}

// ========================
// Dashboard Stats
// ========================

export function getDashboardStats(): {
  total_networks: number;
  total_hosts: number;
  online_hosts: number;
  offline_hosts: number;
  unknown_hosts: number;
} {
  const row = getDb().prepare(`
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
  return getDb().prepare(
    "SELECT * FROM scan_history ORDER BY timestamp DESC LIMIT ?"
  ).all(limit) as ScanHistory[];
}

// ========================
// Cleanup
// ========================

export function cleanupStaleHosts(daysUntilStale: number, daysUntilDelete: number): { flagged: number; deleted: number } {
  const flagged = getDb().prepare(
    `UPDATE hosts SET classification = 'stale', updated_at = datetime('now')
     WHERE status = 'offline' AND last_seen < datetime('now', '-' || ? || ' days')
     AND classification != 'stale'`
  ).run(daysUntilStale);

  const deleted = getDb().prepare(
    `DELETE FROM hosts
     WHERE classification = 'stale' AND last_seen < datetime('now', '-' || ? || ' days')`
  ).run(daysUntilDelete);

  return { flagged: flagged.changes, deleted: deleted.changes };
}

// ========================
// Status History Aggregation (for charts)
// ========================

// ========================
// Global Search
// ========================

export function globalSearch(query: string, limit: number = 20): {
  hosts: Host[];
  networks: Network[];
} {
  const like = `%${query}%`;
  const hosts = getDb().prepare(`
    SELECT * FROM hosts
    WHERE ip LIKE ? OR mac LIKE ? OR hostname LIKE ? OR custom_name LIKE ?
      OR dns_forward LIKE ? OR dns_reverse LIKE ? OR notes LIKE ? OR vendor LIKE ?
    LIMIT ?
  `).all(like, like, like, like, like, like, like, like, limit) as Host[];
  // Sort by numeric IP value
  hosts.sort((a, b) => ipToNum(a.ip) - ipToNum(b.ip));

  const networks = getDb().prepare(`
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
  return getDb().prepare(`
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

// ========================
// Settings (key-value)
// ========================

export function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function getAllSettings(): Record<string, string> {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const result: Record<string, string> = {};
  for (const row of rows) result[row.key] = row.value;
  return result;
}

export function setSetting(key: string, value: string): void {
  getDb().prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
  ).run(key, value);
}

// ========================
// Nmap Profiles
// ========================

export interface NmapProfileRow {
  id: number;
  name: string;
  description: string;
  args: string;
  snmp_community: string | null;
  custom_ports: string | null;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export function getNmapProfiles(): NmapProfileRow[] {
  return getDb().prepare("SELECT * FROM nmap_profiles ORDER BY is_default DESC, name ASC").all() as NmapProfileRow[];
}

export function getNmapProfileById(id: number): NmapProfileRow | undefined {
  return getDb().prepare("SELECT * FROM nmap_profiles WHERE id = ?").get(id) as NmapProfileRow | undefined;
}

export function createNmapProfile(
  name: string,
  description: string,
  args: string,
  snmpCommunity?: string | null,
  customPorts?: string | null
): NmapProfileRow {
  const result = getDb().prepare(
    "INSERT INTO nmap_profiles (name, description, args, snmp_community, custom_ports, is_default) VALUES (?, ?, ?, ?, ?, 0)"
  ).run(name, description, args, snmpCommunity || null, customPorts ?? null);
  return getDb().prepare("SELECT * FROM nmap_profiles WHERE id = ?").get(result.lastInsertRowid) as NmapProfileRow;
}

export function updateNmapProfile(
  id: number,
  name: string,
  description: string,
  args: string,
  snmpCommunity?: string | null,
  customPorts?: string | null
): NmapProfileRow | undefined {
  getDb().prepare(
    "UPDATE nmap_profiles SET name = ?, description = ?, args = ?, snmp_community = ?, custom_ports = ?, updated_at = datetime('now') WHERE id = ? AND is_default = 0"
  ).run(name, description, args, snmpCommunity ?? null, customPorts ?? null, id);
  return getNmapProfileById(id);
}

export function deleteNmapProfile(id: number): boolean {
  return getDb().prepare("DELETE FROM nmap_profiles WHERE id = ? AND is_default = 0").run(id).changes > 0;
}

export function updateUserPassword(userId: number, passwordHash: string): void {
  getDb().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, userId);
}

/** Reset all networks and devices for new client. Keeps users, settings, nmap_profiles. */
export function resetConfiguration(): void {
  const db = getDb();
  db.exec(`
    DELETE FROM networks;
    DELETE FROM network_devices;
  `);
}
