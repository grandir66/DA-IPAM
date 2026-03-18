import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { SCHEMA_SQL } from "./db-schema";
import { macToHex, normalizeMac } from "./utils";
import { decrypt } from "./crypto";
import { randomUUID } from "crypto";

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
  Credential,
  ArpEntry,
  MacPortEntry,
  ScheduledJob,
  StatusHistory,
  User,
  NetworkInput,
  HostInput,
  HostUpdate,
  ScheduledJobInput,
  CredentialInput,
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
  _db.pragma("synchronous = NORMAL");
  _db.pragma("cache_size = -64000");
  _db.pragma("temp_store = MEMORY");
  _db.pragma("mmap_size = 268435456");

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
  try {
    _db.exec(`CREATE TABLE IF NOT EXISTS credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      credential_type TEXT NOT NULL CHECK(credential_type IN ('ssh', 'snmp', 'api')),
      encrypted_username TEXT,
      encrypted_password TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`);
  } catch { /* table already exists */ }
  try {
    _db.exec("ALTER TABLE network_devices ADD COLUMN credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL");
  } catch { /* column already exists */ }
  try {
    _db.exec("ALTER TABLE network_devices ADD COLUMN vendor_subtype TEXT CHECK(vendor_subtype IN ('procurve', 'comware'))");
  } catch { /* column already exists */ }
  try {
    _db.exec("ALTER TABLE network_devices ADD COLUMN sysname TEXT");
  } catch { /* column already exists */ }
  try {
    _db.exec("ALTER TABLE network_devices ADD COLUMN sysdescr TEXT");
  } catch { /* column already exists */ }
  try {
    _db.exec("ALTER TABLE network_devices ADD COLUMN model TEXT");
  } catch { /* column already exists */ }
  try {
    _db.exec("ALTER TABLE network_devices ADD COLUMN firmware TEXT");
  } catch { /* column already exists */ }
  try {
    _db.exec("ALTER TABLE network_devices ADD COLUMN last_info_update TEXT");
  } catch { /* column already exists */ }
  try {
    _db.exec("ALTER TABLE switch_ports ADD COLUMN stp_state TEXT");
  } catch { /* column already exists */ }
  try {
    _db.exec("ALTER TABLE network_devices ADD COLUMN classification TEXT");
  } catch { /* column already exists */ }
  try {
    _db.exec("ALTER TABLE network_devices ADD COLUMN snmp_credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL");
  } catch { /* column already exists */ }
  try {
    _db.exec("ALTER TABLE network_devices ADD COLUMN stp_info TEXT");
  } catch { /* column already exists */ }
  try {
    _db.exec("ALTER TABLE network_devices ADD COLUMN serial_number TEXT");
  } catch { /* column already exists */ }
  try {
    _db.exec("ALTER TABLE hosts ADD COLUMN model TEXT");
  } catch { /* column already exists */ }
  try {
    _db.exec("ALTER TABLE hosts ADD COLUMN serial_number TEXT");
  } catch { /* column already exists */ }
  try {
    _db.exec("ALTER TABLE hosts ADD COLUMN classification_manual INTEGER DEFAULT 0");
  } catch { /* column already exists */ }
  try { _db.exec("ALTER TABLE status_history ADD COLUMN response_time_ms INTEGER"); } catch { /* already exists */ }
  try { _db.exec("ALTER TABLE hosts ADD COLUMN last_response_time_ms INTEGER"); } catch { /* already exists */ }
  try { _db.exec("ALTER TABLE hosts ADD COLUMN monitor_ports TEXT"); } catch { /* already exists */ }
  try { _db.exec("ALTER TABLE hosts ADD COLUMN hostname_source TEXT"); } catch { /* already exists */ }
  try { _db.exec("ALTER TABLE hosts ADD COLUMN conflict_flags TEXT"); } catch { /* already exists */ }
  try {
    _db.exec("DROP TABLE IF EXISTS scheduled_jobs_new");
    _db.exec(`CREATE TABLE scheduled_jobs_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
      job_type TEXT NOT NULL CHECK(job_type IN ('ping_sweep', 'snmp_scan', 'nmap_scan', 'arp_poll', 'dns_resolve', 'cleanup', 'known_host_check')),
      interval_minutes INTEGER NOT NULL DEFAULT 60,
      last_run TEXT,
      next_run TEXT,
      enabled INTEGER DEFAULT 1,
      config TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`);
    _db.exec("INSERT INTO scheduled_jobs_new SELECT * FROM scheduled_jobs");
    _db.exec("DROP TABLE scheduled_jobs");
    _db.exec("ALTER TABLE scheduled_jobs_new RENAME TO scheduled_jobs");
  } catch { /* migration already applied */ }
  try {
    _db.exec("DROP TABLE IF EXISTS scan_history_new");
    _db.exec(`CREATE TABLE scan_history_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_id INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
      network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
      scan_type TEXT NOT NULL CHECK(scan_type IN ('ping', 'snmp', 'nmap', 'arp', 'dns', 'windows')),
      status TEXT NOT NULL,
      ports_open TEXT,
      raw_output TEXT,
      duration_ms INTEGER,
      timestamp TEXT DEFAULT (datetime('now'))
    )`);
    _db.exec("INSERT INTO scan_history_new SELECT * FROM scan_history");
    _db.exec("DROP TABLE scan_history");
    _db.exec("ALTER TABLE scan_history_new RENAME TO scan_history");
  } catch { /* migration already applied or table missing */ }
  try {
    _db.exec("DROP TABLE IF EXISTS scan_history_new");
    _db.exec(`CREATE TABLE scan_history_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_id INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
      network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
      scan_type TEXT NOT NULL CHECK(scan_type IN ('ping', 'snmp', 'nmap', 'arp', 'dns', 'windows')),
      status TEXT NOT NULL,
      ports_open TEXT,
      raw_output TEXT,
      duration_ms INTEGER,
      timestamp TEXT DEFAULT (datetime('now'))
    )`);
    _db.exec("INSERT INTO scan_history_new SELECT * FROM scan_history");
    _db.exec("DROP TABLE scan_history");
    _db.exec("ALTER TABLE scan_history_new RENAME TO scan_history");
  } catch { /* migration already applied */ }
  // Migrazione: verifica che scan_type CHECK includa 'ssh' e 'windows'
  {
    const schema = _db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scan_history'").get() as { sql: string } | undefined;
    if (schema?.sql && !schema.sql.includes("'ssh'")) {
      _db.pragma("foreign_keys = OFF");
      try {
        _db.exec("DROP TABLE IF EXISTS scan_history_v3");
        _db.exec(`CREATE TABLE scan_history_v3 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          host_id INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
          network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
          scan_type TEXT NOT NULL CHECK(scan_type IN ('ping', 'snmp', 'nmap', 'arp', 'dns', 'windows', 'ssh')),
          status TEXT NOT NULL,
          ports_open TEXT,
          raw_output TEXT,
          duration_ms INTEGER,
          timestamp TEXT DEFAULT (datetime('now'))
        )`);
        _db.exec("INSERT INTO scan_history_v3 SELECT * FROM scan_history");
        _db.exec("DROP TABLE scan_history");
        _db.exec("ALTER TABLE scan_history_v3 RENAME TO scan_history");
        _db.exec("CREATE INDEX IF NOT EXISTS idx_scan_history_host ON scan_history(host_id)");
        _db.exec("CREATE INDEX IF NOT EXISTS idx_scan_history_network ON scan_history(network_id)");
      } catch { /* already migrated */ }
      _db.pragma("foreign_keys = ON");
    }
  }
  try {
    _db.pragma("foreign_keys = OFF");
    try {
      _db.exec(`CREATE TABLE credentials_host_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        credential_type TEXT NOT NULL CHECK(credential_type IN ('ssh', 'snmp', 'api', 'windows', 'linux')),
        encrypted_username TEXT,
        encrypted_password TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`);
      _db.exec("INSERT INTO credentials_host_new SELECT * FROM credentials");
      _db.exec("DROP TABLE credentials");
      _db.exec("ALTER TABLE credentials_host_new RENAME TO credentials");
    } finally {
      _db.pragma("foreign_keys = ON");
    }
  } catch { /* migration already applied or table missing */ }
  try {
    _db.pragma("foreign_keys = OFF");
    try {
      _db.exec(`CREATE TABLE network_devices_vendor_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        device_type TEXT NOT NULL CHECK(device_type IN ('router', 'switch')),
        vendor TEXT NOT NULL CHECK(vendor IN ('mikrotik', 'ubiquiti', 'hp', 'cisco', 'omada', 'stormshield', 'other')),
        vendor_subtype TEXT CHECK(vendor_subtype IN ('procurve', 'comware')),
        protocol TEXT NOT NULL CHECK(protocol IN ('ssh', 'snmp_v2', 'snmp_v3', 'api')),
        credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
        snmp_credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
        username TEXT,
        encrypted_password TEXT,
        community_string TEXT,
        api_token TEXT,
        api_url TEXT,
        port INTEGER DEFAULT 22,
        enabled INTEGER DEFAULT 1,
        classification TEXT,
        sysname TEXT,
        sysdescr TEXT,
        model TEXT,
        firmware TEXT,
        last_info_update TEXT,
        stp_info TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`);
      _db.exec("INSERT INTO network_devices_vendor_new SELECT * FROM network_devices");
      _db.exec("DROP TABLE network_devices");
      _db.exec("ALTER TABLE network_devices_vendor_new RENAME TO network_devices");
    } finally {
      _db.pragma("foreign_keys = ON");
    }
  } catch { /* migration already applied or table missing */ }
  try {
    _db.exec(`CREATE TABLE IF NOT EXISTS mac_ip_mapping (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mac_normalized TEXT NOT NULL UNIQUE,
      mac_display TEXT NOT NULL,
      ip TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('arp', 'dhcp', 'host', 'switch')),
      source_device_id INTEGER REFERENCES network_devices(id) ON DELETE SET NULL,
      network_id INTEGER REFERENCES networks(id) ON DELETE SET NULL,
      host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
      vendor TEXT,
      hostname TEXT,
      first_seen TEXT DEFAULT (datetime('now')),
      last_seen TEXT DEFAULT (datetime('now')),
      previous_ip TEXT
    )`);
  } catch { /* table exists */ }
  try {
    _db.exec(`CREATE TABLE IF NOT EXISTS mac_ip_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mac_normalized TEXT NOT NULL,
      ip TEXT NOT NULL,
      source TEXT NOT NULL,
      changed_at TEXT DEFAULT (datetime('now'))
    )`);
  } catch { /* table exists */ }
  try {
    _db.exec("CREATE INDEX IF NOT EXISTS idx_mac_ip_mapping_mac ON mac_ip_mapping(mac_normalized)");
  } catch { /* exists */ }
  try {
    _db.exec("CREATE INDEX IF NOT EXISTS idx_mac_ip_mapping_ip ON mac_ip_mapping(ip)");
  } catch { /* exists */ }
  try {
    _db.exec("CREATE INDEX IF NOT EXISTS idx_mac_ip_history_mac ON mac_ip_history(mac_normalized)");
  } catch { /* exists */ }

  _db.exec(SCHEMA_SQL);

  try {
    _db.exec(`CREATE TABLE IF NOT EXISTS inventory_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id TEXT UNIQUE,
      asset_tag TEXT,
      serial_number TEXT,
      network_device_id INTEGER REFERENCES network_devices(id) ON DELETE SET NULL,
      host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
      hostname TEXT,
      nome_prodotto TEXT,
      categoria TEXT,
      marca TEXT,
      modello TEXT,
      part_number TEXT,
      sede TEXT,
      reparto TEXT,
      utente_assegnatario_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      posizione_fisica TEXT,
      data_assegnazione TEXT,
      data_acquisto TEXT,
      data_installazione TEXT,
      data_dismissione TEXT,
      stato TEXT,
      fine_garanzia TEXT,
      fine_supporto TEXT,
      vita_utile_prevista INTEGER,
      sistema_operativo TEXT,
      versione_os TEXT,
      cpu TEXT,
      ram_gb INTEGER,
      storage_gb INTEGER,
      storage_tipo TEXT,
      mac_address TEXT,
      ip_address TEXT,
      vlan INTEGER,
      firmware_version TEXT,
      prezzo_acquisto REAL,
      fornitore TEXT,
      numero_ordine TEXT,
      numero_fattura TEXT,
      valore_attuale REAL,
      metodo_ammortamento TEXT,
      centro_di_costo TEXT,
      crittografia_disco INTEGER DEFAULT 0,
      antivirus TEXT,
      gestito_da_mdr INTEGER DEFAULT 0,
      classificazione_dati TEXT,
      in_scope_gdpr INTEGER DEFAULT 0,
      in_scope_nis2 INTEGER DEFAULT 0,
      ultimo_audit TEXT,
      contratto_supporto TEXT,
      tipo_garanzia TEXT,
      contatto_supporto TEXT,
      ultimo_intervento TEXT,
      prossima_manutenzione TEXT,
      note_tecniche TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`);
  } catch { /* table exists */ }
  try {
    _db.exec("CREATE INDEX IF NOT EXISTS idx_inventory_assets_network_device ON inventory_assets(network_device_id)");
  } catch { /* exists */ }
  try {
    _db.exec("CREATE INDEX IF NOT EXISTS idx_inventory_assets_host ON inventory_assets(host_id)");
  } catch { /* exists */ }

  try {
    _db.exec(`CREATE TABLE IF NOT EXISTS proxmox_hosts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER DEFAULT 8006,
      credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
      enabled INTEGER DEFAULT 1,
      last_scan_at TEXT,
      last_scan_result TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`);
  } catch { /* table exists */ }
  try {
    _db.exec("CREATE INDEX IF NOT EXISTS idx_proxmox_hosts_credential ON proxmox_hosts(credential_id)");
  } catch { /* exists */ }

  // Migration: device_type hypervisor + Proxmox columns + migrate proxmox_hosts
  try {
    _db.pragma("foreign_keys = OFF");
    _db.exec(`CREATE TABLE network_devices_hypervisor_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      device_type TEXT NOT NULL CHECK(device_type IN ('router', 'switch', 'hypervisor')),
      vendor TEXT NOT NULL CHECK(vendor IN ('mikrotik', 'ubiquiti', 'hp', 'cisco', 'omada', 'stormshield', 'proxmox', 'other')),
      vendor_subtype TEXT CHECK(vendor_subtype IN ('procurve', 'comware')),
      protocol TEXT NOT NULL CHECK(protocol IN ('ssh', 'snmp_v2', 'snmp_v3', 'api')),
      credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
      snmp_credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
      username TEXT,
      encrypted_password TEXT,
      community_string TEXT,
      api_token TEXT,
      api_url TEXT,
      port INTEGER DEFAULT 22,
      enabled INTEGER DEFAULT 1,
      classification TEXT,
      sysname TEXT,
      sysdescr TEXT,
      model TEXT,
      firmware TEXT,
      last_info_update TEXT,
      stp_info TEXT,
      last_proxmox_scan_at TEXT,
      last_proxmox_scan_result TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`);
    _db.exec(`INSERT INTO network_devices_hypervisor_new (id, name, host, device_type, vendor, vendor_subtype, protocol, credential_id, snmp_credential_id, username, encrypted_password, community_string, api_token, api_url, port, enabled, classification, sysname, sysdescr, model, firmware, last_info_update, stp_info, created_at, updated_at)
      SELECT id, name, host, device_type, vendor, vendor_subtype, protocol, credential_id, snmp_credential_id, username, encrypted_password, community_string, api_token, api_url, port, enabled, classification, sysname, sysdescr, model, firmware, last_info_update, stp_info, created_at, updated_at FROM network_devices`);
    try {
      _db.exec(`INSERT INTO network_devices_hypervisor_new (name, host, device_type, vendor, protocol, credential_id, port, enabled, classification, last_proxmox_scan_at, last_proxmox_scan_result, created_at, updated_at)
        SELECT name, host, 'hypervisor', 'proxmox', 'api', credential_id, port, 1, 'hypervisor', last_scan_at, last_scan_result, created_at, updated_at FROM proxmox_hosts`);
    } catch { /* proxmox_hosts may not exist or be empty */ }
    _db.exec("DROP TABLE network_devices");
    _db.exec("ALTER TABLE network_devices_hypervisor_new RENAME TO network_devices");
    _db.pragma("foreign_keys = ON");
  } catch { /* migration already applied */ }

  try {
    _db.exec("ALTER TABLE network_devices ADD COLUMN scan_target TEXT");
  } catch { /* column exists */ }

  // Migration: estendi vendor CHECK con vmware, linux, windows
  try {
    _db.pragma("foreign_keys = OFF");
    _db.exec(`CREATE TABLE network_devices_vendor_ext (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      device_type TEXT NOT NULL CHECK(device_type IN ('router', 'switch', 'hypervisor')),
      vendor TEXT NOT NULL CHECK(vendor IN ('mikrotik', 'ubiquiti', 'hp', 'cisco', 'omada', 'stormshield', 'proxmox', 'vmware', 'linux', 'windows', 'other')),
      vendor_subtype TEXT CHECK(vendor_subtype IN ('procurve', 'comware')),
      protocol TEXT NOT NULL CHECK(protocol IN ('ssh', 'snmp_v2', 'snmp_v3', 'api')),
      credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
      snmp_credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
      username TEXT, encrypted_password TEXT, community_string TEXT, api_token TEXT, api_url TEXT,
      port INTEGER DEFAULT 22, enabled INTEGER DEFAULT 1, classification TEXT,
      sysname TEXT, sysdescr TEXT, model TEXT, firmware TEXT, serial_number TEXT,
      last_info_update TEXT, stp_info TEXT, last_proxmox_scan_at TEXT, last_proxmox_scan_result TEXT,
      scan_target TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    )`);
    _db.exec(`INSERT INTO network_devices_vendor_ext
      SELECT id, name, host, device_type, vendor, vendor_subtype, protocol, credential_id, snmp_credential_id,
        username, encrypted_password, community_string, api_token, api_url, port, enabled, classification,
        sysname, sysdescr, model, firmware, serial_number, last_info_update, stp_info,
        last_proxmox_scan_at, last_proxmox_scan_result, scan_target, created_at, updated_at
      FROM network_devices`);
    _db.exec("DROP TABLE network_devices");
    _db.exec("ALTER TABLE network_devices_vendor_ext RENAME TO network_devices");
    _db.pragma("foreign_keys = ON");
  } catch { /* migration already applied */ }

  // Migration: aggiungere winrm/wmi al protocol per interrogare Windows
  try {
    _db.pragma("foreign_keys = OFF");
    _db.exec(`CREATE TABLE network_devices_winrm (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, host TEXT NOT NULL, device_type TEXT NOT NULL CHECK(device_type IN ('router', 'switch', 'hypervisor')),
      vendor TEXT NOT NULL CHECK(vendor IN ('mikrotik', 'ubiquiti', 'hp', 'cisco', 'omada', 'stormshield', 'proxmox', 'vmware', 'linux', 'windows', 'other')),
      vendor_subtype TEXT CHECK(vendor_subtype IN ('procurve', 'comware')),
      protocol TEXT NOT NULL CHECK(protocol IN ('ssh', 'snmp_v2', 'snmp_v3', 'api', 'winrm')),
      credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
      snmp_credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
      username TEXT, encrypted_password TEXT, community_string TEXT, api_token TEXT, api_url TEXT,
      port INTEGER DEFAULT 22, enabled INTEGER DEFAULT 1, classification TEXT,
      sysname TEXT, sysdescr TEXT, model TEXT, firmware TEXT, serial_number TEXT, part_number TEXT,
      last_info_update TEXT, last_device_info_json TEXT, stp_info TEXT,
      last_proxmox_scan_at TEXT, last_proxmox_scan_result TEXT,
      scan_target TEXT CHECK(scan_target IN ('proxmox', 'vmware', 'windows', 'linux')),
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    )`);
    _db.exec(`INSERT INTO network_devices_winrm SELECT * FROM network_devices`);
    _db.exec("DROP TABLE network_devices");
    _db.exec("ALTER TABLE network_devices_winrm RENAME TO network_devices");
    _db.pragma("foreign_keys = ON");
  } catch { /* migration already applied */ }

  // Migration: fix vendor CHECK se mancano vmware, linux, windows (DB con schema vecchio)
  try {
    const info = _db.prepare("PRAGMA table_info(network_devices)").all() as { name: string }[];
    const cols = info.map((r) => r.name);
    const hasVendorCol = cols.includes("vendor");
    if (!hasVendorCol) throw new Error("skip");
    const test = _db.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol, port, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))");
    try {
      test.run("_vendor_check_", "127.0.0.1", "router", "windows", "ssh", 22, 1);
      _db.prepare("DELETE FROM network_devices WHERE name = '_vendor_check_'").run();
    } catch {
      _db.pragma("foreign_keys = OFF");
      _db.exec(`CREATE TABLE network_devices_vendor_fix (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        device_type TEXT NOT NULL CHECK(device_type IN ('router', 'switch', 'hypervisor')),
        vendor TEXT NOT NULL CHECK(vendor IN ('mikrotik', 'ubiquiti', 'hp', 'cisco', 'omada', 'stormshield', 'proxmox', 'vmware', 'linux', 'windows', 'other')),
        vendor_subtype TEXT CHECK(vendor_subtype IN ('procurve', 'comware')),
        protocol TEXT NOT NULL CHECK(protocol IN ('ssh', 'snmp_v2', 'snmp_v3', 'api', 'winrm')),
        credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
        snmp_credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
        username TEXT, encrypted_password TEXT, community_string TEXT, api_token TEXT, api_url TEXT,
        port INTEGER DEFAULT 22, enabled INTEGER DEFAULT 1, classification TEXT,
        sysname TEXT, sysdescr TEXT, model TEXT, firmware TEXT, serial_number TEXT, part_number TEXT,
        last_info_update TEXT, last_device_info_json TEXT, stp_info TEXT,
        last_proxmox_scan_at TEXT, last_proxmox_scan_result TEXT,
        scan_target TEXT CHECK(scan_target IN ('proxmox', 'vmware', 'windows', 'linux')),
        created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
      )`);
      const targetCols = ["id","name","host","device_type","vendor","vendor_subtype","protocol","credential_id","snmp_credential_id","username","encrypted_password","community_string","api_token","api_url","port","enabled","classification","sysname","sysdescr","model","firmware","serial_number","part_number","last_info_update","last_device_info_json","stp_info","last_proxmox_scan_at","last_proxmox_scan_result","scan_target","created_at","updated_at"];
      const common = targetCols.filter((c) => cols.includes(c)).join(", ");
      _db.exec(`INSERT INTO network_devices_vendor_fix (${common}) SELECT ${common} FROM network_devices`);
      _db.exec("DROP TABLE network_devices");
      _db.exec("ALTER TABLE network_devices_vendor_fix RENAME TO network_devices");
      _db.pragma("foreign_keys = ON");
    }
  } catch { /* migration già applicata o skip */ }

  // Migration: estendi vendor CHECK con synology, qnap (NAS)
  try {
    const test = _db.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol, port, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))");
    try {
      test.run("_vendor_check_synology_", "127.0.0.1", "switch", "synology", "ssh", 22, 1);
      _db.prepare("DELETE FROM network_devices WHERE name = '_vendor_check_synology_'").run();
    } catch {
      _db.pragma("foreign_keys = OFF");
      const info = _db.prepare("PRAGMA table_info(network_devices)").all() as { name: string }[];
      const cols = info.map((r) => r.name);
      const targetCols = ["id","name","host","device_type","vendor","vendor_subtype","protocol","credential_id","snmp_credential_id","username","encrypted_password","community_string","api_token","api_url","port","enabled","classification","sysname","sysdescr","model","firmware","serial_number","part_number","last_info_update","last_device_info_json","stp_info","last_proxmox_scan_at","last_proxmox_scan_result","scan_target","created_at","updated_at"];
      const common = targetCols.filter((c) => cols.includes(c)).join(", ");
      _db.exec(`CREATE TABLE network_devices_nas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL, host TEXT NOT NULL, device_type TEXT NOT NULL CHECK(device_type IN ('router', 'switch', 'hypervisor')),
        vendor TEXT NOT NULL CHECK(vendor IN ('mikrotik', 'ubiquiti', 'hp', 'cisco', 'omada', 'stormshield', 'proxmox', 'vmware', 'linux', 'windows', 'synology', 'qnap', 'other')),
        vendor_subtype TEXT CHECK(vendor_subtype IN ('procurve', 'comware')),
        protocol TEXT NOT NULL CHECK(protocol IN ('ssh', 'snmp_v2', 'snmp_v3', 'api', 'winrm')),
        credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
        snmp_credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
        username TEXT, encrypted_password TEXT, community_string TEXT, api_token TEXT, api_url TEXT,
        port INTEGER DEFAULT 22, enabled INTEGER DEFAULT 1, classification TEXT,
        sysname TEXT, sysdescr TEXT, model TEXT, firmware TEXT, serial_number TEXT, part_number TEXT,
        last_info_update TEXT, last_device_info_json TEXT, stp_info TEXT,
        last_proxmox_scan_at TEXT, last_proxmox_scan_result TEXT,
        scan_target TEXT CHECK(scan_target IN ('proxmox', 'vmware', 'windows', 'linux')),
        created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
      )`);
      _db.exec(`INSERT INTO network_devices_nas (${common}) SELECT ${common} FROM network_devices`);
      _db.exec("DROP TABLE network_devices");
      _db.exec("ALTER TABLE network_devices_nas RENAME TO network_devices");
      _db.pragma("foreign_keys = ON");
    }
  } catch { /* migration già applicata o skip */ }

  try {
    _db.exec(`UPDATE nmap_profiles SET name = 'Personalizzato', description = 'Top 100 TCP + porte esplicite + UDP note + SNMP con community', args = '', snmp_community = 'public', custom_ports = '' WHERE name = 'SNMP + porte custom'`);
  } catch { /* ignore */ }
  try {
    _db.exec(`INSERT OR IGNORE INTO nmap_profiles (name, description, args, snmp_community, custom_ports, is_default)
      VALUES ('Personalizzato', 'Top 100 TCP + porte esplicite + UDP note + SNMP con community', '', 'public', '', 0)`);
  } catch { /* profile may exist */ }

  try {
    _db.exec("ALTER TABLE inventory_assets ADD COLUMN technical_data TEXT");
  } catch { /* column already exists */ }

  // Migration: aggiungere part_number e last_device_info_json a network_devices
  try {
    _db.exec("ALTER TABLE network_devices ADD COLUMN part_number TEXT");
  } catch { /* column already exists */ }
  try {
    _db.exec("ALTER TABLE network_devices ADD COLUMN last_device_info_json TEXT");
  } catch { /* column already exists */ }

  // Migration: tabelle inventario esteso (assegnatari, locations, licenze, audit)
  try {
    _db.exec(`CREATE TABLE IF NOT EXISTS asset_assignees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      note TEXT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`);
  } catch { /* exists */ }
  try {
    _db.exec(`CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
      address TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`);
  } catch { /* exists */ }
  try {
    _db.exec(`CREATE TABLE IF NOT EXISTS licenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      serial TEXT,
      seats INTEGER NOT NULL DEFAULT 1,
      category TEXT,
      expiration_date TEXT,
      purchase_cost REAL,
      min_amt INTEGER DEFAULT 0,
      fornitore TEXT,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`);
  } catch { /* exists */ }
  try {
    _db.exec(`CREATE TABLE IF NOT EXISTS license_seats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_id INTEGER NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
      asset_type TEXT CHECK(asset_type IN ('inventory_asset', 'host')),
      asset_id INTEGER,
      asset_assignee_id INTEGER REFERENCES asset_assignees(id) ON DELETE SET NULL,
      assigned_at TEXT DEFAULT (datetime('now')),
      note TEXT
    )`);
  } catch { /* exists */ }
  try {
    _db.exec(`CREATE TABLE IF NOT EXISTS inventory_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER NOT NULL REFERENCES inventory_assets(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL CHECK(action IN ('create', 'update', 'delete')),
      field_name TEXT,
      old_value TEXT,
      new_value TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
  } catch { /* exists */ }
  try {
    _db.exec("ALTER TABLE inventory_assets ADD COLUMN asset_assignee_id INTEGER REFERENCES asset_assignees(id) ON DELETE SET NULL");
  } catch { /* column already exists */ }
  try {
    _db.exec("ALTER TABLE inventory_assets ADD COLUMN location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL");
  } catch { /* column already exists */ }

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

export function getNetworks(): (NetworkWithStats & { router_id: number | null })[] {
  return getDb().prepare(`
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
  search?: string
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

  const total = (getDb().prepare(`SELECT COUNT(*) as cnt FROM networks n ${whereClause}`).get(...params) as { cnt: number }).cnt;

  const data = getDb().prepare(`
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
    ORDER BY n.name
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset) as (NetworkWithStats & { router_id: number | null })[];

  return { data, total };
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

  const total = (getDb().prepare(`SELECT COUNT(*) as cnt FROM network_devices ${whereClause}`).get(...params) as { cnt: number }).cnt;

  const data = getDb().prepare(`
    SELECT * FROM network_devices ${whereClause} ORDER BY name LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset) as NetworkDevice[];

  return { data, total };
}

export function getNetworkById(id: number): Network | undefined {
  return getDb().prepare("SELECT * FROM networks WHERE id = ?").get(id) as Network | undefined;
}

export function createNetwork(input: NetworkInput): Network {
  // Verifica overlap CIDR con reti esistenti
  const { cidrOverlaps } = require("./utils") as { cidrOverlaps: (a: string, b: string) => boolean };
  const existing = getDb().prepare("SELECT cidr FROM networks").all() as { cidr: string }[];
  for (const net of existing) {
    if (cidrOverlaps(input.cidr, net.cidr)) {
      throw new Error(`La rete ${input.cidr} si sovrappone alla rete esistente ${net.cidr}`);
    }
  }

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

/** Hosts con device associato in una sola query (evita N+1 getNetworkDeviceByHost) */
export function getHostsByNetworkWithDevices(networkId: number): (Host & { device_id?: number; device?: { id: number; name: string; sysname: string | null; vendor: string; protocol: string } })[] {
  const hosts = getDb().prepare(
    `SELECT h.*, nd.id as _dev_id, nd.name as _dev_name, nd.sysname as _dev_sysname, nd.vendor as _dev_vendor, nd.protocol as _dev_protocol
     FROM hosts h
     LEFT JOIN network_devices nd ON nd.host = h.ip
     WHERE h.network_id = ?`
  ).all(networkId) as (Host & { _dev_id?: number; _dev_name?: string; _dev_sysname?: string | null; _dev_vendor?: string; _dev_protocol?: string })[];

  return hosts
    .sort((a, b) => ipToNum(a.ip) - ipToNum(b.ip))
    .map(({ _dev_id, _dev_name, _dev_sysname, _dev_vendor, _dev_protocol, ...h }) => ({
      ...h,
      device_id: _dev_id ?? undefined,
      device: _dev_id ? { id: _dev_id, name: _dev_name!, sysname: _dev_sysname ?? null, vendor: _dev_vendor!, protocol: _dev_protocol! } : undefined,
    }));
}

/** Host conosciuti da monitorare (known_host = 1). Opzionale filtro per network_id. */
export function getKnownHosts(networkId?: number | null): Host[] {
  if (networkId != null) {
    return getDb().prepare("SELECT * FROM hosts WHERE known_host = 1 AND network_id = ?").all(networkId) as Host[];
  }
  return getDb().prepare("SELECT * FROM hosts WHERE known_host = 1").all() as Host[];
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

/** Resolve MAC to device info from hosts (IPAM), arp_entries e mac_ip_mapping, per switch port e tabella ARP */
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
  if (arp?.ip) {
    return { ip: arp.ip, hostname: null, vendor: null, host_id: null };
  }
  const mapping = getDb().prepare(
    "SELECT ip, hostname, vendor, host_id FROM mac_ip_mapping WHERE mac_normalized = ?"
  ).get(hex) as { ip: string; hostname: string | null; vendor: string | null; host_id: number | null } | undefined;
  return {
    ip: mapping?.ip ?? null,
    hostname: mapping?.hostname ?? null,
    vendor: mapping?.vendor ?? null,
    host_id: mapping?.host_id ?? null,
  };
}

export function getHostBasic(id: number): Pick<Host, "id" | "ip" | "custom_name" | "hostname"> | undefined {
  return getDb().prepare("SELECT id, ip, custom_name, hostname FROM hosts WHERE id = ?").get(id) as Pick<Host, "id" | "ip" | "custom_name" | "hostname"> | undefined;
}

export function getHostByIp(ip: string): Host | undefined {
  return getDb().prepare("SELECT * FROM hosts WHERE ip = ? LIMIT 1").get(ip) as Host | undefined;
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

  // Dispositivo gestito con stesso IP (es. WINRM, SSH, SNMP)
  const networkDevice = getNetworkDeviceByHost(host.ip);

  return {
    ...host,
    recent_scans: recentScans,
    arp_source: arpSource || null,
    switch_port: switchPort || null,
    network_device: networkDevice ? { id: networkDevice.id, name: networkDevice.name, sysname: networkDevice.sysname, vendor: networkDevice.vendor, protocol: networkDevice.protocol } : null,
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

export function upsertHost(input: HostInput & { mac?: string; vendor?: string; hostname?: string; hostname_source?: string; dns_forward?: string; dns_reverse?: string; status?: "online" | "offline" | "unknown"; open_ports?: string; os_info?: string; model?: string; serial_number?: string }): Host {
  const existing = getDb().prepare(
    "SELECT id FROM hosts WHERE network_id = ? AND ip = ?"
  ).get(input.network_id, input.ip) as { id: number } | undefined;

  if (existing) {
    const existingRow = getDb().prepare("SELECT open_ports, classification_manual FROM hosts WHERE id = ?").get(existing.id) as { open_ports: string | null; classification_manual?: number } | undefined;
    const classificationManual = existingRow?.classification_manual === 1;
    const fields: string[] = ["updated_at = datetime('now')"];
    const values: unknown[] = [];

    if (input.mac !== undefined) { fields.push("mac = ?"); values.push(input.mac); }
    if (input.vendor !== undefined) { fields.push("vendor = ?"); values.push(input.vendor); }
    if (input.hostname !== undefined) {
      const HOSTNAME_PRIORITY: Record<string, number> = { manual: 6, dhcp: 5, snmp: 4, nmap: 3, dns: 2, arp: 1 };
      const existingSource = (getDb().prepare("SELECT hostname_source FROM hosts WHERE id = ?").get(existing.id) as { hostname_source?: string })?.hostname_source;
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
    if (input.classification !== undefined && !classificationManual) { fields.push("classification = ?"); values.push(input.classification); }
    if (input.inventory_code !== undefined) { fields.push("inventory_code = ?"); values.push(input.inventory_code); }
    if (input.notes !== undefined) { fields.push("notes = ?"); values.push(input.notes); }
    if (input.open_ports !== undefined) {
      const merged = mergeOpenPorts(existingRow?.open_ports ?? null, input.open_ports);
      fields.push("open_ports = ?");
      values.push(merged);
    }
    if (input.os_info !== undefined) { fields.push("os_info = ?"); values.push(input.os_info); }
    if (input.model !== undefined) { fields.push("model = ?"); values.push(input.model); }
    if (input.serial_number !== undefined) { fields.push("serial_number = ?"); values.push(input.serial_number); }

    values.push(existing.id);
    getDb().prepare(`UPDATE hosts SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    const host = getDb().prepare("SELECT * FROM hosts WHERE id = ?").get(existing.id) as Host;
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
    // IP/MAC conflict detection
    if (input.mac && existing) {
      const duplicate = getDb().prepare(
        "SELECT id, ip FROM hosts WHERE network_id = ? AND mac = ? AND id != ?"
      ).get(input.network_id, input.mac, existing.id) as { id: number; ip: string } | undefined;
      if (duplicate) {
        getDb().prepare("UPDATE hosts SET conflict_flags = ? WHERE id = ?")
          .run(`mac_duplicate:${duplicate.ip}`, existing.id);
        getDb().prepare("UPDATE hosts SET conflict_flags = ? WHERE id = ?")
          .run(`mac_duplicate:${input.ip}`, duplicate.id);
      }
    }
    return host;
  }

  const stmt = getDb().prepare(`
    INSERT INTO hosts (network_id, ip, mac, vendor, hostname, hostname_source, dns_forward, dns_reverse, custom_name, classification, inventory_code, notes, status, open_ports, os_info, model, serial_number, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${input.status === "online" ? "datetime('now')" : "NULL"}, ${input.status === "online" ? "datetime('now')" : "NULL"})
  `);
  const result = stmt.run(
    input.network_id,
    input.ip,
    input.mac || null,
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
    (input as { serial_number?: string }).serial_number || null
  );
  const host = getDb().prepare("SELECT * FROM hosts WHERE id = ?").get(result.lastInsertRowid) as Host;
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
  if (input.mac !== undefined) { fields.push("mac = ?"); values.push(input.mac); }
  if (input.known_host !== undefined) { fields.push("known_host = ?"); values.push(input.known_host); }
  if (input.monitor_ports !== undefined) { fields.push("monitor_ports = ?"); values.push(input.monitor_ports); }
  if (input.status !== undefined) {
    fields.push("status = ?");
    values.push(input.status);
    if (input.status === "online") {
      fields.push("last_seen = datetime('now')");
    }
  }

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

export function getDevicesByClassification(classification: string): NetworkDevice[] {
  if (classification === "storage") {
    return getDb()
      .prepare("SELECT * FROM network_devices WHERE classification IN ('storage', 'nas', 'nas_synology', 'nas_qnap') ORDER BY name")
      .all() as NetworkDevice[];
  }
  return getDb()
    .prepare("SELECT * FROM network_devices WHERE classification = ? ORDER BY name")
    .all(classification) as NetworkDevice[];
}

/** Dispositivi per classificazione, includendo legacy (device_type senza classification) per router/switch */
export function getDevicesByClassificationOrLegacy(classification: string): NetworkDevice[] {
  if (classification === "router") {
    return getDb().prepare(
      "SELECT * FROM network_devices WHERE classification = 'router' OR (device_type = 'router' AND (classification IS NULL OR classification = '')) ORDER BY name"
    ).all() as NetworkDevice[];
  }
  if (classification === "switch") {
    return getDb().prepare(
      "SELECT * FROM network_devices WHERE classification = 'switch' OR (device_type = 'switch' AND (classification IS NULL OR classification = '')) ORDER BY name"
    ).all() as NetworkDevice[];
  }
  return getDevicesByClassification(classification);
}

/** Host con classificazione e nome rete (per lista dispositivi unificata) */
export function getHostsByClassification(classification: string): (Host & { network_name?: string })[] {
  if (classification === "storage") {
    return getDb()
      .prepare(
        `SELECT h.*, n.name as network_name FROM hosts h
         JOIN networks n ON n.id = h.network_id
         WHERE h.classification IN ('storage', 'nas', 'nas_synology', 'nas_qnap') ORDER BY h.custom_name, h.hostname, h.ip`
      )
      .all() as (Host & { network_name?: string })[];
  }
  return getDb()
    .prepare(
      `SELECT h.*, n.name as network_name FROM hosts h
       JOIN networks n ON n.id = h.network_id
       WHERE h.classification = ? ORDER BY h.custom_name, h.hostname, h.ip`
    )
    .all(classification) as (Host & { network_name?: string })[];
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

// ========================
// Credentials (riutilizzabili)
// ========================

export function getAllCredentials(): Credential[] {
  return getDb().prepare("SELECT * FROM credentials ORDER BY name").all() as Credential[];
}

export function getCredentialById(id: number): Credential | undefined {
  return getDb().prepare("SELECT * FROM credentials WHERE id = ?").get(id) as Credential | undefined;
}

export function createCredential(input: CredentialInput & { encrypted_username?: string | null; encrypted_password?: string | null }): Credential {
  const stmt = getDb().prepare(
    `INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password)
     VALUES (?, ?, ?, ?)`
  );
  const result = stmt.run(
    input.name,
    input.credential_type,
    input.encrypted_username ?? null,
    input.encrypted_password ?? null
  );
  return getDb().prepare("SELECT * FROM credentials WHERE id = ?").get(result.lastInsertRowid) as Credential;
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
  getDb().prepare(`UPDATE credentials SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getCredentialById(id);
}

export function deleteCredential(id: number): boolean {
  return getDb().prepare("DELETE FROM credentials WHERE id = ?").run(id).changes > 0;
}

/** Restituisce le credenziali host Windows (da settings host_windows_credential_id). Per WinRM/WMI. */
export function getHostWindowsCredentials(): { username: string; password: string } | null {
  const idStr = getSetting("host_windows_credential_id");
  if (!idStr?.trim()) return null;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return null;
  const cred = getCredentialById(id);
  if (!cred || String(cred.credential_type || "").toLowerCase() !== "windows") return null;
  try {
    const username = cred.encrypted_username ? decrypt(cred.encrypted_username) : "";
    const password = cred.encrypted_password ? decrypt(cred.encrypted_password) : "";
    if (username?.trim() && password?.trim()) return { username: username.trim(), password: password.trim() };
  } catch { /* ignore */ }
  return null;
}

/** Restituisce le credenziali host Linux (da settings host_linux_credential_id). Per SSH. */
export function getHostLinuxCredentials(): { username: string; password: string } | null {
  const idStr = getSetting("host_linux_credential_id");
  if (!idStr?.trim()) return null;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return null;
  const cred = getCredentialById(id);
  if (!cred || String(cred.credential_type || "").toLowerCase() !== "linux") return null;
  try {
    const username = cred.encrypted_username ? decrypt(cred.encrypted_username) : "";
    const password = cred.encrypted_password ? decrypt(cred.encrypted_password) : "";
    if (username?.trim() && password?.trim()) return { username: username.trim(), password: password.trim() };
  } catch { /* ignore */ }
  return null;
}

/** Restituisce la community string decifrata per una credenziale SNMP. */
export function getCredentialCommunityString(credentialId: number): string | null {
  const cred = getCredentialById(credentialId);
  if (!cred) return null;
  const type = String(cred.credential_type || "").toLowerCase();
  if (type !== "snmp") return null;
  const enc = cred.encrypted_password || cred.encrypted_username;
  if (!enc) return null;
  try {
    const s = decrypt(enc);
    return s && s.trim() ? s : null;
  } catch {
    return null;
  }
}

/** Restituisce le credenziali SNMP v3 per un device (user name + auth key). Per v3 serve credential con username e password. */
export function getDeviceSnmpV3Credentials(device: NetworkDevice): { username: string; authKey: string } | null {
  const credId = device.snmp_credential_id || device.credential_id;
  if (!credId) return null;
  const cred = getCredentialById(credId);
  if (!cred || String(cred.credential_type || "").toLowerCase() !== "snmp") return null;
  try {
    const username = cred.encrypted_username ? decrypt(cred.encrypted_username) : "";
    const authKey = cred.encrypted_password ? decrypt(cred.encrypted_password) : "";
    if (username?.trim() && authKey?.trim()) return { username: username.trim(), authKey: authKey.trim() };
  } catch { /* ignore */ }
  return null;
}

/** Restituisce la community string per un device: da snmp_credential_id, credential_id (se SNMP), community_string, o "public". */
export function getDeviceCommunityString(device: NetworkDevice): string {
  if (device.snmp_credential_id) {
    const fromCred = getCredentialCommunityString(device.snmp_credential_id);
    if (fromCred) return fromCred;
  }
  if (device.credential_id) {
    const fromCred = getCredentialCommunityString(device.credential_id);
    if (fromCred) return fromCred;
  }
  if (device.community_string) {
    try {
      const s = decrypt(device.community_string);
      if (s && s.trim()) return s;
    } catch {
      return typeof device.community_string === "string" ? device.community_string : "public";
    }
  }
  return "public";
}

/** Restituisce { username, password } per un device: da credential_id se presente, altrimenti da device */
export function getDeviceCredentials(device: NetworkDevice): { username: string; password: string } | null {
  if (device.credential_id) {
    const cred = getCredentialById(device.credential_id);
    if (cred?.encrypted_username && cred?.encrypted_password) {
      try {
        return {
          username: decrypt(cred.encrypted_username),
          password: decrypt(cred.encrypted_password),
        };
      } catch {
        return null;
      }
    }
  }
  if (device.username && device.encrypted_password) {
    try {
      return {
        username: device.username,
        password: decrypt(device.encrypted_password),
      };
    } catch {
      return null;
    }
  }
  return null;
}

// ========================
// Network Devices
// ========================

export function getNetworkDeviceById(id: number): NetworkDevice | undefined {
  return getDb().prepare("SELECT * FROM network_devices WHERE id = ?").get(id) as NetworkDevice | undefined;
}

export function getNetworkDeviceByHost(ip: string): NetworkDevice | undefined {
  return getDb().prepare("SELECT * FROM network_devices WHERE host = ?").get(ip) as NetworkDevice | undefined;
}

type CreateDeviceInput = Omit<NetworkDevice, "id" | "created_at" | "updated_at" | "sysname" | "sysdescr" | "model" | "firmware" | "serial_number" | "part_number" | "last_info_update" | "last_device_info_json" | "classification" | "stp_info" | "last_proxmox_scan_at" | "last_proxmox_scan_result" | "scan_target"> & { classification?: string | null; scan_target?: string | null };

export function createNetworkDevice(input: CreateDeviceInput): NetworkDevice {
  const stmt = getDb().prepare(
    `INSERT INTO network_devices (name, host, device_type, vendor, vendor_subtype, protocol, credential_id, snmp_credential_id, username, encrypted_password, community_string, api_token, api_url, port, enabled, classification)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    input.name, input.host, input.device_type, input.vendor,
    input.vendor_subtype ?? null, input.protocol,
    input.credential_id ?? null, (input as { snmp_credential_id?: number | null }).snmp_credential_id ?? null,
    input.username, input.encrypted_password,
    input.community_string, input.api_token, input.api_url, input.port, input.enabled,
    (input as { classification?: string | null }).classification ?? null
  );
  return getDb().prepare("SELECT * FROM network_devices WHERE id = ?").get(result.lastInsertRowid) as NetworkDevice;
}

export function updateNetworkDevice(id: number, input: Partial<Omit<NetworkDevice, "id" | "created_at" | "updated_at">>): NetworkDevice | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];

  const keys = ["name", "host", "device_type", "vendor", "vendor_subtype", "protocol", "credential_id", "snmp_credential_id", "username", "encrypted_password", "community_string", "api_token", "api_url", "port", "enabled", "classification", "sysname", "sysdescr", "model", "firmware", "serial_number", "part_number", "last_info_update", "last_device_info_json", "stp_info", "last_proxmox_scan_at", "last_proxmox_scan_result", "scan_target"] as const;
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

export function upsertArpEntries(
  deviceId: number,
  entries: { mac: string; ip: string | null; interface_name: string | null }[],
  getNetworkIdForIp?: (ip: string) => number | null
): void {
  const db = getDb();

  const stmt = db.prepare(
    `INSERT INTO arp_entries (device_id, host_id, mac, ip, interface_name)
     VALUES (?, (SELECT id FROM hosts WHERE ${MAC_HEX("mac")} = ? LIMIT 1), ?, ?, ?)`
  );

  const replaceAll = db.transaction((items: typeof entries) => {
    // DELETE dentro la transazione per garantire atomicità
    db.prepare("DELETE FROM arp_entries WHERE device_id = ?").run(deviceId);

    for (const entry of items) {
      const hex = macToHex(entry.mac);
      stmt.run(deviceId, hex, entry.mac, entry.ip, entry.interface_name);
      if (entry.ip && entry.mac) {
        const networkId = getNetworkIdForIp?.(entry.ip) ?? null;
        upsertMacIpMapping({
          mac: entry.mac,
          ip: entry.ip,
          source: "arp",
          source_device_id: deviceId,
          network_id: networkId,
        });
      }
    }
  });

  replaceAll(entries);
}

// ========================
// MAC-IP Mapping (cumulativo)
// ========================

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
  const db = getDb();
  const hex = macToHex(input.mac);
  const display = normalizeMac(input.mac);
  const now = new Date().toISOString();

  const existing = db.prepare(
    "SELECT id, ip, last_seen FROM mac_ip_mapping WHERE mac_normalized = ?"
  ).get(hex) as { id: number; ip: string; last_seen: string } | undefined;

  if (existing) {
    const ipChanged = existing.ip !== input.ip;
    db.prepare(`
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
      db.prepare(
        "INSERT INTO mac_ip_history (mac_normalized, ip, source) VALUES (?, ?, ?)"
      ).run(hex, input.ip, input.source);
    }
  } else {
    db.prepare(`
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
  source?: import("./db").MacIpMappingSource;
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
  return getDb().prepare(sql).all(...params) as import("@/types").MacIpMapping[];
}

// ========================
// Inventory Assets
// ========================

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
  return getDb().prepare("SELECT * FROM inventory_assets WHERE id = ?").get(id) as import("@/types").InventoryAsset | undefined;
}

export function getInventoryAssetByNetworkDevice(deviceId: number): import("@/types").InventoryAsset | undefined {
  return getDb().prepare("SELECT * FROM inventory_assets WHERE network_device_id = ?").get(deviceId) as import("@/types").InventoryAsset | undefined;
}

/** Crea automaticamente un asset in inventario per un network device, se non esiste già. */
export function ensureInventoryAssetForNetworkDevice(device: NetworkDevice): import("@/types").InventoryAsset {
  const existing = getInventoryAssetByNetworkDevice(device.id);
  if (existing) return existing;

  const categoria = mapClassificationToInventoryCategoria(device.classification, device.device_type);
  const marca = mapVendorToMarca(device.vendor);

  return createInventoryAsset({
    network_device_id: device.id,
    hostname: device.name,
    nome_prodotto: device.name,
    categoria,
    marca,
    modello: device.model ?? null,
    serial_number: device.serial_number ?? null,
    ip_address: device.host,
    firmware_version: device.firmware ?? null,
    stato: "Attivo",
  });
}

/** Estrae dati tecnici da last_proxmox_scan_result per popolare inventario */
function extractProxmoxTechData(
  lastResult: string | null
): Partial<import("@/types").InventoryAssetInput> & { technical_data?: string } {
  const out: Partial<import("@/types").InventoryAssetInput> & { technical_data?: string } = {};
  if (!lastResult?.trim()) return out;

  try {
    const parsed = JSON.parse(lastResult) as {
      hosts?: Array<{
        hostname?: string;
        cpu_model?: string;
        cpu_mhz?: number;
        cpu_sockets?: number;
        cpu_cores?: number;
        memory_total_gb?: number;
        proxmox_version?: string;
        kernel_version?: string;
        rootfs_total_gb?: number;
        hardware_serial?: string;
        hardware_model?: string;
        hardware_manufacturer?: string;
        subscription?: {
          status?: string;
          productname?: string;
          key?: string;
          nextduedate?: string;
          serverid?: string;
        };
        storage?: Array<{ total_gb?: number; used_gb?: number; type?: string }>;
      }>;
      vms?: unknown[];
      scanned_at?: string;
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
  } catch {
    /* ignore parse errors */
  }
  return out;
}

/** Aggiorna l'asset inventario collegato al device con i dati tecnici (SNMP, Proxmox, ecc.) */
export function syncInventoryFromDevice(device: NetworkDevice): import("@/types").InventoryAsset | null {
  const asset = getInventoryAssetByNetworkDevice(device.id);
  if (!asset) return null;

  const marca = mapVendorToMarca(device.vendor);
  const categoria = mapClassificationToInventoryCategoria(device.classification, device.device_type);

  const base: Partial<import("@/types").InventoryAssetInput> = {
    hostname: device.name,
    nome_prodotto: device.name,
    categoria: categoria ?? asset.categoria,
    marca: marca ?? asset.marca,
    modello: device.model ?? asset.modello,
    serial_number: device.serial_number ?? asset.serial_number,
    part_number: device.part_number ?? asset.part_number,
    ip_address: device.host,
    firmware_version: device.firmware ?? asset.firmware_version,
  };

  const dev = device as { last_proxmox_scan_result?: string | null };
  const proxmox = extractProxmoxTechData(dev.last_proxmox_scan_result ?? null);

  // Per device non-Proxmox: archivia sysname, sysdescr, model, firmware come technical_data
  let technicalData = proxmox.technical_data;
  if (!technicalData && (device.sysname || device.sysdescr || device.model || device.firmware)) {
    technicalData = JSON.stringify({
      source: "device",
      sysname: device.sysname,
      sysdescr: device.sysdescr,
      model: device.model,
      firmware: device.firmware,
      serial_number: device.serial_number,
      part_number: device.part_number,
      last_info_update: (device as { last_info_update?: string | null }).last_info_update,
    });
  }

  const merged: import("@/types").InventoryAssetInput = {
    ...base,
    ...proxmox,
    technical_data: technicalData ?? undefined,
  };

  const updated = updateInventoryAsset(asset.id, merged);
  return updated ?? null;
}

function mapClassificationToInventoryCategoria(classification: string | null, deviceType: string): import("@/types").InventoryAssetCategoria | null {
  const c = (classification ?? deviceType ?? "").toLowerCase();
  if (["firewall"].includes(c)) return "Firewall";
  if (["access_point"].includes(c)) return "Access Point";
  if (["router", "load_balancer", "vpn_gateway"].includes(c)) return "Router";
  if (["switch"].includes(c)) return "Switch";
  if (["server", "hypervisor"].includes(c)) return "Server";
  if (["nas", "nas_synology", "nas_qnap"].includes(c)) return "NAS";
  if (["stampante", "scanner", "fotocopiatrice", "multifunzione"].includes(c)) return "Stampante";
  return deviceType === "router" ? "Router" : "Switch";
}

function mapVendorToMarca(vendor: string): string | null {
  const v = vendor?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    mikrotik: "MikroTik",
    ubiquiti: "Ubiquiti",
    hp: "HP",
    cisco: "Cisco",
    omada: "TP-Link",
    stormshield: "Stormshield",
    proxmox: "Proxmox",
    vmware: "VMware",
    linux: "Linux",
    windows: "Windows",
  };
  return map[v] ?? null;
}

export function getInventoryAssetByHost(hostId: number): import("@/types").InventoryAsset | undefined {
  return getDb().prepare("SELECT * FROM inventory_assets WHERE host_id = ?").get(hostId) as import("@/types").InventoryAsset | undefined;
}

/** Mappa classification host → categoria inventario (workstation→Desktop, notebook→Laptop, ecc.) */
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

/** Crea automaticamente un asset in inventario per un host, se non esiste già. */
export function ensureInventoryAssetForHost(host: Host): import("@/types").InventoryAsset {
  const existing = getInventoryAssetByHost(host.id);
  if (existing) return existing;

  const categoria = mapHostClassificationToInventoryCategoria(host.classification ?? null);

  return createInventoryAsset({
    host_id: host.id,
    hostname: host.custom_name ?? host.hostname ?? host.ip,
    nome_prodotto: host.model ?? host.hostname ?? host.ip,
    categoria: categoria ?? "Other",
    marca: host.vendor ?? null,
    modello: host.model ?? null,
    serial_number: host.serial_number ?? null,
    ip_address: host.ip,
    mac_address: host.mac ?? null,
    sistema_operativo: host.os_info ?? null,
    stato: "Attivo",
  });
}

/** Aggiorna l'asset inventario collegato all'host con i dati da host (model, serial, IP, MAC, ecc.) */
export function syncInventoryFromHost(host: Host): import("@/types").InventoryAsset | null {
  const asset = getInventoryAssetByHost(host.id);
  if (!asset) return null;

  const categoria = mapHostClassificationToInventoryCategoria(host.classification ?? null) ?? asset.categoria;

  const merged: import("@/types").InventoryAssetInput = {
    hostname: host.custom_name ?? host.hostname ?? host.ip,
    nome_prodotto: host.model ?? host.hostname ?? asset.nome_prodotto,
    categoria,
    marca: host.vendor ?? asset.marca,
    modello: host.model ?? asset.modello,
    serial_number: host.serial_number ?? asset.serial_number,
    ip_address: host.ip,
    mac_address: host.mac ?? asset.mac_address,
    sistema_operativo: host.os_info ?? asset.sistema_operativo,
  };

  const updated = updateInventoryAsset(asset.id, merged);
  return updated ?? null;
}

export function getInventoryAssets(opts?: {
  network_device_id?: number;
  host_id?: number;
  stato?: string;
  categoria?: string;
  q?: string;
  limit?: number;
}): (import("@/types").InventoryAsset & { network_device_name?: string; host_ip?: string })[]
{
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
  return getDb().prepare(sql).all(...params) as (import("@/types").InventoryAsset & { network_device_name?: string; host_ip?: string })[];
}

export function createInventoryAsset(input: import("@/types").InventoryAssetInput): import("@/types").InventoryAsset {
  const assetId = randomUUID();
  const cols = ["asset_id", ...INVENTORY_COLUMNS.slice(1)];
  const placeholders = cols.map(() => "?").join(", ");
  const values = [
    assetId,
    input.asset_tag ?? null,
    input.serial_number ?? null,
    input.network_device_id ?? null,
    input.host_id ?? null,
    input.hostname ?? null,
    input.nome_prodotto ?? null,
    input.categoria ?? null,
    input.marca ?? null,
    input.modello ?? null,
    input.part_number ?? null,
    input.sede ?? null,
    input.reparto ?? null,
    input.utente_assegnatario_id ?? null,
    input.asset_assignee_id ?? null,
    input.location_id ?? null,
    input.posizione_fisica ?? null,
    input.data_assegnazione ?? null,
    input.data_acquisto ?? null,
    input.data_installazione ?? null,
    input.data_dismissione ?? null,
    input.stato ?? null,
    input.fine_garanzia ?? null,
    input.fine_supporto ?? null,
    input.vita_utile_prevista ?? null,
    input.sistema_operativo ?? null,
    input.versione_os ?? null,
    input.cpu ?? null,
    input.ram_gb ?? null,
    input.storage_gb ?? null,
    input.storage_tipo ?? null,
    input.mac_address ?? null,
    input.ip_address ?? null,
    input.vlan ?? null,
    input.firmware_version ?? null,
    input.prezzo_acquisto ?? null,
    input.fornitore ?? null,
    input.numero_ordine ?? null,
    input.numero_fattura ?? null,
    input.valore_attuale ?? null,
    input.metodo_ammortamento ?? null,
    input.centro_di_costo ?? null,
    input.crittografia_disco ?? 0,
    input.antivirus ?? null,
    input.gestito_da_mdr ?? 0,
    input.classificazione_dati ?? null,
    input.in_scope_gdpr ?? 0,
    input.in_scope_nis2 ?? 0,
    input.ultimo_audit ?? null,
    input.contratto_supporto ?? null,
    input.tipo_garanzia ?? null,
    input.contatto_supporto ?? null,
    input.ultimo_intervento ?? null,
    input.prossima_manutenzione ?? null,
    input.note_tecniche ?? null,
    input.technical_data ?? null,
  ];
  const result = getDb().prepare(`INSERT INTO inventory_assets (${cols.join(", ")}) VALUES (${placeholders})`).run(...values);
  const newId = result.lastInsertRowid as number;
  return getDb().prepare("SELECT * FROM inventory_assets WHERE id = ?").get(newId) as import("@/types").InventoryAsset;
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
  getDb().prepare(`UPDATE inventory_assets SET ${fields.join(", ")} WHERE id = ?`).run(...values);

  // Audit log per GDPR/NIS2
  if (auditUserId != null) {
    for (const col of INVENTORY_COLUMNS) {
      const key = col as keyof import("@/types").InventoryAssetInput;
      if (input[key] !== undefined) {
        const oldVal = (oldAsset as unknown as Record<string, unknown>)[key];
        const newVal = input[key];
        const oldStr = oldVal != null ? String(oldVal) : null;
        const newStr = newVal != null ? String(newVal) : null;
        if (oldStr !== newStr) {
          getDb().prepare(
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
    getDb().prepare(
      "INSERT INTO inventory_audit_log (asset_id, user_id, action) VALUES (?, ?, 'delete')"
    ).run(id, auditUserId);
  }
  return getDb().prepare("DELETE FROM inventory_assets WHERE id = ?").run(id).changes > 0;
}

// ========================
// Asset Assignees
// ========================

export function getAssetAssignees(): import("@/types").AssetAssignee[] {
  return getDb().prepare("SELECT * FROM asset_assignees ORDER BY name").all() as import("@/types").AssetAssignee[];
}

export function getAssetAssigneeById(id: number): import("@/types").AssetAssignee | undefined {
  return getDb().prepare("SELECT * FROM asset_assignees WHERE id = ?").get(id) as import("@/types").AssetAssignee | undefined;
}

export function createAssetAssignee(input: { name: string; email?: string | null; phone?: string | null; note?: string | null }): import("@/types").AssetAssignee {
  const result = getDb().prepare(
    "INSERT INTO asset_assignees (name, email, phone, note) VALUES (?, ?, ?, ?)"
  ).run(input.name, input.email ?? null, input.phone ?? null, input.note ?? null);
  return getDb().prepare("SELECT * FROM asset_assignees WHERE id = ?").get(result.lastInsertRowid) as import("@/types").AssetAssignee;
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
  getDb().prepare(`UPDATE asset_assignees SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getAssetAssigneeById(id);
}

export function deleteAssetAssignee(id: number): boolean {
  return getDb().prepare("DELETE FROM asset_assignees WHERE id = ?").run(id).changes > 0;
}

// ========================
// Locations
// ========================

export function getLocations(): import("@/types").Location[] {
  return getDb().prepare("SELECT * FROM locations ORDER BY name").all() as import("@/types").Location[];
}

export function getLocationById(id: number): import("@/types").Location | undefined {
  return getDb().prepare("SELECT * FROM locations WHERE id = ?").get(id) as import("@/types").Location | undefined;
}

export function createLocation(input: { name: string; parent_id?: number | null; address?: string | null }): import("@/types").Location {
  const result = getDb().prepare(
    "INSERT INTO locations (name, parent_id, address) VALUES (?, ?, ?)"
  ).run(input.name, input.parent_id ?? null, input.address ?? null);
  return getDb().prepare("SELECT * FROM locations WHERE id = ?").get(result.lastInsertRowid) as import("@/types").Location;
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
  getDb().prepare(`UPDATE locations SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getLocationById(id);
}

export function deleteLocation(id: number): boolean {
  return getDb().prepare("DELETE FROM locations WHERE id = ?").run(id).changes > 0;
}

// ========================
// Licenses
// ========================

export function getLicenses(): (import("@/types").License & { used_seats?: number; free_seats?: number })[] {
  const rows = getDb().prepare(`
    SELECT l.*, COALESCE(ls.cnt, 0) as used_seats
    FROM licenses l
    LEFT JOIN (SELECT license_id, COUNT(*) as cnt FROM license_seats GROUP BY license_id) ls
      ON ls.license_id = l.id
    ORDER BY l.name
  `).all() as (import("@/types").License & { used_seats: number })[];
  return rows.map((row) => {
    const used = row.used_seats || 0;
    return { ...row, used_seats: used, free_seats: Math.max(0, row.seats - used) };
  });
}

export function getLicenseById(id: number): (import("@/types").License & { used_seats?: number; free_seats?: number }) | undefined {
  const row = getDb().prepare(`
    SELECT l.*, COALESCE(ls.cnt, 0) as used_seats
    FROM licenses l
    LEFT JOIN (SELECT license_id, COUNT(*) as cnt FROM license_seats WHERE license_id = ? GROUP BY license_id) ls
      ON ls.license_id = l.id
    WHERE l.id = ?
  `).get(id, id) as (import("@/types").License & { used_seats: number }) | undefined;
  if (!row) return undefined;
  const used = row.used_seats || 0;
  return { ...row, used_seats: used, free_seats: Math.max(0, row.seats - used) };
}

export function createLicense(input: {
  name: string;
  serial?: string | null;
  seats?: number;
  category?: string | null;
  expiration_date?: string | null;
  purchase_cost?: number | null;
  min_amt?: number;
  fornitore?: string | null;
  note?: string | null;
}): import("@/types").License {
  const result = getDb().prepare(
    "INSERT INTO licenses (name, serial, seats, category, expiration_date, purchase_cost, min_amt, fornitore, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    input.name,
    input.serial ?? null,
    input.seats ?? 1,
    input.category ?? null,
    input.expiration_date ?? null,
    input.purchase_cost ?? null,
    input.min_amt ?? 0,
    input.fornitore ?? null,
    input.note ?? null
  );
  return getDb().prepare("SELECT * FROM licenses WHERE id = ?").get(result.lastInsertRowid) as import("@/types").License;
}

export function updateLicense(id: number, input: Partial<Omit<import("@/types").License, "id" | "created_at" | "updated_at">>): import("@/types").License | undefined {
  const keys = ["name", "serial", "seats", "category", "expiration_date", "purchase_cost", "min_amt", "fornitore", "note"] as const;
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const k of keys) {
    if (input[k] !== undefined) {
      fields.push(`${k} = ?`);
      values.push(input[k]);
    }
  }
  if (fields.length === 0) return getLicenseById(id) as import("@/types").License | undefined;
  fields.push("updated_at = datetime('now')");
  values.push(id);
  getDb().prepare(`UPDATE licenses SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getDb().prepare("SELECT * FROM licenses WHERE id = ?").get(id) as import("@/types").License;
}

export function deleteLicense(id: number): boolean {
  getDb().prepare("DELETE FROM license_seats WHERE license_id = ?").run(id);
  return getDb().prepare("DELETE FROM licenses WHERE id = ?").run(id).changes > 0;
}

// ========================
// License Seats
// ========================

export function getLicenseSeatsByLicense(licenseId: number): import("@/types").LicenseSeat[] {
  return getDb().prepare("SELECT * FROM license_seats WHERE license_id = ? ORDER BY assigned_at DESC").all(licenseId) as import("@/types").LicenseSeat[];
}

export function getLicenseSeatsByAsset(assetType: "inventory_asset" | "host", assetId: number): (import("@/types").LicenseSeat & { license_name?: string })[] {
  return getDb().prepare(`
    SELECT ls.*, l.name as license_name FROM license_seats ls
    JOIN licenses l ON l.id = ls.license_id
    WHERE ls.asset_type = ? AND ls.asset_id = ?
  `).all(assetType, assetId) as (import("@/types").LicenseSeat & { license_name?: string })[];
}

export function assignLicenseSeat(licenseId: number, assetType: "inventory_asset" | "host", assetId: number, note?: string | null): import("@/types").LicenseSeat | undefined {
  const lic = getLicenseById(licenseId);
  if (!lic || (lic.free_seats ?? 0) < 1) return undefined;
  const result = getDb().prepare(
    "INSERT INTO license_seats (license_id, asset_type, asset_id, note) VALUES (?, ?, ?, ?)"
  ).run(licenseId, assetType, assetId, note ?? null);
  return getDb().prepare("SELECT * FROM license_seats WHERE id = ?").get(result.lastInsertRowid) as import("@/types").LicenseSeat;
}

export function assignLicenseSeatToAssignee(licenseId: number, assetAssigneeId: number, note?: string | null): import("@/types").LicenseSeat | undefined {
  const lic = getLicenseById(licenseId);
  if (!lic || (lic.free_seats ?? 0) < 1) return undefined;
  const result = getDb().prepare(
    "INSERT INTO license_seats (license_id, asset_assignee_id, note) VALUES (?, ?, ?)"
  ).run(licenseId, assetAssigneeId, note ?? null);
  return getDb().prepare("SELECT * FROM license_seats WHERE id = ?").get(result.lastInsertRowid) as import("@/types").LicenseSeat;
}

export function unassignLicenseSeat(seatId: number): boolean {
  return getDb().prepare("DELETE FROM license_seats WHERE id = ?").run(seatId).changes > 0;
}

// ========================
// Inventory Audit Log
// ========================

export function getInventoryAuditLog(assetId: number, limit = 50): import("@/types").InventoryAuditLog[] {
  return getDb().prepare(
    "SELECT * FROM inventory_audit_log WHERE asset_id = ? ORDER BY created_at DESC LIMIT ?"
  ).all(assetId, limit) as import("@/types").InventoryAuditLog[];
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
    `INSERT INTO switch_ports (device_id, port_index, port_name, status, speed, duplex, vlan, poe_status, poe_power_mw, mac_count, is_trunk, single_mac, single_mac_vendor, single_mac_ip, single_mac_hostname, host_id, trunk_neighbor_name, trunk_neighbor_port, trunk_primary_device_id, trunk_primary_name, stp_state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const insertMany = db.transaction((items: typeof ports) => {
    for (const p of items) {
      stmt.run(deviceId, p.port_index, p.port_name, p.status, p.speed, p.duplex, p.vlan, p.poe_status, p.poe_power_mw, p.mac_count, p.is_trunk, p.single_mac, p.single_mac_vendor, p.single_mac_ip, p.single_mac_hostname, p.host_id ?? null, p.trunk_neighbor_name ?? null, p.trunk_neighbor_port ?? null, p.trunk_primary_device_id ?? null, p.trunk_primary_name ?? null, p.stp_state ?? null);
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

export function addStatusHistory(hostId: number, status: "online" | "offline", responseTimeMs?: number | null): void {
  getDb().prepare(
    "INSERT INTO status_history (host_id, status, response_time_ms) VALUES (?, ?, ?)"
  ).run(hostId, status, responseTimeMs ?? null);
}

export function getStatusHistory(hostId: number, limit: number = 100): StatusHistory[] {
  return getDb().prepare(
    "SELECT * FROM status_history WHERE host_id = ? ORDER BY checked_at DESC LIMIT ?"
  ).all(hostId, limit) as StatusHistory[];
}

export function getHostLatencyHistory(hostId: number, hours: number = 24): { time: string; response_time_ms: number | null; status: string }[] {
  return getDb().prepare(`
    SELECT strftime('%Y-%m-%dT%H:%M:00', checked_at) as time, response_time_ms, status
    FROM status_history
    WHERE host_id = ? AND checked_at >= datetime('now', '-' || ? || ' hours')
    ORDER BY checked_at ASC
  `).all(hostId, hours) as { time: string; response_time_ms: number | null; status: string }[];
}

// ========================
// Monitoring Stats
// ========================

export function getKnownHostStats(): { total: number; online: number; offline: number; avg_latency: number | null } {
  return getDb().prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) as online,
      SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END) as offline,
      AVG(last_response_time_ms) as avg_latency
    FROM hosts WHERE known_host = 1
  `).get() as { total: number; online: number; offline: number; avg_latency: number | null };
}

export function getOfflineKnownHosts(): { id: number; ip: string; hostname: string | null; custom_name: string | null; last_seen: string | null }[] {
  return getDb().prepare(`
    SELECT id, ip, hostname, custom_name, last_seen
    FROM hosts WHERE known_host = 1 AND status = 'offline'
    ORDER BY last_seen DESC LIMIT 20
  `).all() as { id: number; ip: string; hostname: string | null; custom_name: string | null; last_seen: string | null }[];
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

export function getUsers(): Omit<User, "password_hash">[] {
  return getDb().prepare("SELECT id, username, role, created_at, last_login FROM users ORDER BY username").all() as Omit<User, "password_hash">[];
}

export function getUserById(id: number): User | undefined {
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as User | undefined;
}

export function updateUserRole(userId: number, role: "admin" | "viewer"): boolean {
  return getDb().prepare("UPDATE users SET role = ? WHERE id = ?").run(role, userId).changes > 0;
}

export function deleteUser(userId: number): boolean {
  // Non permettere eliminazione dell'ultimo admin
  const admins = getDb().prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get() as { c: number };
  const user = getDb().prepare("SELECT role FROM users WHERE id = ?").get(userId) as { role: string } | undefined;
  if (user?.role === "admin" && admins.c <= 1) {
    throw new Error("Impossibile eliminare l'ultimo amministratore");
  }
  return getDb().prepare("DELETE FROM users WHERE id = ?").run(userId).changes > 0;
}

/** Reset all networks and devices for new client. Keeps users, settings, nmap_profiles. */
export function resetConfiguration(): void {
  const db = getDb();
  db.exec(`
    DELETE FROM networks;
    DELETE FROM network_devices;
  `);
}

// ========================
// Proxmox Hosts
// ========================

export function getProxmoxHosts(): import("@/types").ProxmoxHost[] {
  return getDb().prepare("SELECT * FROM proxmox_hosts ORDER BY name").all() as import("@/types").ProxmoxHost[];
}

export function getProxmoxHostById(id: number): import("@/types").ProxmoxHost | undefined {
  return getDb().prepare("SELECT * FROM proxmox_hosts WHERE id = ?").get(id) as import("@/types").ProxmoxHost | undefined;
}

export function createProxmoxHost(input: {
  name: string;
  host: string;
  port?: number;
  credential_id?: number | null;
}): import("@/types").ProxmoxHost {
  const result = getDb().prepare(
    "INSERT INTO proxmox_hosts (name, host, port, credential_id) VALUES (?, ?, ?, ?)"
  ).run(
    input.name,
    input.host,
    input.port ?? 8006,
    input.credential_id ?? null
  );
  return getDb().prepare("SELECT * FROM proxmox_hosts WHERE id = ?").get(result.lastInsertRowid) as import("@/types").ProxmoxHost;
}

export function updateProxmoxHost(id: number, input: {
  name?: string;
  host?: string;
  port?: number;
  credential_id?: number | null;
  enabled?: number;
}): import("@/types").ProxmoxHost | undefined {
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
  getDb().prepare(`UPDATE proxmox_hosts SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getProxmoxHostById(id);
}

export function updateProxmoxHostScanResult(id: number, resultJson: string): void {
  getDb().prepare(
    "UPDATE proxmox_hosts SET last_scan_at = datetime('now'), last_scan_result = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(resultJson, id);
}

export function deleteProxmoxHost(id: number): boolean {
  return getDb().prepare("DELETE FROM proxmox_hosts WHERE id = ?").run(id).changes > 0;
}

// ========================
// Device-to-Host Sync
// ========================

/** Sincronizza info del device sull'host collegato (stesso IP). */
export function syncDeviceToHost(deviceId: number): void {
  const device = getNetworkDeviceById(deviceId);
  if (!device) return;

  const host = getDb().prepare("SELECT id, network_id FROM hosts WHERE ip = ? LIMIT 1").get(device.host) as { id: number; network_id: number } | undefined;
  if (!host) return;

  const updates: string[] = ["updated_at = datetime('now')"];
  const values: unknown[] = [];

  if (device.model) { updates.push("model = ?"); values.push(device.model); }
  if (device.serial_number) { updates.push("serial_number = ?"); values.push(device.serial_number); }
  if (device.sysname && !device.sysname.match(/^[\d.]+$/)) {
    // Sync sysname come hostname con source "snmp" (solo se non è solo un IP)
    updates.push("hostname = ?"); values.push(device.sysname);
    updates.push("hostname_source = ?"); values.push("snmp");
  }
  if (device.sysdescr) { updates.push("os_info = ?"); values.push(device.sysdescr); }

  if (values.length > 0) {
    values.push(host.id);
    getDb().prepare(`UPDATE hosts SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  }
}

/** Traccia cambiamenti device info. Ritorna lista campi modificati. */
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
    // Log in scan_history come tipo 'snmp' (il più vicino a device info change)
    const hostRow = getDb().prepare("SELECT id FROM hosts WHERE ip = ? LIMIT 1").get(device.host) as { id: number } | undefined;
    getDb().prepare(
      "INSERT INTO scan_history (host_id, network_id, scan_type, status, raw_output, duration_ms) VALUES (?, NULL, 'snmp', ?, ?, 0)"
    ).run(
      hostRow?.id ?? null,
      `device_info_changed: ${changes.join(", ")}`,
      JSON.stringify({ device_id: deviceId, device_name: device.name, changes: changes.map(f => ({ field: f, old: String(oldInfo[f] ?? ""), new: String(newInfo[f] ?? "") })) })
    );
  }

  return changes;
}
