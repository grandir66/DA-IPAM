import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { SCHEMA_SQL } from "./db-schema";
import { macToHex, normalizeMac, normalizeMacForStorage } from "./utils";
import { decrypt } from "./crypto";
import { randomUUID } from "crypto";
import { inferIpAssignment, resolveAdDhcpLeaseForHost, resolveDhcpLeaseForHost } from "./ip-assignment";

/** Convert IPv4 string to numeric value for sorting */
function ipToNum(ip: string): number {
  const p = ip.split(".").map(Number);
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}
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
  User,
  NetworkInput,
  HostInput,
  HostUpdate,
  ScheduledJobInput,
  CredentialInput,
} from "@/types";
import type { FingerprintUserRule } from "./device-fingerprint-classification";

const DATA_DIR = path.join(process.cwd(), "data");
/** Path effettivo del DB. `DA_IPAM_DB_PATH` serve solo a `scripts/generate-empty-db.ts` (template versionato). */
const DB_PATH = process.env.DA_IPAM_DB_PATH?.trim()
  ? path.resolve(process.env.DA_IPAM_DB_PATH.trim())
  : path.join(DATA_DIR, "ipam.db");

let _db: Database.Database | null = null;

/** Verifica colonna su tabella (migrazioni più affidabili del solo try/catch su ALTER). */
function tableHasColumn(db: Database.Database, table: string, column: string): boolean {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return rows.some((r) => r.name === column);
  } catch {
    return false;
  }
}

/** Aggiunge colonna se assente (DB vecchi / template copiati prima di una migrazione). */
function ensureNetworkDevicesColumn(db: Database.Database, column: string, ddl: string): void {
  if (!tableHasColumn(db, "network_devices", column)) {
    db.exec(ddl);
  }
}

/** Chiude la connessione (solo script di manutenzione / generazione `ipam.empty.db`). */
export function closeDb(): void {
  if (_db) {
    try {
      _db.close();
    } catch {
      /* ignore */
    }
    _db = null;
  }
}

export function getDb(): Database.Database {
  if (_db) return _db;

  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Prima installazione: copia dal template vuoto nel repo (mai committare ipam.db con dati reali).
  if (!process.env.DA_IPAM_DB_PATH?.trim() && !fs.existsSync(DB_PATH)) {
    const template = path.join(DATA_DIR, "ipam.empty.db");
    if (fs.existsSync(template)) {
      fs.copyFileSync(template, DB_PATH);
    }
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
    _db.exec("ALTER TABLE nmap_profiles ADD COLUMN tcp_ports TEXT");
  } catch { /* column already exists */ }
  try {
    _db.exec("ALTER TABLE nmap_profiles ADD COLUMN udp_ports TEXT");
  } catch { /* column already exists */ }
  try {
    _db.exec("ALTER TABLE hosts ADD COLUMN firmware TEXT");
  } catch { /* column already exists */ }
  try {
    _db.exec("ALTER TABLE hosts ADD COLUMN device_manufacturer TEXT");
  } catch { /* column already exists */ }
  try {
    _db.exec("ALTER TABLE hosts ADD COLUMN snmp_data TEXT");
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
    _db.exec("ALTER TABLE hosts ADD COLUMN detection_json TEXT");
  } catch { /* column already exists */ }
  try {
    _db.exec("ALTER TABLE hosts ADD COLUMN ip_assignment TEXT DEFAULT 'unknown'");
  } catch { /* column already exists */ }
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
  // Migrazione: scan_type include 'network_discovery'
  {
    const schema = _db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scan_history'").get() as { sql: string } | undefined;
    if (schema?.sql && !schema.sql.includes("'network_discovery'")) {
      _db.pragma("foreign_keys = OFF");
      try {
        _db.exec("DROP TABLE IF EXISTS scan_history_v4");
        _db.exec(`CREATE TABLE scan_history_v4 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          host_id INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
          network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
          scan_type TEXT NOT NULL CHECK(scan_type IN ('ping', 'snmp', 'nmap', 'arp', 'dns', 'windows', 'ssh', 'network_discovery')),
          status TEXT NOT NULL,
          ports_open TEXT,
          raw_output TEXT,
          duration_ms INTEGER,
          timestamp TEXT DEFAULT (datetime('now'))
        )`);
        _db.exec("INSERT INTO scan_history_v4 SELECT * FROM scan_history");
        _db.exec("DROP TABLE scan_history");
        _db.exec("ALTER TABLE scan_history_v4 RENAME TO scan_history");
        _db.exec("CREATE INDEX IF NOT EXISTS idx_scan_history_host ON scan_history(host_id)");
        _db.exec("CREATE INDEX IF NOT EXISTS idx_scan_history_network ON scan_history(network_id)");
      } catch {
        /* already migrated */
      }
      _db.pragma("foreign_keys = ON");
    }
  }
  // Migrazione: scan_type include 'credential_validate'
  {
    const schema = _db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scan_history'").get() as { sql: string } | undefined;
    if (schema?.sql && !schema.sql.includes("'credential_validate'")) {
      _db.pragma("foreign_keys = OFF");
      try {
        _db.exec("DROP TABLE IF EXISTS scan_history_v5");
        _db.exec(`CREATE TABLE scan_history_v5 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          host_id INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
          network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
          scan_type TEXT NOT NULL CHECK(scan_type IN ('ping', 'snmp', 'nmap', 'arp', 'dns', 'windows', 'ssh', 'network_discovery', 'credential_validate')),
          status TEXT NOT NULL,
          ports_open TEXT,
          raw_output TEXT,
          duration_ms INTEGER,
          timestamp TEXT DEFAULT (datetime('now'))
        )`);
        _db.exec("INSERT INTO scan_history_v5 SELECT * FROM scan_history");
        _db.exec("DROP TABLE scan_history");
        _db.exec("ALTER TABLE scan_history_v5 RENAME TO scan_history");
        _db.exec("CREATE INDEX IF NOT EXISTS idx_scan_history_host ON scan_history(host_id)");
        _db.exec("CREATE INDEX IF NOT EXISTS idx_scan_history_network ON scan_history(network_id)");
      } catch {
        /* already migrated */
      }
      _db.pragma("foreign_keys = ON");
    }
  }
  try {
    _db.exec(`CREATE TABLE IF NOT EXISTS network_host_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      network_id INTEGER NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
      credential_id INTEGER NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('windows', 'linux', 'ssh', 'snmp')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      UNIQUE(network_id, credential_id, role)
    )`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_network_host_credentials_net_role ON network_host_credentials(network_id, role)`);
  } catch { /* already exists */ }
  try {
    _db.exec(`CREATE TABLE IF NOT EXISTS host_detect_credential (
      host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('windows', 'linux', 'ssh', 'snmp')),
      credential_id INTEGER NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (host_id, role)
    )`);
  } catch { /* already exists */ }
  try {
    const nhc = _db
      .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='network_host_credentials'`)
      .get() as { sql: string } | undefined;
    if (nhc?.sql && !nhc.sql.includes("'ssh'")) {
      _db.pragma("foreign_keys = OFF");
      _db.exec(`CREATE TABLE network_host_credentials_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        network_id INTEGER NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
        credential_id INTEGER NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('windows', 'linux', 'ssh', 'snmp')),
        sort_order INTEGER NOT NULL DEFAULT 0,
        UNIQUE(network_id, credential_id, role)
      )`);
      _db.exec(`INSERT INTO network_host_credentials_new SELECT * FROM network_host_credentials`);
      _db.exec(`DROP TABLE network_host_credentials`);
      _db.exec(`ALTER TABLE network_host_credentials_new RENAME TO network_host_credentials`);
      _db.exec(`CREATE INDEX IF NOT EXISTS idx_network_host_credentials_net_role ON network_host_credentials(network_id, role)`);
      _db.pragma("foreign_keys = ON");
    }
  } catch {
    /* migration skipped or already applied */
  }
  try {
    const hdc = _db
      .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='host_detect_credential'`)
      .get() as { sql: string } | undefined;
    if (hdc?.sql && !hdc.sql.includes("'snmp'")) {
      _db.pragma("foreign_keys = OFF");
      _db.exec(`CREATE TABLE host_detect_credential_new (
        host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('windows', 'linux', 'ssh', 'snmp')),
        credential_id INTEGER NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (host_id, role)
      )`);
      _db.exec(`INSERT INTO host_detect_credential_new SELECT * FROM host_detect_credential`);
      _db.exec(`DROP TABLE host_detect_credential`);
      _db.exec(`ALTER TABLE host_detect_credential_new RENAME TO host_detect_credential`);
      _db.pragma("foreign_keys = ON");
    }
  } catch {
    /* migration skipped or already applied */
  }
  try {
    _db.exec(`CREATE TABLE IF NOT EXISTS fingerprint_classification_map (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_kind TEXT NOT NULL CHECK(match_kind IN ('exact','contains')),
      pattern TEXT NOT NULL,
      classification TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 100,
      enabled INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(match_kind, pattern)
    )`);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_fingerprint_class_map_pri ON fingerprint_classification_map(enabled, priority ASC, id ASC)`
    );
  } catch {
    /* */
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
      {
        const srcInfo = _db.prepare("PRAGMA table_info(network_devices)").all() as { name: string }[];
        const srcCols = srcInfo.map((r) => r.name);
        const dstInfo = _db.prepare("PRAGMA table_info(network_devices_vendor_new)").all() as { name: string }[];
        const dstCols = new Set(dstInfo.map((r) => r.name));
        const common = srcCols.filter((c) => dstCols.has(c)).join(", ");
        _db.exec(`INSERT INTO network_devices_vendor_new (${common}) SELECT ${common} FROM network_devices`);
      }
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

  // Migrazione: rimuovi vecchi profili nmap default (Quick, Standard, Completo) — ora c'è un solo profilo editabile
  try {
    _db.exec("DELETE FROM nmap_profiles WHERE name IN ('Quick', 'Standard', 'Completo') AND is_default = 1");
  } catch { /* table might not exist yet */ }

  _db.exec(SCHEMA_SQL);

  // DB esistenti senza colonne aggiunte in release successive: ALTER puro può fallire in modo silenzioso con try/catch.
  ensureNetworkDevicesColumn(_db, "product_profile", "ALTER TABLE network_devices ADD COLUMN product_profile TEXT");
  ensureNetworkDevicesColumn(_db, "scan_target", "ALTER TABLE network_devices ADD COLUMN scan_target TEXT");

  // Colonne hosts aggiunte in migrazioni pre-SCHEMA: su DB nuovi la tabella non esisteva e l'ALTER veniva ignorato.
  // Ripetizione idempotente dopo CREATE TABLE garantisce schema allineato (build/prerender inclusi).
  try {
    _db.exec("ALTER TABLE hosts ADD COLUMN known_host INTEGER DEFAULT 0");
  } catch {
    /* exists */
  }
  try {
    _db.exec("ALTER TABLE hosts ADD COLUMN classification_manual INTEGER DEFAULT 0");
  } catch {
    /* exists */
  }
  try {
    _db.exec("ALTER TABLE hosts ADD COLUMN last_response_time_ms INTEGER");
  } catch {
    /* exists */
  }
  try {
    _db.exec("ALTER TABLE hosts ADD COLUMN monitor_ports TEXT");
  } catch {
    /* exists */
  }
  try {
    _db.exec("ALTER TABLE hosts ADD COLUMN hostname_source TEXT");
  } catch {
    /* exists */
  }
  try {
    _db.exec("ALTER TABLE hosts ADD COLUMN conflict_flags TEXT");
  } catch {
    /* exists */
  }
  try {
    _db.exec("ALTER TABLE hosts ADD COLUMN ip_assignment TEXT DEFAULT 'unknown'");
  } catch {
    /* exists */
  }

  try {
    const row = _db.prepare("SELECT value FROM settings WHERE key = 'onboarding_completed'").get() as { value: string } | undefined;
    if (!row) {
      const n = (_db.prepare("SELECT COUNT(*) as c FROM networks").get() as { c: number }).c;
      const d = (_db.prepare("SELECT COUNT(*) as c FROM network_devices").get() as { c: number }).c;
      const v = n > 0 || d > 0 ? "1" : "0";
      _db.prepare("INSERT INTO settings (key, value) VALUES ('onboarding_completed', ?)").run(v);
    }
  } catch {
    /* ignore */
  }

  try {
    _db.exec("CREATE INDEX IF NOT EXISTS idx_network_devices_product_profile ON network_devices(product_profile)");
  } catch { /* */ }
  try {
    _db.exec(`
      UPDATE network_devices SET product_profile = CASE
        WHEN vendor = 'mikrotik' AND device_type = 'router' THEN 'mikrotik_router'
        WHEN vendor = 'mikrotik' THEN 'mikrotik_switch'
        WHEN vendor = 'ubiquiti' THEN 'ubiquiti_switch_managed'
        WHEN vendor = 'windows' THEN 'windows_client'
        WHEN vendor = 'linux' THEN 'linux_server'
        WHEN vendor = 'proxmox' AND device_type = 'hypervisor' THEN 'proxmox_ve'
        WHEN vendor = 'proxmox' THEN 'proxmox_pbs'
        WHEN vendor = 'synology' THEN 'synology_storage'
        WHEN vendor = 'qnap' AND device_type = 'router' THEN 'qnap_router'
        WHEN vendor = 'qnap' THEN 'qnap_storage'
        WHEN vendor = 'hp' AND vendor_subtype = 'procurve' THEN 'hp_switch_procurve'
        WHEN vendor = 'hp' AND vendor_subtype = 'comware' THEN 'hp_switch_comware'
        WHEN vendor = 'hp' THEN 'hp_switch_arubaos'
        WHEN vendor = 'omada' THEN 'omada_switch'
        WHEN vendor = 'stormshield' THEN 'stormshield_firewall'
        WHEN vendor = 'cisco' AND device_type = 'router' THEN 'cisco_router'
        WHEN vendor = 'cisco' THEN 'cisco_switch'
        WHEN vendor = 'vmware' THEN 'vmware_vsphere'
        ELSE 'generic_iot'
      END
      WHERE product_profile IS NULL OR TRIM(product_profile) = ''
    `);
  } catch { /* backfill optional */ }

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
      username TEXT, encrypted_password TEXT, community_string TEXT, api_token TEXT, api_url TEXT,
      port INTEGER DEFAULT 22, enabled INTEGER DEFAULT 1, classification TEXT,
      sysname TEXT, sysdescr TEXT, model TEXT, firmware TEXT, serial_number TEXT, part_number TEXT,
      last_info_update TEXT, last_device_info_json TEXT, stp_info TEXT,
      last_proxmox_scan_at TEXT, last_proxmox_scan_result TEXT,
      scan_target TEXT, product_profile TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`);
    {
      const srcInfo = _db.prepare("PRAGMA table_info(network_devices)").all() as { name: string }[];
      const srcCols = srcInfo.map((r) => r.name);
      const dstInfo = _db.prepare("PRAGMA table_info(network_devices_hypervisor_new)").all() as { name: string }[];
      const dstCols = new Set(dstInfo.map((r) => r.name));
      const common = srcCols.filter((c) => dstCols.has(c)).join(", ");
      _db.exec(`INSERT INTO network_devices_hypervisor_new (${common}) SELECT ${common} FROM network_devices`);
    }
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
      sysname TEXT, sysdescr TEXT, model TEXT, firmware TEXT, serial_number TEXT, part_number TEXT,
      last_info_update TEXT, last_device_info_json TEXT, stp_info TEXT,
      last_proxmox_scan_at TEXT, last_proxmox_scan_result TEXT,
      scan_target TEXT, product_profile TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    )`);
    {
      const srcInfo = _db.prepare("PRAGMA table_info(network_devices)").all() as { name: string }[];
      const srcCols = srcInfo.map((r) => r.name);
      const dstInfo = _db.prepare("PRAGMA table_info(network_devices_vendor_ext)").all() as { name: string }[];
      const dstCols = new Set(dstInfo.map((r) => r.name));
      const common = srcCols.filter((c) => dstCols.has(c)).join(", ");
      _db.exec(`INSERT INTO network_devices_vendor_ext (${common}) SELECT ${common} FROM network_devices`);
    }
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
      product_profile TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    )`);
    {
      const srcInfo = _db.prepare("PRAGMA table_info(network_devices)").all() as { name: string }[];
      const srcCols = srcInfo.map((r) => r.name);
      const dstInfo = _db.prepare("PRAGMA table_info(network_devices_winrm)").all() as { name: string }[];
      const dstCols = new Set(dstInfo.map((r) => r.name));
      const common = srcCols.filter((c) => dstCols.has(c)).join(", ");
      _db.exec(`INSERT INTO network_devices_winrm (${common}) SELECT ${common} FROM network_devices`);
    }
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
        product_profile TEXT,
        created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
      )`);
      const targetCols = ["id","name","host","device_type","vendor","vendor_subtype","protocol","credential_id","snmp_credential_id","username","encrypted_password","community_string","api_token","api_url","port","enabled","classification","sysname","sysdescr","model","firmware","serial_number","part_number","last_info_update","last_device_info_json","stp_info","last_proxmox_scan_at","last_proxmox_scan_result","scan_target","product_profile","created_at","updated_at"];
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
      const targetCols = ["id","name","host","device_type","vendor","vendor_subtype","protocol","credential_id","snmp_credential_id","username","encrypted_password","community_string","api_token","api_url","port","enabled","classification","sysname","sysdescr","model","firmware","serial_number","part_number","last_info_update","last_device_info_json","stp_info","last_proxmox_scan_at","last_proxmox_scan_result","scan_target","product_profile","created_at","updated_at"];
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
        product_profile TEXT,
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

  // Un solo profilo Nmap globale: elimina duplicati, mantieni quello predefinito (o id minimo)
  try {
    const def = _db.prepare("SELECT id FROM nmap_profiles WHERE is_default = 1 ORDER BY id LIMIT 1").get() as { id: number } | undefined;
    const keep = def?.id ?? (_db.prepare("SELECT MIN(id) as id FROM nmap_profiles").get() as { id: number } | undefined)?.id;
    if (keep != null) {
      _db.prepare("DELETE FROM nmap_profiles WHERE id != ?").run(keep);
      _db.prepare("UPDATE nmap_profiles SET is_default = 1 WHERE id = ?").run(keep);
    }
  } catch { /* tabella assente o vuota */ }

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

  try {
    _db.exec(`CREATE TABLE IF NOT EXISTS device_fingerprint_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      device_label TEXT NOT NULL,
      classification TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 100,
      enabled INTEGER NOT NULL DEFAULT 1,
      tcp_ports_key TEXT,
      tcp_ports_optional TEXT,
      min_key_ports INTEGER,
      oid_prefix TEXT,
      sysdescr_pattern TEXT,
      hostname_pattern TEXT,
      mac_vendor_pattern TEXT,
      banner_pattern TEXT,
      ttl_min INTEGER,
      ttl_max INTEGER,
      note TEXT,
      builtin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(name)
    )`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_device_fp_rules_pri ON device_fingerprint_rules(enabled, priority ASC, id ASC)`);
    seedBuiltinFingerprintRules(_db);
  } catch { /* exists */ }

  // Active Directory tables
  try {
    _db.exec(`CREATE TABLE IF NOT EXISTS ad_integrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      dc_host TEXT NOT NULL,
      domain TEXT NOT NULL,
      base_dn TEXT NOT NULL,
      encrypted_username TEXT NOT NULL,
      encrypted_password TEXT NOT NULL,
      use_ssl INTEGER NOT NULL DEFAULT 1,
      port INTEGER NOT NULL DEFAULT 636,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_sync_at TEXT,
      last_sync_status TEXT,
      computers_count INTEGER DEFAULT 0,
      users_count INTEGER DEFAULT 0,
      groups_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(dc_host, domain)
    )`);
  } catch { /* exists */ }
  try {
    _db.exec(`CREATE TABLE IF NOT EXISTS ad_computers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      integration_id INTEGER NOT NULL REFERENCES ad_integrations(id) ON DELETE CASCADE,
      object_guid TEXT NOT NULL,
      sam_account_name TEXT NOT NULL,
      dns_host_name TEXT,
      display_name TEXT,
      distinguished_name TEXT NOT NULL,
      operating_system TEXT,
      operating_system_version TEXT,
      last_logon_at TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
      raw_data TEXT,
      synced_at TEXT DEFAULT (datetime('now')),
      UNIQUE(integration_id, object_guid)
    )`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_ad_computers_integration ON ad_computers(integration_id)`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_ad_computers_host ON ad_computers(host_id)`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_ad_computers_dns ON ad_computers(dns_host_name)`);
  } catch { /* exists */ }
  try {
    _db.exec(`CREATE TABLE IF NOT EXISTS ad_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      integration_id INTEGER NOT NULL REFERENCES ad_integrations(id) ON DELETE CASCADE,
      object_guid TEXT NOT NULL,
      sam_account_name TEXT NOT NULL,
      user_principal_name TEXT,
      display_name TEXT,
      email TEXT,
      department TEXT,
      title TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_logon_at TEXT,
      password_last_set_at TEXT,
      raw_data TEXT,
      synced_at TEXT DEFAULT (datetime('now')),
      UNIQUE(integration_id, object_guid)
    )`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_ad_users_integration ON ad_users(integration_id)`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_ad_users_upn ON ad_users(user_principal_name)`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_ad_users_email ON ad_users(email)`);
  } catch { /* exists */ }
  try {
    _db.exec(`CREATE TABLE IF NOT EXISTS ad_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      integration_id INTEGER NOT NULL REFERENCES ad_integrations(id) ON DELETE CASCADE,
      object_guid TEXT NOT NULL,
      sam_account_name TEXT NOT NULL,
      display_name TEXT,
      description TEXT,
      distinguished_name TEXT NOT NULL,
      group_type INTEGER,
      member_guids TEXT,
      synced_at TEXT DEFAULT (datetime('now')),
      UNIQUE(integration_id, object_guid)
    )`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_ad_groups_integration ON ad_groups(integration_id)`);
  } catch { /* exists */ }
  // AD: nuove colonne e tabella DHCP leases
  try { _db.exec("ALTER TABLE ad_integrations ADD COLUMN winrm_credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL"); } catch { /* already exists */ }
  try { _db.exec("ALTER TABLE ad_integrations ADD COLUMN dhcp_leases_count INTEGER DEFAULT 0"); } catch { /* already exists */ }
  try { _db.exec("ALTER TABLE ad_computers ADD COLUMN ip_address TEXT"); } catch { /* already exists */ }
  try { _db.exec("ALTER TABLE ad_computers ADD COLUMN ou TEXT"); } catch { /* already exists */ }
  try { _db.exec("ALTER TABLE ad_users ADD COLUMN phone TEXT"); } catch { /* already exists */ }
  try { _db.exec("ALTER TABLE ad_users ADD COLUMN ou TEXT"); } catch { /* already exists */ }
  try {
    _db.exec(`CREATE TABLE IF NOT EXISTS ad_dhcp_leases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      integration_id INTEGER NOT NULL REFERENCES ad_integrations(id) ON DELETE CASCADE,
      scope_id TEXT NOT NULL,
      scope_name TEXT,
      ip_address TEXT NOT NULL,
      mac_address TEXT NOT NULL,
      hostname TEXT,
      lease_expires TEXT,
      address_state TEXT,
      description TEXT,
      last_synced TEXT DEFAULT (datetime('now')),
      UNIQUE(integration_id, ip_address)
    )`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_ad_dhcp_leases_integration ON ad_dhcp_leases(integration_id)`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_ad_dhcp_leases_mac ON ad_dhcp_leases(mac_address)`);
  } catch { /* exists */ }

  // SNMP Vendor Profiles table
  try {
    _db.exec(`CREATE TABLE IF NOT EXISTS snmp_vendor_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      enterprise_oid_prefixes TEXT NOT NULL DEFAULT '[]',
      sysdescr_pattern TEXT,
      fields TEXT NOT NULL DEFAULT '{}',
      confidence REAL NOT NULL DEFAULT 0.90,
      enabled INTEGER NOT NULL DEFAULT 1,
      builtin INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_snmp_vendor_profiles_category ON snmp_vendor_profiles(category)`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_snmp_vendor_profiles_enabled ON snmp_vendor_profiles(enabled)`);
    seedBuiltinSnmpVendorProfiles(_db);
  } catch { /* exists */ }

  // DHCP Leases table (unified)
  try {
    _db.exec(`CREATE TABLE IF NOT EXISTS dhcp_leases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL CHECK(source_type IN ('mikrotik', 'windows', 'cisco', 'other')),
      source_device_id INTEGER REFERENCES network_devices(id) ON DELETE CASCADE,
      source_name TEXT,
      server_name TEXT,
      scope_id TEXT,
      scope_name TEXT,
      ip_address TEXT NOT NULL,
      mac_address TEXT NOT NULL,
      hostname TEXT,
      status TEXT,
      lease_start TEXT,
      lease_expires TEXT,
      description TEXT,
      host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
      network_id INTEGER REFERENCES networks(id) ON DELETE SET NULL,
      last_synced TEXT DEFAULT (datetime('now')),
      UNIQUE(source_device_id, ip_address)
    )`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_dhcp_leases_source ON dhcp_leases(source_type, source_device_id)`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_dhcp_leases_mac ON dhcp_leases(mac_address)`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_dhcp_leases_ip ON dhcp_leases(ip_address)`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_dhcp_leases_host ON dhcp_leases(host_id)`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_dhcp_leases_network ON dhcp_leases(network_id)`);
  } catch { /* exists */ }
  try {
    _db.exec("ALTER TABLE dhcp_leases ADD COLUMN dynamic_lease INTEGER");
  } catch { /* column exists */ }

  try {
    const flag = _db.prepare("SELECT value FROM settings WHERE key = 'migration_mac_normalize_v1'").get() as
      | { value: string }
      | undefined;
    if (!flag?.value) {
      const hostRows = _db.prepare("SELECT id, mac FROM hosts WHERE mac IS NOT NULL AND trim(mac) != ''").all() as {
        id: number;
        mac: string;
      }[];
      const updHost = _db.prepare("UPDATE hosts SET mac = ? WHERE id = ?");
      for (const h of hostRows) {
        const n = normalizeMacForStorage(h.mac);
        if (n && n !== h.mac) updHost.run(n, h.id);
      }
      const leaseRows = _db.prepare("SELECT id, mac_address FROM dhcp_leases").all() as {
        id: number;
        mac_address: string;
      }[];
      const updLease = _db.prepare("UPDATE dhcp_leases SET mac_address = ? WHERE id = ?");
      for (const r of leaseRows) {
        const n = normalizeMacForStorage(r.mac_address);
        if (n && n !== r.mac_address) updLease.run(n, r.id);
      }
      try {
        const adRows = _db.prepare("SELECT id, mac_address FROM ad_dhcp_leases").all() as {
          id: number;
          mac_address: string;
        }[];
        const updAd = _db.prepare("UPDATE ad_dhcp_leases SET mac_address = ? WHERE id = ?");
        for (const r of adRows) {
          const n = normalizeMacForStorage(r.mac_address);
          if (n && n !== r.mac_address) updAd.run(n, r.id);
        }
      } catch {
        /* tabella assente in DB molto vecchi */
      }
      _db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('migration_mac_normalize_v1', '1')").run();
      syncIpAssignmentsForAllNetworks();
    }
  } catch {
    /* ignore */
  }

  try {
    const fpWin = _db.prepare("SELECT value FROM settings WHERE key = 'migration_fp_windows_relaxed_v1'").get() as
      | { value: string }
      | undefined;
    if (!fpWin?.value) {
      _db
        .prepare(
          `UPDATE device_fingerprint_rules SET min_key_ports = 2,
           note = CASE WHEN note IS NULL OR trim(note) = '' THEN 'Almeno 2/3 porte SMB/RPC (135,139,445)'
                ELSE note END
           WHERE builtin = 1 AND name = 'Windows Server (porte)'`
        )
        .run();
      _db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('migration_fp_windows_relaxed_v1', '1')").run();
    }
  } catch {
    /* ignore */
  }

  try {
    const nasProf = _db.prepare("SELECT value FROM settings WHERE key = 'migration_snmp_nas_profiles_v1'").get() as
      | { value: string }
      | undefined;
    if (!nasProf?.value) {
      // dsmInfo: modelName .5.1, serialNumber .5.2, version .5.3 (SYNOLOGY-SYSTEM-MIB)
      const synoFields = JSON.stringify({
        model: "1.3.6.1.4.1.6574.1.5.1.0",
        serial: "1.3.6.1.4.1.6574.1.5.2.0",
        firmware: "1.3.6.1.4.1.6574.1.5.3.0",
        systemStatus: "1.3.6.1.4.1.6574.1.1.0",
        powerStatus: "1.3.6.1.4.1.6574.1.2.0",
        temperature: "1.3.6.1.4.1.6574.1.4.2.0",
      });
      const qnapFields = JSON.stringify({
        model: "1.3.6.1.4.1.24681.1.2.1.0",
        firmware: "1.3.6.1.4.1.24681.1.2.2.0",
        serial: "1.3.6.1.4.1.24681.1.2.3.0",
        temperature: "1.3.6.1.4.1.24681.1.2.7.0",
      });
      _db
        .prepare(
          `UPDATE snmp_vendor_profiles SET fields = ?, updated_at = datetime('now') WHERE profile_id = 'synology' AND builtin = 1`
        )
        .run(synoFields);
      _db
        .prepare(
          `UPDATE snmp_vendor_profiles SET fields = ?, updated_at = datetime('now') WHERE profile_id = 'qnap' AND builtin = 1`
        )
        .run(qnapFields);
      _db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('migration_snmp_nas_profiles_v1', '1')").run();
    }
  } catch {
    /* ignore */
  }

  try {
    const synoOids = _db.prepare("SELECT value FROM settings WHERE key = 'migration_snmp_synology_dsm_info_oids_v1'").get() as
      | { value: string }
      | undefined;
    if (!synoOids?.value) {
      const synoFields = JSON.stringify({
        model: "1.3.6.1.4.1.6574.1.5.1.0",
        serial: "1.3.6.1.4.1.6574.1.5.2.0",
        firmware: "1.3.6.1.4.1.6574.1.5.3.0",
        systemStatus: "1.3.6.1.4.1.6574.1.1.0",
        powerStatus: "1.3.6.1.4.1.6574.1.2.0",
        temperature: "1.3.6.1.4.1.6574.1.4.2.0",
      });
      _db
        .prepare(
          `UPDATE snmp_vendor_profiles SET fields = ?, updated_at = datetime('now') WHERE profile_id = 'synology' AND builtin = 1`
        )
        .run(synoFields);
      _db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('migration_snmp_synology_dsm_info_oids_v1', '1')").run();
    }
  } catch {
    /* ignore */
  }

  try {
    const invFix = _db.prepare("SELECT value FROM settings WHERE key = 'migration_snmp_synology_serial_model_swap_v2'").get() as
      | { value: string }
      | undefined;
    if (!invFix?.value) {
      const row = _db
        .prepare("SELECT id, fields FROM snmp_vendor_profiles WHERE profile_id = 'synology' AND builtin = 1")
        .get() as { id: number; fields: string } | undefined;
      if (row?.fields) {
        try {
          const f = JSON.parse(row.fields) as Record<string, string>;
          if (
            f.serial === "1.3.6.1.4.1.6574.1.5.1.0" &&
            f.model === "1.3.6.1.4.1.6574.1.5.2.0"
          ) {
            f.model = "1.3.6.1.4.1.6574.1.5.1.0";
            f.serial = "1.3.6.1.4.1.6574.1.5.2.0";
            _db
              .prepare("UPDATE snmp_vendor_profiles SET fields = ?, updated_at = datetime('now') WHERE id = ?")
              .run(JSON.stringify(f), row.id);
          }
        } catch {
          /* JSON non valido */
        }
      }
      _db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('migration_snmp_synology_serial_model_swap_v2', '1')").run();
    }
  } catch {
    /* ignore */
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VERIFICA INTEGRITÀ SCHEMA — garantisce che tutte le colonne attese esistano
  // dopo migrazioni e SCHEMA_SQL. Aggiunge colonne mancanti con ALTER TABLE.
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const expectedColumns: Record<string, string[]> = {
      network_devices: [
        "product_profile", "scan_target", "serial_number", "part_number",
        "last_device_info_json", "last_proxmox_scan_at", "last_proxmox_scan_result",
        "sysname", "sysdescr", "model", "firmware", "stp_info", "classification",
      ],
      hosts: [
        "known_host", "classification_manual", "last_response_time_ms",
        "monitor_ports", "hostname_source", "conflict_flags", "ip_assignment",
        "last_seen", "first_seen", "detection_json", "snmp_data",
      ],
      inventory_assets: [
        "asset_assignee_id", "location_id", "technical_data",
      ],
      dhcp_leases: ["dynamic_lease"],
    };
    const defaultDefs: Record<string, string> = {
      known_host: "INTEGER DEFAULT 0",
      classification_manual: "INTEGER DEFAULT 0",
      ip_assignment: "TEXT DEFAULT 'unknown'",
      dynamic_lease: "INTEGER",
    };
    for (const [table, columns] of Object.entries(expectedColumns)) {
      for (const col of columns) {
        if (!tableHasColumn(_db, table, col)) {
          const def = defaultDefs[col] || "TEXT";
          try {
            _db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
          } catch { /* ignore if table does not exist yet */ }
        }
      }
    }
  }

  // Migrazione: popola device_credential_bindings dai vecchi credential_id / snmp_credential_id
  try {
    const migDone = _db.prepare("SELECT value FROM settings WHERE key = 'migration_credential_bindings_v1'").get();
    if (!migDone) {
      const devices = _db.prepare(`
        SELECT id, credential_id, snmp_credential_id, protocol, port, username, encrypted_password, community_string
        FROM network_devices
        WHERE credential_id IS NOT NULL OR snmp_credential_id IS NOT NULL OR username IS NOT NULL OR community_string IS NOT NULL
      `).all() as Array<{
        id: number; credential_id: number | null; snmp_credential_id: number | null;
        protocol: string; port: number | null; username: string | null;
        encrypted_password: string | null; community_string: string | null;
      }>;

      const ins = _db.prepare(`
        INSERT OR IGNORE INTO device_credential_bindings
          (device_id, credential_id, protocol_type, port, sort_order, inline_username, inline_encrypted_password, test_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'untested')
      `);

      _db.transaction(() => {
        for (const d of devices) {
          let order = 0;
          const protoType = d.protocol === "winrm" ? "winrm"
            : d.protocol === "snmp_v2" || d.protocol === "snmp_v3" ? "snmp"
            : d.protocol === "api" ? "api"
            : "ssh";
          const defaultPort = protoType === "snmp" ? 161 : protoType === "winrm" ? 5985 : protoType === "api" ? 443 : 22;

          // Credenziale principale da archivio
          if (d.credential_id) {
            ins.run(d.id, d.credential_id, protoType, d.port || defaultPort, order++, null, null);
          }
          // Credenziale inline (username/password senza credential_id)
          if (!d.credential_id && d.username) {
            ins.run(d.id, null, protoType, d.port || defaultPort, order++, d.username, d.encrypted_password);
          }
          // Credenziale SNMP secondaria
          if (d.snmp_credential_id && d.snmp_credential_id !== d.credential_id) {
            ins.run(d.id, d.snmp_credential_id, "snmp", 161, order++, null, null);
          }
          // Community string inline (senza snmp_credential_id)
          if (!d.snmp_credential_id && d.community_string) {
            ins.run(d.id, null, "snmp", 161, order++, null, d.community_string);
          }
        }
      })();

      _db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('migration_credential_bindings_v1', '1')").run();
    }
  } catch {
    /* ignore migration errors */
  }

  // ── Migrazione: popola network_credentials da network_host_credentials (deduplica per credential_id) ──
  try {
    const migDone = _db.prepare("SELECT value FROM settings WHERE key = 'migration_network_credentials_v1'").get() as { value: string } | undefined;
    if (!migDone) {
      const db = _db;
      db.transaction(() => {
        const rows = db.prepare(`
          SELECT DISTINCT network_id, credential_id, MIN(sort_order) as sort_order
          FROM network_host_credentials
          GROUP BY network_id, credential_id
          ORDER BY network_id, MIN(sort_order) ASC, MIN(id) ASC
        `).all() as Array<{ network_id: number; credential_id: number; sort_order: number }>;

        const ins = db.prepare(
          `INSERT OR IGNORE INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, ?)`
        );

        let curNet = -1;
        let order = 0;
        for (const r of rows) {
          if (r.network_id !== curNet) {
            curNet = r.network_id;
            order = 0;
          }
          ins.run(r.network_id, r.credential_id, order++);
        }

        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('migration_network_credentials_v1', '1')").run();
      })();
    }
  } catch {
    /* ignore migration errors */
  }

  // ── Migrazione: popola host_credentials da host_detect_credential ──
  try {
    const migDone = _db.prepare("SELECT value FROM settings WHERE key = 'migration_host_credentials_v1'").get() as { value: string } | undefined;
    if (!migDone) {
      const db = _db;
      db.transaction(() => {
        const rows = db.prepare(`SELECT host_id, role, credential_id FROM host_detect_credential`).all() as Array<{
          host_id: number;
          role: string;
          credential_id: number;
        }>;

        const ins = db.prepare(
          `INSERT OR IGNORE INTO host_credentials (host_id, credential_id, protocol_type, port, validated, validated_at, auto_detected) VALUES (?, ?, ?, ?, 1, datetime('now'), 1)`
        );

        for (const r of rows) {
          let protocolType: string;
          let port: number;
          if (r.role === "ssh" || r.role === "linux") {
            protocolType = "ssh";
            port = 22;
          } else if (r.role === "snmp") {
            protocolType = "snmp";
            port = 161;
          } else if (r.role === "windows") {
            protocolType = "winrm";
            port = 5985;
          } else {
            continue;
          }
          ins.run(r.host_id, r.credential_id, protocolType, port);
        }

        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('migration_host_credentials_v1', '1')").run();
      })();
    }
  } catch {
    /* ignore migration errors */
  }

  return _db;
}

function seedBuiltinFingerprintRules(db: Database.Database): void {
  const count = (db.prepare("SELECT COUNT(*) as c FROM device_fingerprint_rules").get() as { c: number }).c;
  const ins = db.prepare(
    `INSERT OR IGNORE INTO device_fingerprint_rules
     (name, device_label, classification, priority, enabled, tcp_ports_key, tcp_ports_optional, min_key_ports,
      oid_prefix, sysdescr_pattern, hostname_pattern, mac_vendor_pattern, banner_pattern, ttl_min, ttl_max, note, builtin)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  );
  const rules: Array<{
    name: string; label: string; cls: string; pri: number;
    keyPorts?: number[]; optPorts?: number[]; minKey?: number;
    oid?: string; sysDescr?: string; hostname?: string; macVendor?: string; banner?: string;
    ttlMin?: number; ttlMax?: number; note?: string;
  }> = [
    // ── Port signatures ──
    { name: "Proxmox VE (porte)", label: "Proxmox VE", cls: "hypervisor", pri: 10, keyPorts: [8006, 22], optPorts: [3128, 8007] },
    { name: "Synology DSM (porte)", label: "Synology DSM", cls: "storage", pri: 10, keyPorts: [5000, 5001, 22], optPorts: [6690, 7304] },
    { name: "QNAP QTS (porte)", label: "QNAP QTS", cls: "storage", pri: 10, keyPorts: [8080, 22], optPorts: [9000, 443] },
    { name: "TrueNAS (porte)", label: "TrueNAS", cls: "storage", pri: 15, keyPorts: [80, 443, 2049], optPorts: [22], note: "Richiede NFS (2049) per distinguere da generico" },
    { name: "MikroTik RouterOS (porte)", label: "MikroTik RouterOS", cls: "router", pri: 10, keyPorts: [8291, 22], optPorts: [80, 443, 8728] },
    { name: "UniFi Controller (porte)", label: "UniFi Controller", cls: "access_point", pri: 10, keyPorts: [8443, 8080], optPorts: [8880, 6789, 22] },
    { name: "Stormshield SNS (porte)", label: "Stormshield SNS", cls: "firewall", pri: 10, keyPorts: [443, 22, 1300], optPorts: [] },
    { name: "Hikvision (porte)", label: "Hikvision", cls: "telecamera", pri: 10, keyPorts: [554, 8000], optPorts: [80, 8001, 443] },
    { name: "Dahua / NVR (porte)", label: "Dahua / NVR", cls: "telecamera", pri: 10, keyPorts: [554, 37777], optPorts: [80, 443] },
    { name: "Telecam XMEye/clone (porte)", label: "Telecam XMEye/clone", cls: "telecamera", pri: 10, keyPorts: [34567, 554], optPorts: [80] },
    {
      name: "Windows Server (porte)",
      label: "Windows Server",
      cls: "server_windows",
      pri: 20,
      keyPorts: [135, 139, 445],
      optPorts: [3389, 5985],
      minKey: 2,
      note: "Almeno 2 tra 135/139/445 + opzionali RDP/WinRM",
    },
    { name: "HPE iLO (porte)", label: "HPE iLO", cls: "server", pri: 10, keyPorts: [17988, 17990], optPorts: [443, 623] },
    { name: "PBX SIP (porte)", label: "PBX SIP (FreePBX/3CX)", cls: "voip", pri: 10, keyPorts: [5060], optPorts: [5061, 80, 443] },
    { name: "Zabbix (porte)", label: "Zabbix", cls: "server", pri: 10, keyPorts: [10050, 10051], optPorts: [80, 443] },
    { name: "Wazuh (porte)", label: "Wazuh", cls: "server", pri: 10, keyPorts: [1514, 1515, 55000], optPorts: [443] },
    { name: "Linux generico (porte)", label: "Linux generico", cls: "server_linux", pri: 90, keyPorts: [22], optPorts: [80, 443], note: "Bassa priorità: fallback generico" },
    // ── OID ──
    { name: "HP stampante (OID)", label: "HP Stampante", cls: "stampante", pri: 5, oid: "1.3.6.1.4.1.11.2.3.9" },
    { name: "HP ProCurve switch (OID)", label: "HP ProCurve", cls: "switch", pri: 5, oid: "1.3.6.1.4.1.11.2.3.7" },
    { name: "MikroTik (OID)", label: "MikroTik RouterOS", cls: "router", pri: 5, oid: "1.3.6.1.4.1.14988.1" },
    { name: "Ubiquiti AP (OID)", label: "UniFi/Ubiquiti", cls: "access_point", pri: 5, oid: "1.3.6.1.4.1.41112" },
    { name: "Ruckus AP (OID)", label: "Ruckus AP", cls: "access_point", pri: 5, oid: "1.3.6.1.4.1.25053" },
    { name: "Hikvision (OID)", label: "Hikvision", cls: "telecamera", pri: 5, oid: "1.3.6.1.4.1.39165" },
    { name: "Synology (OID)", label: "Synology DSM", cls: "storage", pri: 5, oid: "1.3.6.1.4.1.6574" },
    { name: "QNAP (OID)", label: "QNAP QTS", cls: "storage", pri: 5, oid: "1.3.6.1.4.1.24681" },
    { name: "Epson stampante (OID)", label: "Epson", cls: "stampante", pri: 5, oid: "1.3.6.1.4.1.1248" },
    { name: "VMware (OID)", label: "VMware ESXi", cls: "hypervisor", pri: 5, oid: "1.3.6.1.4.1.6876" },
    { name: "APC UPS (OID)", label: "APC UPS", cls: "ups", pri: 5, oid: "1.3.6.1.4.1.318" },
    { name: "Yealink VoIP (OID)", label: "Yealink VoIP", cls: "voip", pri: 5, oid: "1.3.6.1.4.1.3990" },
    { name: "Fortinet (OID)", label: "Fortinet FortiGate", cls: "firewall", pri: 5, oid: "1.3.6.1.4.1.12356" },
    { name: "pfSense (OID)", label: "pfSense", cls: "firewall", pri: 5, oid: "1.3.6.1.4.1.12325" },
    { name: "Netgear (OID)", label: "Netgear", cls: "switch", pri: 5, oid: "1.3.6.1.4.1.4526" },
    { name: "Cisco switch (OID)", label: "Cisco", cls: "switch", pri: 6, oid: "1.3.6.1.4.1.9.1" },
    { name: "net-snmp Linux (OID)", label: "Linux/net-snmp", cls: "server_linux", pri: 50, oid: "1.3.6.1.4.1.8072.3.2", note: "Generico Linux; Proxmox override se porta 8006 o sysDescr" },
    // ── sysDescr / testo ──
    { name: "RouterOS (sysDescr)", label: "MikroTik RouterOS", cls: "router", pri: 30, sysDescr: "routeros|mikrotik" },
    { name: "Proxmox (sysDescr)", label: "Proxmox VE", cls: "hypervisor", pri: 30, sysDescr: "proxmox|pve-manager|qemu.?kvm" },
    { name: "Synology (sysDescr)", label: "Synology DSM", cls: "storage", pri: 30, sysDescr: "synology|diskstation" },
    { name: "QNAP (sysDescr)", label: "QNAP QTS", cls: "storage", pri: 30, sysDescr: "qnap|\\bqts\\b" },
    { name: "ESXi (sysDescr)", label: "VMware ESXi", cls: "hypervisor", pri: 30, sysDescr: "esxi|vmware\\s*esx" },
    { name: "Firewall generico (sysDescr)", label: "Firewall", cls: "firewall", pri: 35, sysDescr: "firewall|fortigate|pfsense|opnsense|sophos" },
    { name: "Windows Server (sysDescr)", label: "Windows Server", cls: "server_windows", pri: 35, sysDescr: "windows\\s*server|microsoft.*server" },
    { name: "Stampante (sysDescr)", label: "Stampante", cls: "stampante", pri: 35, sysDescr: "printer|laserjet|deskjet|officejet|epson|brother.*print|lexmark|ricoh|xerox" },
    // ── Hostname ──
    { name: "AP hostname", label: "Access Point", cls: "access_point", pri: 60, hostname: "^ap[-_]|^wifi[-_]|^unifi[-_]|^ubnt[-_]" },
    { name: "Printer hostname", label: "Stampante", cls: "stampante", pri: 60, hostname: "^printer[-_]|^print[-_]|^hp[-_]lj" },
    { name: "Camera hostname", label: "Telecamera", cls: "telecamera", pri: 60, hostname: "^cam[-_]|^ipcam[-_]|^nvr[-_]|^dvr[-_]" },
    { name: "NAS hostname", label: "NAS/Storage", cls: "storage", pri: 60, hostname: "^nas[-_]|^synology[-_]|^qnap[-_]" },
    { name: "Switch hostname", label: "Switch", cls: "switch", pri: 60, hostname: "^switch[-_]|^sw[-_]" },
    { name: "Router hostname", label: "Router", cls: "router", pri: 60, hostname: "^router[-_]|^gw[-_]|^gateway[-_]" },
    { name: "Hypervisor hostname", label: "Hypervisor", cls: "hypervisor", pri: 60, hostname: "^esxi[-_]|^proxmox[-_]|^pve[-_]" },
    // ── MAC vendor ──
    { name: "Synology MAC", label: "Synology DSM", cls: "storage", pri: 70, macVendor: "synology" },
    { name: "QNAP MAC", label: "QNAP QTS", cls: "storage", pri: 70, macVendor: "qnap" },
    { name: "Hikvision MAC", label: "Hikvision", cls: "telecamera", pri: 70, macVendor: "hikvision|hangzhou" },
    { name: "VM MAC", label: "VM", cls: "vm", pri: 70, macVendor: "vmware|proxmox\\s*server|microsoft\\s*virtual|hyper-v|qemu|xensource|oracle\\s*vm|red\\s*hat.*kvm" },
    { name: "Apple MAC", label: "Client Apple", cls: "workstation", pri: 75, macVendor: "apple" },
    // ── Banner HTTP ──
    { name: "Proxmox banner", label: "Proxmox VE", cls: "hypervisor", pri: 25, banner: "proxmox|pve-manager" },
    { name: "Synology banner", label: "Synology DSM", cls: "storage", pri: 25, banner: "synology|diskstation" },
    { name: "QNAP banner", label: "QNAP QTS", cls: "storage", pri: 25, banner: "qnap|qts" },
    // ── TTL ──
    { name: "TTL Windows", label: "Windows", cls: "workstation", pri: 95, ttlMin: 65, ttlMax: 128, note: "TTL 65-128 suggerisce Windows; bassa priorità" },
  ];
  if (count === 0) {
    const t = db.transaction(() => {
      for (const r of rules) {
        ins.run(
          r.name, r.label, r.cls, r.pri,
          r.keyPorts ? JSON.stringify(r.keyPorts) : null,
          r.optPorts ? JSON.stringify(r.optPorts) : null,
          r.minKey ?? null,
          r.oid ?? null,
          r.sysDescr ?? null,
          r.hostname ?? null,
          r.macVendor ?? null,
          r.banner ?? null,
          r.ttlMin ?? null,
          r.ttlMax ?? null,
          r.note ?? null,
        );
      }
    });
    t();
  } else {
    // Inserisci solo regole builtin mancanti (per aggiornamenti)
    const existingNames = new Set(
      (db.prepare("SELECT name FROM device_fingerprint_rules").all() as Array<{ name: string }>)
        .map((r) => r.name)
    );
    const missing = rules.filter((r) => !existingNames.has(r.name));
    if (missing.length > 0) {
      const t = db.transaction(() => {
        for (const r of missing) {
          ins.run(
            r.name, r.label, r.cls, r.pri,
            r.keyPorts ? JSON.stringify(r.keyPorts) : null,
            r.optPorts ? JSON.stringify(r.optPorts) : null,
            r.minKey ?? null,
            r.oid ?? null,
            r.sysDescr ?? null,
            r.hostname ?? null,
            r.macVendor ?? null,
            r.banner ?? null,
            r.ttlMin ?? null,
            r.ttlMax ?? null,
            r.note ?? null,
          );
        }
      });
      t();
    }
  }
}

function seedBuiltinSnmpVendorProfiles(db: Database.Database): void {
  const count = (db.prepare("SELECT COUNT(*) as c FROM snmp_vendor_profiles").get() as { c: number }).c;

  const ins = db.prepare(`INSERT INTO snmp_vendor_profiles
    (profile_id, name, category, enterprise_oid_prefixes, sysdescr_pattern, fields, confidence, enabled, builtin)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`);

  const profiles = [
    // FIREWALL
    { id: "stormshield", name: "Stormshield SNS", cat: "firewall", oids: ["1.3.6.1.4.1.11256"], conf: 0.98,
      fields: { model: "1.3.6.1.4.1.11256.1.1.1.0", firmware: "1.3.6.1.4.1.11256.1.1.2.0", serial: "1.3.6.1.4.1.11256.1.1.3.0" } },
    { id: "fortinet", name: "Fortinet FortiGate", cat: "firewall", oids: ["1.3.6.1.4.1.12356"], conf: 0.98,
      fields: { firmware: "1.3.6.1.4.1.12356.101.4.1.1.0", model: "1.3.6.1.4.1.12356.101.4.1.5.0", serial: "1.3.6.1.4.1.12356.101.4.1.4.0" } },
    { id: "pfsense", name: "pfSense", cat: "firewall", oids: ["1.3.6.1.4.1.12325"], sysDescr: "pfsense", conf: 0.95,
      fields: { os: "1.3.6.1.2.1.1.1.0" } },
    { id: "opnsense", name: "OPNsense", cat: "firewall", oids: [], sysDescr: "opnsense", conf: 0.95,
      fields: { os: "1.3.6.1.2.1.1.1.0" } },
    { id: "sophos", name: "Sophos XG/XGS", cat: "firewall", oids: ["1.3.6.1.4.1.2604"], conf: 0.97,
      fields: { model: "1.3.6.1.4.1.2604.5.1.1.2.0", firmware: "1.3.6.1.4.1.2604.5.1.1.3.0" } },
    { id: "paloalto", name: "Palo Alto Networks", cat: "firewall", oids: ["1.3.6.1.4.1.25461"], conf: 0.98,
      fields: { firmware: "1.3.6.1.4.1.25461.2.1.2.1.1.0", model: "1.3.6.1.4.1.25461.2.1.2.1.5.0", serial: "1.3.6.1.4.1.25461.2.1.2.1.3.0" } },
    // SWITCH
    { id: "cisco_switch", name: "Cisco Switch", cat: "switch", oids: ["1.3.6.1.4.1.9.1.5", "1.3.6.1.4.1.9.1.1"], conf: 0.96,
      fields: { model: "1.3.6.1.2.1.47.1.1.1.1.13.1", serial: ["1.3.6.1.2.1.47.1.1.1.1.11.1", "1.3.6.1.4.1.9.3.6.3.0"], firmware: "1.3.6.1.2.1.47.1.1.1.1.10.1" } },
    { id: "cisco_router", name: "Cisco Router", cat: "router", oids: ["1.3.6.1.4.1.9.1"], conf: 0.94,
      fields: { model: "1.3.6.1.2.1.47.1.1.1.1.13.1", serial: ["1.3.6.1.2.1.47.1.1.1.1.11.1", "1.3.6.1.4.1.9.3.6.3.0"], firmware: "1.3.6.1.2.1.47.1.1.1.1.10.1" } },
    { id: "hp_procurve", name: "HP ProCurve (ArubaOS-Switch)", cat: "switch", oids: ["1.3.6.1.4.1.11.2.14.11.5.1", "1.3.6.1.4.1.11.2.3.7"], conf: 0.97,
      fields: { model: "1.3.6.1.4.1.11.2.14.11.5.1.1.2.0", firmware: "1.3.6.1.4.1.11.2.14.11.5.1.1.7.0", serial: "1.3.6.1.4.1.11.2.14.11.5.1.1.10.0" } },
    { id: "hp_comware", name: "HP Comware (FlexFabric)", cat: "switch", oids: ["1.3.6.1.4.1.25506"], conf: 0.96,
      fields: { model: "1.3.6.1.2.1.47.1.1.1.1.13.1", serial: "1.3.6.1.2.1.47.1.1.1.1.11.1" } },
    { id: "juniper", name: "Juniper Networks", cat: "router", oids: ["1.3.6.1.4.1.2636"], conf: 0.97,
      fields: { model: "1.3.6.1.4.1.2636.3.1.2.0", serial: "1.3.6.1.4.1.2636.3.1.3.0" } },
    { id: "aruba", name: "Aruba Networks (HPE)", cat: "switch", oids: ["1.3.6.1.4.1.14823"], conf: 0.96,
      fields: { model: "1.3.6.1.2.1.47.1.1.1.1.13.1", serial: "1.3.6.1.2.1.47.1.1.1.1.11.1" } },
    { id: "netgear", name: "Netgear Switch", cat: "switch", oids: ["1.3.6.1.4.1.4526"], conf: 0.95,
      fields: { model: "1.3.6.1.2.1.47.1.1.1.1.13.1", serial: "1.3.6.1.2.1.47.1.1.1.1.11.1" } },
    { id: "dlink", name: "D-Link Switch", cat: "switch", oids: ["1.3.6.1.4.1.171"], conf: 0.94,
      fields: { model: "1.3.6.1.2.1.47.1.1.1.1.13.1", serial: "1.3.6.1.2.1.47.1.1.1.1.11.1" } },
    { id: "tplink_omada", name: "TP-Link Omada", cat: "switch", oids: ["1.3.6.1.4.1.11863"], conf: 0.95,
      fields: { model: "1.3.6.1.2.1.47.1.1.1.1.13.1", serial: "1.3.6.1.2.1.47.1.1.1.1.11.1", firmware: "1.3.6.1.2.1.47.1.1.1.1.9.1" } },
    { id: "ubiquiti_edgeswitch", name: "Ubiquiti EdgeSwitch", cat: "switch", oids: ["1.3.6.1.4.1.4413"], conf: 0.96,
      fields: { model: "1.3.6.1.2.1.47.1.1.1.1.13.1", serial: "1.3.6.1.2.1.47.1.1.1.1.11.1" } },
    // ROUTER
    { id: "mikrotik", name: "MikroTik RouterOS", cat: "router", oids: ["1.3.6.1.4.1.14988"], conf: 0.98,
      fields: { model: "1.3.6.1.4.1.14988.1.1.7.1.0", serial: "1.3.6.1.4.1.14988.1.1.7.3.0", firmware: "1.3.6.1.4.1.14988.1.1.7.4.0" } },
    { id: "ubiquiti_edgerouter", name: "Ubiquiti EdgeRouter", cat: "router", oids: ["1.3.6.1.4.1.41112.1.5"], sysDescr: "edgeos", conf: 0.95,
      fields: { model: "1.3.6.1.2.1.47.1.1.1.1.13.1" } },
    // ACCESS POINT
    { id: "ubiquiti_unifi_ap", name: "Ubiquiti UniFi AP", cat: "access_point", oids: ["1.3.6.1.4.1.41112.1.6"], conf: 0.97,
      fields: { model: "1.3.6.1.4.1.41112.1.6.1.1.0", firmware: "1.3.6.1.4.1.41112.1.6.1.2.0", serial: "1.3.6.1.4.1.41112.1.6.1.3.0" } },
    { id: "ruckus_ap", name: "Ruckus AP", cat: "access_point", oids: ["1.3.6.1.4.1.25053.3.1.4", "1.3.6.1.4.1.25053.3.1.5"], conf: 0.97,
      sysDescr: "ruckus",
      fields: { model: "1.3.6.1.4.1.25053.1.2.1.1.1.5.1.2.1", serial: "1.3.6.1.4.1.25053.1.2.1.1.1.5.1.3.1", firmware: "1.3.6.1.4.1.25053.1.2.1.1.1.5.1.7.1" } },
    { id: "ruckus_controller", name: "Ruckus SmartZone", cat: "access_point", oids: ["1.3.6.1.4.1.25053.3.1.11", "1.3.6.1.4.1.25053.3.1.13"], conf: 0.96,
      fields: { model: "1.3.6.1.4.1.25053.1.2.1.1.1.5.1.2.1", firmware: "1.3.6.1.4.1.25053.1.2.1.1.1.5.1.7.1" } },
    { id: "ubiquiti_airmax", name: "Ubiquiti AirMAX", cat: "access_point", oids: ["1.3.6.1.4.1.41112.1.2"], conf: 0.96, fields: {} },
    { id: "ubiquiti_generic", name: "Ubiquiti Device", cat: "access_point", oids: ["1.3.6.1.4.1.41112"], conf: 0.90,
      fields: { model: "1.3.6.1.2.1.47.1.1.1.1.13.1" } },
    // STORAGE
    { id: "synology", name: "Synology DSM", cat: "storage", oids: ["1.3.6.1.4.1.6574"], conf: 0.98,
      fields: {
        model: "1.3.6.1.4.1.6574.1.5.1.0",
        serial: "1.3.6.1.4.1.6574.1.5.2.0",
        firmware: "1.3.6.1.4.1.6574.1.5.3.0",
        systemStatus: "1.3.6.1.4.1.6574.1.1.0",
        powerStatus: "1.3.6.1.4.1.6574.1.2.0",
        temperature: "1.3.6.1.4.1.6574.1.4.2.0",
      } },
    { id: "qnap", name: "QNAP QTS", cat: "storage", oids: ["1.3.6.1.4.1.24681"], conf: 0.98,
      fields: {
        model: "1.3.6.1.4.1.24681.1.2.1.0",
        firmware: "1.3.6.1.4.1.24681.1.2.2.0",
        serial: "1.3.6.1.4.1.24681.1.2.3.0",
        temperature: "1.3.6.1.4.1.24681.1.2.7.0",
      } },
    { id: "truenas", name: "TrueNAS", cat: "storage", oids: [], sysDescr: "truenas|freenas", conf: 0.94, fields: { os: "1.3.6.1.2.1.1.1.0" } },
    { id: "netapp", name: "NetApp ONTAP", cat: "storage", oids: ["1.3.6.1.4.1.789"], conf: 0.97,
      fields: { firmware: "1.3.6.1.4.1.789.1.1.2.0", model: "1.3.6.1.4.1.789.1.1.3.0", serial: "1.3.6.1.4.1.789.1.1.4.0" } },
    // SERVER / HYPERVISOR
    { id: "hpe_ilo", name: "HPE iLO (ProLiant)", cat: "server", oids: ["1.3.6.1.4.1.232"], conf: 0.97,
      fields: { model: "1.3.6.1.4.1.232.2.2.4.2.0", serial: "1.3.6.1.4.1.232.2.2.2.6.0", partNumber: "1.3.6.1.4.1.232.2.2.4.3.0" } },
    { id: "dell_idrac", name: "Dell iDRAC (PowerEdge)", cat: "server", oids: ["1.3.6.1.4.1.674"], conf: 0.97,
      fields: { serial: "1.3.6.1.4.1.674.10892.5.1.3.2.0", model: "1.3.6.1.4.1.674.10892.5.1.3.21.0" } },
    { id: "vmware_esxi", name: "VMware ESXi", cat: "hypervisor", oids: ["1.3.6.1.4.1.6876"], conf: 0.98,
      fields: { model: "1.3.6.1.4.1.6876.1.1.0", firmware: "1.3.6.1.4.1.6876.1.2.0" } },
    { id: "proxmox", name: "Proxmox VE", cat: "hypervisor", oids: [], sysDescr: "proxmox|pve|pve-manager|qemu/kvm", conf: 0.95, fields: { os: "1.3.6.1.2.1.1.1.0" } },
    { id: "linux_generic", name: "Linux (net-snmp)", cat: "server_linux", oids: ["1.3.6.1.4.1.8072"], conf: 0.85, fields: { os: "1.3.6.1.2.1.1.1.0" } },
    { id: "windows_snmp", name: "Windows SNMP Agent", cat: "server_windows", oids: [], sysDescr: "windows", conf: 0.85, fields: { os: "1.3.6.1.2.1.1.1.0" } },
    // TELECAMERE
    { id: "hikvision", name: "Hikvision", cat: "telecamera", oids: ["1.3.6.1.4.1.39165", "1.3.6.1.4.1.50001"], conf: 0.97,
      fields: { model: "1.3.6.1.4.1.39165.1.1.0", firmware: "1.3.6.1.4.1.39165.1.3.0" } },
    { id: "dahua", name: "Dahua / NVR", cat: "telecamera", oids: ["1.3.6.1.4.1.1004849"], sysDescr: "dahua", conf: 0.95, fields: { os: "1.3.6.1.2.1.1.1.0" } },
    { id: "axis", name: "Axis Communications", cat: "telecamera", oids: ["1.3.6.1.4.1.368"], conf: 0.96,
      fields: { model: "1.3.6.1.2.1.47.1.1.1.1.13.1", serial: "1.3.6.1.2.1.47.1.1.1.1.11.1" } },
    // VoIP
    { id: "yealink", name: "Yealink VoIP", cat: "voip", oids: ["1.3.6.1.4.1.3990"], conf: 0.97,
      fields: { model: "1.3.6.1.4.1.3990.9.1.0", firmware: "1.3.6.1.4.1.3990.9.2.0" } },
    { id: "snom", name: "Snom VoIP", cat: "voip", oids: ["1.3.6.1.4.1.1526"], conf: 0.96,
      fields: { firmware: "1.3.6.1.4.1.1526.11.1.0" } },
    { id: "grandstream", name: "Grandstream VoIP", cat: "voip", oids: ["1.3.6.1.4.1.31746"], conf: 0.95, fields: { os: "1.3.6.1.2.1.1.1.0" } },
    { id: "cisco_phone", name: "Cisco IP Phone", cat: "voip", oids: ["1.3.6.1.4.1.9.6.1"], conf: 0.96,
      fields: { model: "1.3.6.1.2.1.47.1.1.1.1.13.1", serial: "1.3.6.1.2.1.47.1.1.1.1.11.1" } },
    // UPS
    { id: "apc", name: "APC (Schneider Electric)", cat: "ups", oids: ["1.3.6.1.4.1.318"], conf: 0.98,
      fields: { model: "1.3.6.1.4.1.318.1.1.1.1.1.1.0", firmware: "1.3.6.1.4.1.318.1.1.1.1.2.1.0", serial: "1.3.6.1.4.1.318.1.1.1.1.2.3.0" } },
    { id: "eaton", name: "Eaton UPS", cat: "ups", oids: ["1.3.6.1.4.1.705"], conf: 0.97,
      fields: { model: "1.3.6.1.4.1.705.1.1.1.0", firmware: "1.3.6.1.4.1.705.1.1.7.0" } },
    { id: "ups_rfc1628", name: "UPS (RFC 1628)", cat: "ups", oids: [], sysDescr: "ups|uninterruptible", conf: 0.88,
      fields: { model: "1.3.6.1.2.1.33.1.1.2.0", firmware: "1.3.6.1.2.1.33.1.1.3.0" } },
    // STAMPANTI
    { id: "hp_printer", name: "HP JetDirect (LaserJet)", cat: "stampante", oids: ["1.3.6.1.4.1.11.2.3.9"], conf: 0.97,
      fields: { serial: "1.3.6.1.4.1.11.2.3.9.1.1.7.0", model: "1.3.6.1.4.1.11.2.3.9.4.2.1.1.1.1.20.1" } },
    { id: "epson", name: "Epson Printer", cat: "stampante", oids: ["1.3.6.1.4.1.1248"], conf: 0.96,
      fields: { model: "1.3.6.1.2.1.47.1.1.1.1.13.1", serial: "1.3.6.1.2.1.43.5.1.1.16.1" } },
    { id: "printer_generic", name: "Printer (RFC 3805)", cat: "stampante", oids: [], sysDescr: "printer|laserjet|deskjet|officejet|multifunction|mfp", conf: 0.88,
      fields: { serial: "1.3.6.1.2.1.43.5.1.1.16.1" } },
  ];

  // Se la tabella è vuota, inserisci tutti; altrimenti inserisci solo i profili builtin mancanti
  if (count === 0) {
    const t = db.transaction(() => {
      for (const p of profiles) {
        ins.run(
          p.id, p.name, p.cat,
          JSON.stringify(p.oids),
          p.sysDescr ?? null,
          JSON.stringify(p.fields),
          p.conf
        );
      }
    });
    t();
  } else {
    // Inserisci solo profili builtin che non esistono ancora nel DB
    const existingIds = new Set(
      (db.prepare("SELECT profile_id FROM snmp_vendor_profiles").all() as Array<{ profile_id: string }>)
        .map((r) => r.profile_id)
    );
    const missing = profiles.filter((p) => !existingIds.has(p.id));
    if (missing.length > 0) {
      const t = db.transaction(() => {
        for (const p of missing) {
          ins.run(
            p.id, p.name, p.cat,
            JSON.stringify(p.oids),
            p.sysDescr ?? null,
            JSON.stringify(p.fields),
            p.conf
          );
        }
      });
      t();
    }
  }
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

export function getNetworkContainingIp(ip: string): Network | undefined {
  const { isIpInCidr } = require("./utils") as { isIpInCidr: (ip: string, cidr: string) => boolean };
  const networks = getDb().prepare("SELECT * FROM networks").all() as Network[];
  for (const net of networks) {
    if (isIpInCidr(ip, net.cidr)) {
      return net;
    }
  }
  return undefined;
}

/**
 * Pre-carica tutte le reti e ritorna una funzione di lookup in-memory.
 * Usare al posto di getNetworkContainingIp() quando si devono risolvere
 * molti IP in un loop (evita N+1 query).
 */
export function buildNetworkLookup(): (ip: string) => Network | undefined {
  const { ipToLong, parseCidr } = require("./utils") as {
    ipToLong: (ip: string) => number;
    parseCidr: (cidr: string) => { networkLong: number; broadcastLong: number; prefix: number };
  };
  const networks = getDb().prepare("SELECT * FROM networks").all() as Network[];
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

/** Tutti gli host (tutte le reti), per lista dispositivi unificata. limit opzionale (default 10000). */
export function getAllHosts(limit: number = 10000): Host[] {
  const hosts = getDb()
    .prepare("SELECT * FROM hosts ORDER BY network_id, ip LIMIT ?")
    .all(limit) as Host[];
  return hosts.sort((a, b) => {
    if (a.network_id !== b.network_id) return a.network_id - b.network_id;
    return ipToNum(a.ip) - ipToNum(b.ip);
  });
}

/** Hosts con device associato in una sola query (evita N+1 getNetworkDeviceByHost) */
export function getHostsByNetworkWithDevices(networkId: number): (Host & {
  device_id?: number;
  device?: { id: number; name: string; sysname: string | null; vendor: string; protocol: string };
  ad_dns_host_name?: string | null;
  multihomed?: { group_id: string; match_type: string; peers: Array<{ ip: string; network_name: string; host_id: number }> } | null;
})[] {
  const hosts = getDb().prepare(
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

  // Carica peer multi-homed in batch (evita N+1)
  const groupIds = new Set<string>();
  for (const h of hosts) {
    if (h._mh_group) groupIds.add(h._mh_group);
  }
  const peersByGroup = new Map<string, Array<{ ip: string; network_name: string; host_id: number }>>();
  if (groupIds.size > 0) {
    const placeholders = [...groupIds].map(() => "?").join(",");
    const peers = getDb().prepare(
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

export function getHostBasic(
  id: number
): Pick<Host, "id" | "ip" | "custom_name" | "hostname" | "vendor" | "device_manufacturer"> | undefined {
  return getDb()
    .prepare("SELECT id, ip, custom_name, hostname, vendor, device_manufacturer FROM hosts WHERE id = ?")
    .get(id) as Pick<Host, "id" | "ip" | "custom_name" | "hostname" | "vendor" | "device_manufacturer"> | undefined;
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

/** Merge existing open_ports JSON with new scan result (union by port+protocol). Esportato per sessione Nmap+SNMP unificata. */
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

/**
 * Sostituisce le porte di un protocollo specifico mantenendo quelle dell'altro.
 * Es: replaceProtocol="tcp" → rimuove tutte le TCP esistenti, aggiunge le nuove TCP, mantiene UDP.
 */
function mergeOpenPortsByProtocol(existing: string | null, incoming: string, replaceProtocol: "tcp" | "udp"): string {
  const existingPorts = parsePortsJson(existing);
  const incomingPorts = parsePortsJson(incoming);
  // Mantieni porte dell'altro protocollo
  const kept = existingPorts.filter((p) => p.protocol !== replaceProtocol);
  // Aggiungi le nuove porte del protocollo target
  const newOfProtocol = incomingPorts.filter((p) => p.protocol === replaceProtocol);
  const merged = [...kept, ...newOfProtocol];
  // Dedup per port:protocol
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

export function upsertHost(input: HostInput & { mac?: string; vendor?: string; hostname?: string; hostname_source?: string; dns_forward?: string; dns_reverse?: string; status?: "online" | "offline" | "unknown"; open_ports?: string; open_ports_replace?: boolean; open_ports_replace_protocol?: "tcp" | "udp"; os_info?: string; model?: string; serial_number?: string; firmware?: string | null; device_manufacturer?: string | null; detection_json?: string | null; snmp_data?: string | null; preserve_existing?: boolean }): Host {
  const existing = getDb().prepare(
    "SELECT id FROM hosts WHERE network_id = ? AND ip = ?"
  ).get(input.network_id, input.ip) as { id: number } | undefined;

  if (existing) {
    const existingRow = getDb().prepare(
      "SELECT open_ports, classification_manual, model, serial_number, firmware, device_manufacturer, os_info, mac FROM hosts WHERE id = ?"
    ).get(existing.id) as { open_ports: string | null; classification_manual?: number; model?: string | null; serial_number?: string | null; firmware?: string | null; device_manufacturer?: string | null; os_info?: string | null; mac?: string | null } | undefined;
    const classificationManual = existingRow?.classification_manual === 1;
    /** Quando preserve_existing=true (scan discovery/nmap) non si sovrascrivono dati già valorizzati */
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
    if (input.classification !== undefined && !classificationManual) {
      if (input.classification !== "unknown") {
        // preserve_existing per classification: NON applicato — le classificazioni auto-rilevate
        // possono sempre essere aggiornate da scan successivi con dati migliori.
        // Solo classification_manual=1 è protetto (via classificationManual check sopra).
        fields.push("classification = ?"); values.push(input.classification);
      } else {
        const cur = (getDb().prepare("SELECT classification FROM hosts WHERE id = ?").get(existing.id) as { classification?: string })?.classification;
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
        // Sostituisci solo porte del protocollo specificato, mantieni l'altro
        portsValue = mergeOpenPortsByProtocol(existingRow?.open_ports ?? null, input.open_ports, input.open_ports_replace_protocol);
      } else if (input.open_ports_replace) {
        // Sovrascrittura totale (deprecato, usare open_ports_replace_protocol)
        portsValue = input.open_ports;
      } else {
        // Merge union standard
        portsValue = mergeOpenPortsJson(existingRow?.open_ports ?? null, input.open_ports);
      }
      fields.push("open_ports = ?");
      values.push(portsValue);
    }
    // Campi "inventario": se preserve_existing=true, aggiorna solo se il valore corrente è vuoto/null
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
    // snmp_data si aggiorna sempre: contiene i dati più freschi e arricchisce host precedentemente parziali
    if (input.snmp_data !== undefined) { fields.push("snmp_data = ?"); values.push(input.snmp_data); }
    if (input.detection_json !== undefined) {
      let shouldUpdate = true;
      if (input.detection_json && !input.open_ports_replace) {
        try {
          const incoming = JSON.parse(input.detection_json) as { final_confidence?: number; open_ports?: number[] };
          const existingDet = (getDb().prepare("SELECT detection_json FROM hosts WHERE id = ?").get(existing.id) as { detection_json?: string | null })?.detection_json;
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
    if (input.mac !== undefined && host.mac && existing) {
      const duplicate = getDb().prepare(
        "SELECT id, ip FROM hosts WHERE network_id = ? AND mac = ? AND id != ?"
      ).get(input.network_id, host.mac, existing.id) as { id: number; ip: string } | undefined;
      if (duplicate) {
        getDb().prepare("UPDATE hosts SET conflict_flags = ? WHERE id = ?")
          .run(`mac_duplicate:${duplicate.ip}`, existing.id);
        getDb().prepare("UPDATE hosts SET conflict_flags = ? WHERE id = ?")
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

  const stmt = getDb().prepare(`
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
  const prevForMac =
    input.mac !== undefined
      ? (getDb().prepare("SELECT network_id, mac FROM hosts WHERE id = ?").get(id) as
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
  const updated = getDb().prepare("SELECT * FROM hosts WHERE id = ?").get(id) as Host | undefined;
  if (input.mac !== undefined && prevForMac && updated) {
    if (macToHex(prevForMac.mac ?? "") !== macToHex(updated.mac ?? "")) {
      syncIpAssignmentsForNetwork(prevForMac.network_id);
    }
  }
  return updated;
}

export function deleteHost(id: number): boolean {
  return getDb().prepare("DELETE FROM hosts WHERE id = ?").run(id).changes > 0;
}

/** Aggiorna known_host per più host della stessa rete. Ritorna il numero di righe aggiornate. */
export function bulkUpdateHostsKnownHost(networkId: number, hostIds: number[], knownHost: 0 | 1): number {
  if (hostIds.length === 0) return 0;
  const placeholders = hostIds.map(() => "?").join(",");
  const stmt = getDb().prepare(
    `UPDATE hosts SET known_host = ?, updated_at = datetime('now') WHERE network_id = ? AND id IN (${placeholders})`
  );
  return stmt.run(knownHost, networkId, ...hostIds).changes;
}

/** Elimina host della stessa rete (bulk). Ritorna il numero di righe eliminate. */
export function bulkDeleteHosts(networkId: number, hostIds: number[]): number {
  if (hostIds.length === 0) return 0;
  const placeholders = hostIds.map(() => "?").join(",");
  const stmt = getDb().prepare(`DELETE FROM hosts WHERE network_id = ? AND id IN (${placeholders})`);
  return stmt.run(networkId, ...hostIds).changes;
}

/** Quanti degli id appartengono alla rete indicata (nessun duplicato negli id). */
export function countHostsInNetwork(networkId: number, hostIds: number[]): number {
  if (hostIds.length === 0) return 0;
  const unique = [...new Set(hostIds)];
  const placeholders = unique.map(() => "?").join(",");
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM hosts WHERE network_id = ? AND id IN (${placeholders})`)
    .get(networkId, ...unique) as { c: number };
  return row.c;
}

/** Host conosciuti con nome/CIDR rete (per pagina monitoraggio). */
export function getKnownHostsWithNetwork(): KnownHostWithNetworkRow[] {
  return getDb()
    .prepare(
      `SELECT h.*, n.name AS network_name, n.cidr AS network_cidr
       FROM hosts h
       INNER JOIN networks n ON h.network_id = n.id
       WHERE h.known_host = 1
       ORDER BY n.name COLLATE NOCASE, h.ip`
    )
    .all() as KnownHostWithNetworkRow[];
}

/**
 * Marca host offline rispetto a un ping/scan.
 * @param scannedIps — se impostato, solo gli IP in questo insieme possono passare a offline (scansioni parziali su host selezionati/elenco). Se omesso, comportamento legacy su tutta la rete.
 */
export function markHostsOffline(networkId: number, onlineIps: string[], scannedIps?: string[]): void {
  if (scannedIps?.length) {
    const onlineSet = new Set(onlineIps);
    const toOffline = scannedIps.filter((ip) => !onlineSet.has(ip));
    if (toOffline.length === 0) return;
    const ph = toOffline.map(() => "?").join(",");
    getDb().prepare(
      `UPDATE hosts SET status = 'offline', updated_at = datetime('now') WHERE network_id = ? AND ip IN (${ph})`
    ).run(networkId, ...toOffline);
    return;
  }
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

/**
 * Per i tipi di scan "additivi" (nmap/network_discovery): invece di marcare offline,
 * aggiunge una riga nelle note dell'host con data e tipo scan per segnalare la mancata risposta.
 * Non modifica lo status né sovrascrive dati già rilevati — consente revisione manuale.
 */
export function noteHostsNonResponding(
  networkId: number,
  onlineIps: string[],
  scannedIps: string[],
  scanType: string
): void {
  const onlineSet = new Set(onlineIps);
  const nonResponding = scannedIps.filter((ip) => !onlineSet.has(ip));
  if (nonResponding.length === 0) return;
  const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const tag = `[${dateStr}] Non risposto (${scanType}) — verificare se eliminare`;
  const db = getDb();
  for (const ip of nonResponding) {
    const row = db.prepare(
      "SELECT id, notes FROM hosts WHERE network_id = ? AND ip = ?"
    ).get(networkId, ip) as { id: number; notes: string } | undefined;
    if (!row) continue;
    const existing = row.notes ?? "";
    // Evita duplicati dello stesso giorno
    if (existing.includes(`[${dateStr}]`)) continue;
    const updated = existing.trim() ? `${existing.trim()}\n${tag}` : tag;
    db.prepare(
      "UPDATE hosts SET notes = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(updated, row.id);
  }
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

/** Username/password decifrati se la credenziale esiste ed è del tipo atteso (Windows/Linux). */
export function getCredentialLoginPair(
  credentialId: number,
  expectedType: "windows" | "linux"
): { username: string; password: string } | null {
  const cred = getCredentialById(credentialId);
  if (!cred) return null;
  const type = String(cred.credential_type || "").toLowerCase();
  if (type !== expectedType) return null;
  try {
    const username = cred.encrypted_username ? decrypt(cred.encrypted_username) : "";
    const password = cred.encrypted_password ? decrypt(cred.encrypted_password) : "";
    if (username?.trim() && password?.trim()) return { username: username.trim(), password: password.trim() };
  } catch { /* ignore */ }
  return null;
}

/** Ruoli catena credenziali per subnet (detect / SNMP). */
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

/** Username/password per credenziali SSH o Linux (scan SSH unificato). */
export function getSshLinuxCredentialPair(credentialId: number): { username: string; password: string } | null {
  const cred = getCredentialById(credentialId);
  if (!cred) return null;
  const type = String(cred.credential_type || "").toLowerCase();
  if (type !== "ssh" && type !== "linux") return null;
  try {
    const username = cred.encrypted_username ? decrypt(cred.encrypted_username) : "";
    const password = cred.encrypted_password ? decrypt(cred.encrypted_password) : "";
    if (username?.trim() && password?.trim()) return { username: username.trim(), password: password.trim() };
  } catch { /* ignore */ }
  return null;
}

/** Credenziali Windows/Linux/SSH/SNMP assegnate alla subnet (ordine = priorità tentativi). */
export function getNetworkHostCredentialIds(networkId: number, role: NetworkCredentialRole): number[] {
  const rows = getDb()
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
  const db = getDb();
  db.transaction(() => {
    db.prepare(`DELETE FROM network_host_credentials WHERE network_id = ? AND role = ?`).run(networkId, role);
    const ins = db.prepare(
      `INSERT INTO network_host_credentials (network_id, credential_id, role, sort_order) VALUES (?,?,?,?)`
    );
    unique.forEach((cid, i) => ins.run(networkId, cid, role, i));
  })();
}

/** Ruoli binding detect su host (stesso nome tabella host_detect_credential). */
export type HostDetectCredentialRole = "windows" | "linux" | "ssh" | "snmp";

/** Credenziale salvata dopo primo detect riuscito (un solo tentativo per credenziale in scan). */
export function getHostDetectCredentialId(hostId: number, role: HostDetectCredentialRole): number | null {
  const row = getDb()
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
  getDb()
    .prepare(
      `INSERT INTO host_detect_credential (host_id, role, credential_id, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(host_id, role) DO UPDATE SET credential_id = excluded.credential_id, updated_at = datetime('now')`
    )
    .run(hostId, role, credentialId);
}

export function deleteHostDetectCredential(hostId: number, role: HostDetectCredentialRole): void {
  getDb().prepare(`DELETE FROM host_detect_credential WHERE host_id = ? AND role = ?`).run(hostId, role);
}

/** Credenziali archiviate per host (detect) con nome per UI. */
export function getHostDetectCredentialsEnriched(hostId: number): Array<{
  role: HostDetectCredentialRole;
  credential_id: number;
  credential_name: string;
}> {
  const rows = getDb()
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

/** Ordine: credenziali della rete, poi quella globale Impostazioni (se non già in elenco). */
export function getOrderedDetectCredentialIds(networkId: number, role: "windows" | "linux"): number[] {
  const netIds = getNetworkHostCredentialIds(networkId, role);
  const globalKey = role === "windows" ? "host_windows_credential_id" : "host_linux_credential_id";
  const gStr = getSetting(globalKey);
  const gId = gStr?.trim() ? parseInt(gStr, 10) : NaN;
  const out: number[] = [...netIds];
  if (!Number.isNaN(gId) && gId > 0 && !out.includes(gId)) out.push(gId);
  return out;
}

/**
 * Catena SSH per scan: credenziali ruolo `ssh` sulla rete, poi `linux`, poi globale Impostazioni.
 * Ordine e dedup preservati.
 */
export function getOrderedSshLinuxCredentialIds(networkId: number): number[] {
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

/**
 * Community SNMP per scan su una rete: credenziali SNMP della subnet (ordine),
 * poi override profilo/scan, poi community di default sulla rete, infine public/private.
 */
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

/**
 * Community SNMP per un host: se in `host_detect_credential` è forzata una credenziale SNMP,
 * usa **solo** quella community (come richiesto per scan vincolati); altrimenti stessa logica di
 * {@link buildSnmpCommunitiesForNetwork}.
 */
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

// ═══════════════════════════════════════════════════════════════════════════
// CREDENTIAL SYSTEM v2: network_credentials + host_credentials
// ═══════════════════════════════════════════════════════════════════════════

export interface NetworkCredentialRow {
  id: number;
  network_id: number;
  credential_id: number;
  sort_order: number;
  credential_name: string;
  credential_type: string;
}

/** Lista unificata credenziali assegnate alla subnet (ordinate). */
export function getNetworkCredentials(networkId: number): NetworkCredentialRow[] {
  return getDb()
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

/** Sostituisce atomicamente la lista credenziali della subnet. */
export function replaceNetworkCredentials(networkId: number, credentialIds: number[]): void {
  const seen = new Set<number>();
  const unique: number[] = [];
  for (const id of credentialIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  const db = getDb();
  db.transaction(() => {
    db.prepare(`DELETE FROM network_credentials WHERE network_id = ?`).run(networkId);
    const ins = db.prepare(
      `INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, ?)`
    );
    unique.forEach((cid, i) => ins.run(networkId, cid, i));
  })();
}

/** Aggiunge una credenziale alla subnet (in coda). */
export function addNetworkCredential(networkId: number, credentialId: number): void {
  const db = getDb();
  const max = db.prepare(
    `SELECT COALESCE(MAX(sort_order), -1) AS m FROM network_credentials WHERE network_id = ?`
  ).get(networkId) as { m: number };
  db.prepare(
    `INSERT OR IGNORE INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, ?)`
  ).run(networkId, credentialId, max.m + 1);
}

/** Rimuove una credenziale dalla subnet. */
export function removeNetworkCredential(networkId: number, credentialId: number): void {
  getDb().prepare(
    `DELETE FROM network_credentials WHERE network_id = ? AND credential_id = ?`
  ).run(networkId, credentialId);
}

/** Riordina credenziali di una subnet. orderedCredentialIds = array di credential_id nell'ordine desiderato. */
export function reorderNetworkCredentials(networkId: number, orderedCredentialIds: number[]): void {
  const db = getDb();
  db.transaction(() => {
    const upd = db.prepare(
      `UPDATE network_credentials SET sort_order = ? WHERE network_id = ? AND credential_id = ?`
    );
    orderedCredentialIds.forEach((cid, i) => upd.run(i, networkId, cid));
  })();
}

/** Copia credenziali da una subnet sorgente alla destinazione (senza duplicare quelle già presenti). */
export function copyNetworkCredentials(sourceNetworkId: number, targetNetworkId: number): number {
  const db = getDb();
  const source = getNetworkCredentials(sourceNetworkId);
  const existing = new Set(
    getNetworkCredentials(targetNetworkId).map((r) => r.credential_id)
  );
  const max = db.prepare(
    `SELECT COALESCE(MAX(sort_order), -1) AS m FROM network_credentials WHERE network_id = ?`
  ).get(targetNetworkId) as { m: number };
  let order = max.m + 1;
  let added = 0;
  const ins = db.prepare(
    `INSERT OR IGNORE INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, ?)`
  );
  db.transaction(() => {
    for (const s of source) {
      if (existing.has(s.credential_id)) continue;
      ins.run(targetNetworkId, s.credential_id, order++);
      added++;
    }
  })();
  return added;
}

/** Subnet che hanno almeno una credenziale configurata (per UI "importa da altra subnet"). */
export function getNetworksWithCredentials(): Array<{ id: number; name: string; cidr: string; credential_count: number }> {
  return getDb()
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

// ── host_credentials CRUD ──

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

/** Credenziali associate a un host (con JOIN per nome/tipo). */
export function getHostCredentials(hostId: number): HostCredentialRow[] {
  return getDb()
    .prepare(
      `SELECT hc.*, c.name AS credential_name, c.credential_type
       FROM host_credentials hc
       JOIN credentials c ON c.id = hc.credential_id
       WHERE hc.host_id = ?
       ORDER BY hc.sort_order ASC, hc.id ASC`
    )
    .all(hostId) as HostCredentialRow[];
}

/** Mappa batch: per ogni host di una rete, i protocol_type validati. Evita N+1. */
export function getHostValidatedProtocolsByNetwork(networkId: number): Map<number, string[]> {
  const rows = getDb()
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

/** Aggiunge credenziale a un host. */
export function addHostCredential(
  hostId: number,
  credentialId: number,
  protocolType: "ssh" | "snmp" | "winrm" | "api",
  port: number,
  options?: { validated?: boolean; auto_detected?: boolean }
): void {
  const db = getDb();
  const max = db.prepare(
    `SELECT COALESCE(MAX(sort_order), -1) AS m FROM host_credentials WHERE host_id = ?`
  ).get(hostId) as { m: number };
  db.prepare(
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

/** Rimuove credenziale da un host per id riga. */
export function removeHostCredential(id: number): void {
  getDb().prepare(`DELETE FROM host_credentials WHERE id = ?`).run(id);
}

/** Aggiorna stato validazione di una credenziale host. */
export function setHostCredentialValidated(id: number, validated: boolean): void {
  getDb()
    .prepare(
      `UPDATE host_credentials SET validated = ?, validated_at = ${validated ? "datetime('now')" : "NULL"} WHERE id = ?`
    )
    .run(validated ? 1 : 0, id);
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
  const isSnmpPrimary = device.protocol === "snmp_v2" || device.protocol === "snmp_v3";
  const credIds = isSnmpPrimary
    ? [device.credential_id, device.snmp_credential_id]
    : [device.snmp_credential_id, device.credential_id];
  for (const credId of credIds) {
    if (!credId) continue;
    const cred = getCredentialById(credId);
    if (!cred || String(cred.credential_type || "").toLowerCase() !== "snmp") continue;
    try {
      const username = cred.encrypted_username ? decrypt(cred.encrypted_username) : "";
      const authKey = cred.encrypted_password ? decrypt(cred.encrypted_password) : "";
      if (username?.trim() && authKey?.trim()) return { username: username.trim(), authKey: authKey.trim() };
    } catch { /* ignore */ }
  }
  return null;
}

/**
 * Porta per sessioni SNMP: con protocollo principale SNMP, evita 22/2222 lasciati per errore da SSH.
 */
export function getEffectiveSnmpPort(device: NetworkDevice): number {
  const p = device.port ?? 161;
  if (device.protocol === "snmp_v2" || device.protocol === "snmp_v3") {
    if (p === 22 || p === 2222) return 161;
    return p;
  }
  return 161;
}

/**
 * Community SNMP: con protocollo principale snmp_v2/v3 la credenziale di «gestione» è credential_id;
 * snmp_credential_id è tipicamente SNMP secondario (porte/LLDP su router). Con SSH/API prima snmp_credential_id.
 */
export function getDeviceCommunityString(device: NetworkDevice): string {
  // Prima: cerca nei bindings SNMP (nuovo sistema tabellare)
  const snmpBinding = getDb().prepare(`
    SELECT * FROM device_credential_bindings
    WHERE device_id = ? AND protocol_type = 'snmp'
    ORDER BY sort_order LIMIT 1
  `).get(device.id) as DeviceCredentialBinding | undefined;

  if (snmpBinding) {
    if (snmpBinding.credential_id) {
      const fromCred = getCredentialCommunityString(snmpBinding.credential_id);
      if (fromCred) return fromCred;
    } else if (snmpBinding.inline_encrypted_password) {
      try {
        const s = decrypt(snmpBinding.inline_encrypted_password);
        if (s?.trim()) return s;
      } catch { /* fallthrough */ }
    }
  }

  // Fallback: vecchio sistema
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
  // Prima: cerca nei bindings (nuovo sistema tabellare) — primo binding SSH/WinRM/API per sort_order
  const protoType = device.protocol === "winrm" ? "winrm"
    : device.protocol === "api" ? "api"
    : "ssh";
  const binding = getDb().prepare(`
    SELECT * FROM device_credential_bindings
    WHERE device_id = ? AND protocol_type = ?
    ORDER BY sort_order LIMIT 1
  `).get(device.id, protoType) as DeviceCredentialBinding | undefined;

  if (binding) {
    if (binding.credential_id) {
      const cred = getCredentialById(binding.credential_id);
      if (cred?.encrypted_username && cred?.encrypted_password) {
        try { return { username: decrypt(cred.encrypted_username), password: decrypt(cred.encrypted_password) }; }
        catch { /* fallthrough */ }
      }
    } else if (binding.inline_username && binding.inline_encrypted_password) {
      try { return { username: binding.inline_username, password: decrypt(binding.inline_encrypted_password) }; }
      catch { /* fallthrough */ }
    }
  }

  // Fallback: vecchio sistema (credential_id diretto sul device)
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

type CreateDeviceInput = Omit<NetworkDevice, "id" | "created_at" | "updated_at" | "sysname" | "sysdescr" | "model" | "firmware" | "serial_number" | "part_number" | "last_info_update" | "last_device_info_json" | "classification" | "stp_info" | "last_proxmox_scan_at" | "last_proxmox_scan_result" | "scan_target" | "product_profile"> & {
  classification?: string | null;
  scan_target?: string | null;
  product_profile?: string | null;
};

export function createNetworkDevice(input: CreateDeviceInput): NetworkDevice {
  const stmt = getDb().prepare(
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
  return getDb().prepare("SELECT * FROM network_devices WHERE id = ?").get(result.lastInsertRowid) as NetworkDevice;
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
  if (["nas", "nas_synology", "nas_qnap", "storage"].includes(c)) return "NAS";
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
// Device Neighbors (LLDP/CDP/MNDP)
// ========================

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
  const db = getDb();
  const del = db.prepare("DELETE FROM device_neighbors WHERE device_id = ?");
  const ins = db.prepare(`
    INSERT INTO device_neighbors (device_id, local_port, remote_device_name, remote_port, protocol, remote_ip, remote_mac, remote_platform)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    del.run(deviceId);
    for (const n of neighbors) {
      ins.run(deviceId, n.localPort, n.remoteDevice, n.remotePort, n.protocol, n.remoteIp ?? null, n.remoteMac ?? null, n.remotePlatform ?? null);
    }
  })();
}

export function getNeighborsByDevice(deviceId: number): DbNeighborEntry[] {
  return getDb().prepare(
    "SELECT * FROM device_neighbors WHERE device_id = ? ORDER BY local_port, protocol"
  ).all(deviceId) as DbNeighborEntry[];
}

// ========================
// Device Routes (Routing Table)
// ========================

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
  const db = getDb();
  const del = db.prepare("DELETE FROM routing_table WHERE device_id = ?");
  const ins = db.prepare(`
    INSERT INTO routing_table (device_id, destination, gateway, interface_name, protocol, metric, distance, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
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
  return getDb().prepare(sql).all(deviceId) as DbRouteEntry[];
}

// ========================
// Device Credential Bindings
// ========================

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
  // JOIN fields
  credential_name?: string | null;
  credential_type?: string | null;
}

export function getDeviceCredentialBindings(deviceId: number): DeviceCredentialBinding[] {
  return getDb().prepare(`
    SELECT dcb.*, c.name AS credential_name, c.credential_type
    FROM device_credential_bindings dcb
    LEFT JOIN credentials c ON c.id = dcb.credential_id
    WHERE dcb.device_id = ?
    ORDER BY dcb.sort_order, dcb.id
  `).all(deviceId) as DeviceCredentialBinding[];
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
  const db = getDb();
  // sort_order = max + 1 se non specificato
  const maxOrder = (db.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) as m FROM device_credential_bindings WHERE device_id = ?"
  ).get(input.device_id) as { m: number }).m;
  const sortOrder = input.sort_order ?? maxOrder + 1;

  const result = db.prepare(`
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

  return db.prepare(`
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
  // Quando si assegna un credential_id, rimuovi inline; viceversa se inline, rimuovi credential_id
  if (updates.credential_id != null) {
    sets.push("inline_username = NULL", "inline_encrypted_password = NULL");
  } else if (updates.inline_username !== undefined || updates.inline_encrypted_password !== undefined) {
    sets.push("credential_id = NULL");
  }
  params.push(bindingId);
  getDb().prepare(`UPDATE device_credential_bindings SET ${sets.join(", ")} WHERE id = ?`).run(...params);
}

export function deleteDeviceCredentialBinding(bindingId: number): void {
  getDb().prepare("DELETE FROM device_credential_bindings WHERE id = ?").run(bindingId);
}

export function reorderDeviceCredentialBindings(deviceId: number, orderedIds: number[]): void {
  const db = getDb();
  const stmt = db.prepare("UPDATE device_credential_bindings SET sort_order = ? WHERE id = ? AND device_id = ?");
  db.transaction(() => {
    for (let i = 0; i < orderedIds.length; i++) {
      stmt.run(i, orderedIds[i], deviceId);
    }
  })();
}

export function updateBindingTestStatus(bindingId: number, status: "success" | "failed", message: string): void {
  getDb().prepare(`
    UPDATE device_credential_bindings SET test_status = ?, test_message = ?, tested_at = datetime('now') WHERE id = ?
  `).run(status, message, bindingId);
}

/** Cerca un binding identico (stesso device, credential, protocollo, porta) per evitare duplicati auto-detect */
export function findExistingBinding(deviceId: number, credentialId: number, protocolType: string, port: number): DeviceCredentialBinding | null {
  return getDb().prepare(`
    SELECT dcb.*, c.name AS credential_name, c.credential_type
    FROM device_credential_bindings dcb
    LEFT JOIN credentials c ON c.id = dcb.credential_id
    WHERE dcb.device_id = ? AND dcb.credential_id = ? AND dcb.protocol_type = ? AND dcb.port = ?
  `).get(deviceId, credentialId, protocolType, port) as DeviceCredentialBinding | null;
}

/** Ritorna il primo binding funzionante (sort_order più basso con test_status=success) per un protocollo */
export function getPrimaryBindingForProtocol(deviceId: number, protocolType: string): DeviceCredentialBinding | null {
  return getDb().prepare(`
    SELECT dcb.*, c.name AS credential_name, c.credential_type
    FROM device_credential_bindings dcb
    LEFT JOIN credentials c ON c.id = dcb.credential_id
    WHERE dcb.device_id = ? AND dcb.protocol_type = ? AND dcb.test_status = 'success'
    ORDER BY dcb.sort_order LIMIT 1
  `).get(deviceId, protocolType) as DeviceCredentialBinding | null;
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

/** Configurazione guidata iniziale completata (impostazione `onboarding_completed`). */
export function isOnboardingCompleted(): boolean {
  return getSetting("onboarding_completed") === "1";
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
// Fingerprint → classificazione (regole manuali)
// ========================

export interface FingerprintClassificationMapRow {
  id: number;
  match_kind: "exact" | "contains";
  pattern: string;
  classification: string;
  priority: number;
  enabled: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export function getAllFingerprintClassificationMapRows(): FingerprintClassificationMapRow[] {
  try {
    return getDb()
      .prepare(`SELECT * FROM fingerprint_classification_map ORDER BY priority ASC, id ASC`)
      .all() as FingerprintClassificationMapRow[];
  } catch {
    return [];
  }
}

/** Regole attive per discovery/refresh (priorità crescente). */
export function getFingerprintClassificationRulesForResolve(): FingerprintUserRule[] {
  try {
    const rows = getDb()
      .prepare(
        `SELECT match_kind, pattern, classification, priority FROM fingerprint_classification_map WHERE enabled = 1 ORDER BY priority ASC, id ASC`
      )
      .all() as { match_kind: string; pattern: string; classification: string; priority: number }[];
    return rows.map((r) => ({
      match_kind: r.match_kind as "exact" | "contains",
      pattern: r.pattern,
      classification: r.classification,
      priority: r.priority,
      enabled: true,
    }));
  } catch {
    return [];
  }
}

export function createFingerprintClassificationMapRow(input: {
  match_kind: "exact" | "contains";
  pattern: string;
  classification: string;
  priority: number;
  enabled: boolean;
  note?: string | null;
}): FingerprintClassificationMapRow {
  const result = getDb()
    .prepare(
      `INSERT INTO fingerprint_classification_map (match_kind, pattern, classification, priority, enabled, note, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(
      input.match_kind,
      input.pattern.trim(),
      input.classification.trim(),
      input.priority,
      input.enabled ? 1 : 0,
      input.note?.trim() || null
    );
  const id = Number(result.lastInsertRowid);
  const row = getDb().prepare("SELECT * FROM fingerprint_classification_map WHERE id = ?").get(id) as FingerprintClassificationMapRow | undefined;
  if (!row) throw new Error("Inserimento regola fallito");
  return row;
}

export function updateFingerprintClassificationMapRow(
  id: number,
  input: {
    match_kind?: "exact" | "contains";
    pattern?: string;
    classification?: string;
    priority?: number;
    enabled?: boolean;
    note?: string | null;
  }
): FingerprintClassificationMapRow | undefined {
  const existing = getDb().prepare("SELECT id FROM fingerprint_classification_map WHERE id = ?").get(id) as { id: number } | undefined;
  if (!existing) return undefined;
  const sets: string[] = ["updated_at = datetime('now')"];
  const vals: unknown[] = [];
  if (input.match_kind !== undefined) {
    sets.push("match_kind = ?");
    vals.push(input.match_kind);
  }
  if (input.pattern !== undefined) {
    sets.push("pattern = ?");
    vals.push(input.pattern.trim());
  }
  if (input.classification !== undefined) {
    sets.push("classification = ?");
    vals.push(input.classification.trim());
  }
  if (input.priority !== undefined) {
    sets.push("priority = ?");
    vals.push(input.priority);
  }
  if (input.enabled !== undefined) {
    sets.push("enabled = ?");
    vals.push(input.enabled ? 1 : 0);
  }
  if (input.note !== undefined) {
    sets.push("note = ?");
    vals.push(input.note?.trim() || null);
  }
  vals.push(id);
  getDb().prepare(`UPDATE fingerprint_classification_map SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  return getDb().prepare("SELECT * FROM fingerprint_classification_map WHERE id = ?").get(id) as FingerprintClassificationMapRow | undefined;
}

export function deleteFingerprintClassificationMapRow(id: number): boolean {
  return getDb().prepare("DELETE FROM fingerprint_classification_map WHERE id = ?").run(id).changes > 0;
}

// ========================
// Device Fingerprint Rules (tabella unificata)
// ========================

export interface DeviceFingerprintRuleRow {
  id: number;
  name: string;
  device_label: string;
  classification: string;
  priority: number;
  enabled: number;
  tcp_ports_key: string | null;
  tcp_ports_optional: string | null;
  min_key_ports: number | null;
  oid_prefix: string | null;
  sysdescr_pattern: string | null;
  hostname_pattern: string | null;
  mac_vendor_pattern: string | null;
  banner_pattern: string | null;
  ttl_min: number | null;
  ttl_max: number | null;
  note: string | null;
  builtin: number;
  created_at: string;
  updated_at: string;
}

export function getDeviceFingerprintRules(): DeviceFingerprintRuleRow[] {
  return getDb()
    .prepare("SELECT * FROM device_fingerprint_rules ORDER BY priority ASC, id ASC")
    .all() as DeviceFingerprintRuleRow[];
}

export function getEnabledDeviceFingerprintRules(): DeviceFingerprintRuleRow[] {
  return getDb()
    .prepare("SELECT * FROM device_fingerprint_rules WHERE enabled = 1 ORDER BY priority ASC, id ASC")
    .all() as DeviceFingerprintRuleRow[];
}

export function createDeviceFingerprintRule(input: {
  name: string; device_label: string; classification: string; priority?: number;
  tcp_ports_key?: string | null; tcp_ports_optional?: string | null; min_key_ports?: number | null;
  oid_prefix?: string | null; sysdescr_pattern?: string | null; hostname_pattern?: string | null;
  mac_vendor_pattern?: string | null; banner_pattern?: string | null;
  ttl_min?: number | null; ttl_max?: number | null; note?: string | null; enabled?: boolean;
}): DeviceFingerprintRuleRow {
  const result = getDb().prepare(
    `INSERT INTO device_fingerprint_rules
     (name, device_label, classification, priority, enabled, tcp_ports_key, tcp_ports_optional, min_key_ports,
      oid_prefix, sysdescr_pattern, hostname_pattern, mac_vendor_pattern, banner_pattern, ttl_min, ttl_max, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.name.trim(), input.device_label.trim(), input.classification.trim(),
    input.priority ?? 100, input.enabled !== false ? 1 : 0,
    input.tcp_ports_key ?? null, input.tcp_ports_optional ?? null, input.min_key_ports ?? null,
    input.oid_prefix?.trim() || null, input.sysdescr_pattern?.trim() || null,
    input.hostname_pattern?.trim() || null, input.mac_vendor_pattern?.trim() || null,
    input.banner_pattern?.trim() || null, input.ttl_min ?? null, input.ttl_max ?? null,
    input.note?.trim() || null,
  );
  return getDb().prepare("SELECT * FROM device_fingerprint_rules WHERE id = ?").get(result.lastInsertRowid) as DeviceFingerprintRuleRow;
}

export function updateDeviceFingerprintRule(id: number, input: Partial<{
  name: string; device_label: string; classification: string; priority: number; enabled: boolean;
  tcp_ports_key: string | null; tcp_ports_optional: string | null; min_key_ports: number | null;
  oid_prefix: string | null; sysdescr_pattern: string | null; hostname_pattern: string | null;
  mac_vendor_pattern: string | null; banner_pattern: string | null;
  ttl_min: number | null; ttl_max: number | null; note: string | null;
}>): DeviceFingerprintRuleRow | undefined {
  const existing = getDb().prepare("SELECT id FROM device_fingerprint_rules WHERE id = ?").get(id) as { id: number } | undefined;
  if (!existing) return undefined;
  const sets: string[] = ["updated_at = datetime('now')"];
  const vals: unknown[] = [];
  const field = (col: string, val: unknown) => { sets.push(`${col} = ?`); vals.push(val); };
  if (input.name !== undefined) field("name", input.name.trim());
  if (input.device_label !== undefined) field("device_label", input.device_label.trim());
  if (input.classification !== undefined) field("classification", input.classification.trim());
  if (input.priority !== undefined) field("priority", input.priority);
  if (input.enabled !== undefined) field("enabled", input.enabled ? 1 : 0);
  if (input.tcp_ports_key !== undefined) field("tcp_ports_key", input.tcp_ports_key);
  if (input.tcp_ports_optional !== undefined) field("tcp_ports_optional", input.tcp_ports_optional);
  if (input.min_key_ports !== undefined) field("min_key_ports", input.min_key_ports);
  if (input.oid_prefix !== undefined) field("oid_prefix", input.oid_prefix?.trim() || null);
  if (input.sysdescr_pattern !== undefined) field("sysdescr_pattern", input.sysdescr_pattern?.trim() || null);
  if (input.hostname_pattern !== undefined) field("hostname_pattern", input.hostname_pattern?.trim() || null);
  if (input.mac_vendor_pattern !== undefined) field("mac_vendor_pattern", input.mac_vendor_pattern?.trim() || null);
  if (input.banner_pattern !== undefined) field("banner_pattern", input.banner_pattern?.trim() || null);
  if (input.ttl_min !== undefined) field("ttl_min", input.ttl_min);
  if (input.ttl_max !== undefined) field("ttl_max", input.ttl_max);
  if (input.note !== undefined) field("note", input.note?.trim() || null);
  vals.push(id);
  getDb().prepare(`UPDATE device_fingerprint_rules SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  return getDb().prepare("SELECT * FROM device_fingerprint_rules WHERE id = ?").get(id) as DeviceFingerprintRuleRow | undefined;
}

export function deleteDeviceFingerprintRule(id: number): boolean {
  return getDb().prepare("DELETE FROM device_fingerprint_rules WHERE id = ?").run(id).changes > 0;
}

export function resetBuiltinFingerprintRules(): void {
  getDb().prepare("DELETE FROM device_fingerprint_rules WHERE builtin = 1").run();
  seedBuiltinFingerprintRules(getDb());
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
  /** Elenco porte TCP esplicito (sovrascrive default se presente) */
  tcp_ports: string | null;
  /** Elenco porte UDP esplicito (sovrascrive default se presente) */
  udp_ports: string | null;
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

/**
 * Profilo usato da scansioni Nmap (trigger, job) quando non si passa `nmap_profile_id`.
 * Deve essere il profilo **predefinito** (`is_default = 1`), come quello modificabile in Impostazioni
 * — non l’ultimo aggiornato per qualsiasi profilo (evita porte/argomenti da un altro profilo).
 */
export function getActiveNmapProfile(): NmapProfileRow | undefined {
  const byDefault = getDb()
    .prepare("SELECT * FROM nmap_profiles WHERE is_default = 1 ORDER BY id ASC LIMIT 1")
    .get() as NmapProfileRow | undefined;
  if (byDefault) return byDefault;
  return getDb().prepare("SELECT * FROM nmap_profiles ORDER BY updated_at DESC LIMIT 1").get() as NmapProfileRow | undefined;
}

export function createNmapProfile(
  name: string,
  description: string,
  args: string,
  snmpCommunity?: string | null,
  customPorts?: string | null,
  tcpPorts?: string | null,
  udpPorts?: string | null
): NmapProfileRow {
  const count = (getDb().prepare("SELECT COUNT(*) as c FROM nmap_profiles").get() as { c: number }).c;
  if (count > 0) {
    throw new Error("È consentito un solo profilo Nmap: modifica quello esistente dalle Impostazioni.");
  }
  const result = getDb().prepare(
    "INSERT INTO nmap_profiles (name, description, args, snmp_community, custom_ports, tcp_ports, udp_ports, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, 1)"
  ).run(name, description, args, snmpCommunity || null, customPorts ?? null, tcpPorts ?? null, udpPorts ?? null);
  return getDb().prepare("SELECT * FROM nmap_profiles WHERE id = ?").get(result.lastInsertRowid) as NmapProfileRow;
}

export function updateNmapProfile(
  id: number,
  name: string,
  description: string,
  args: string,
  snmpCommunity?: string | null,
  customPorts?: string | null,
  tcpPorts?: string | null,
  udpPorts?: string | null
): NmapProfileRow | undefined {
  getDb().prepare(
    "UPDATE nmap_profiles SET name = ?, description = ?, args = ?, snmp_community = ?, custom_ports = ?, tcp_ports = ?, udp_ports = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(name, description, args, snmpCommunity ?? null, customPorts ?? null, tcpPorts ?? null, udpPorts ?? null, id);
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

/** Reset all networks and devices for new client. Keeps nmap_profiles e regole fingerprint (vedi corpo transazione). */
export function resetConfiguration(): void {
  const db = getDb();
  db.transaction(() => {
    db.exec(`
      DELETE FROM scan_history;
      DELETE FROM status_history;
      DELETE FROM host_detect_credential;
      DELETE FROM network_host_credentials;
      DELETE FROM arp_entries;
      DELETE FROM mac_port_entries;
      DELETE FROM mac_ip_history;
      DELETE FROM mac_ip_mapping;
      DELETE FROM switch_ports;
      DELETE FROM network_router;
      DELETE FROM hosts;
      DELETE FROM network_devices;
      DELETE FROM networks;
      DELETE FROM ad_integrations;
      DELETE FROM credentials;
      DELETE FROM users;
      DELETE FROM scheduled_jobs;
      DELETE FROM settings;
      DELETE FROM proxmox_hosts;
      DELETE FROM inventory_audit_log;
      DELETE FROM license_seats;
      DELETE FROM licenses;
      DELETE FROM asset_assignees;
      DELETE FROM inventory_assets;
      DELETE FROM locations;
      DELETE FROM device_fingerprint_rules;
    `);
    db.exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('server_port', '3000')");
    db.exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('onboarding_completed', '0')");
  })();
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

// ========================
// Sync network_device da scan host
// ========================

/**
 * Aggiorna network_devices.port e classification basandosi sui dati host appena scansionati.
 * Non modifica mai **vendor** (resta impostazione manuale; vedi `vendor-device-profile.ts`).
 * - port: se la porta attuale del device non è tra le porte rilevate, assegna una porta candidata
 *   appropriata per protocollo/vendor; se il device ha già una porta presente nei dati scan, non tocca.
 * - classification: allinea se l'host ha una classificazione più specifica (solo per router/switch/hypervisor).
 * Chiamare subito dopo upsertHost quando getNetworkDeviceByHost(ip) esiste.
 */
export function syncNetworkDeviceFromHostScan(ip: string, hostOpenPorts: Array<{ port: number; protocol?: string }>, hostClassification: string | null): void {
  const device = getNetworkDeviceByHost(ip);
  if (!device) return;

  const tcpPorts = new Set(hostOpenPorts.filter((p) => (p.protocol ?? "tcp") === "tcp").map((p) => p.port));
  const updates: Partial<NetworkDevice> = {};

  // Euristica porta per protocollo / vendor
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

  // Allinea classification se l'host ha valore più specifico
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
// ACTIVE DIRECTORY INTEGRATIONS
// ═══════════════════════════════════════════════════════════════════════════

export interface AdIntegration {
  id: number;
  name: string;
  dc_host: string;
  domain: string;
  base_dn: string;
  encrypted_username: string;
  encrypted_password: string;
  use_ssl: number;
  port: number;
  enabled: number;
  winrm_credential_id: number | null;
  dhcp_leases_count: number;
  last_sync_at: string | null;
  last_sync_status: string | null;
  computers_count: number;
  users_count: number;
  groups_count: number;
  created_at: string;
  updated_at: string;
}

export interface AdComputer {
  id: number;
  integration_id: number;
  object_guid: string;
  sam_account_name: string;
  dns_host_name: string | null;
  display_name: string | null;
  distinguished_name: string;
  operating_system: string | null;
  operating_system_version: string | null;
  last_logon_at: string | null;
  enabled: number;
  host_id: number | null;
  ip_address: string | null;
  ou: string | null;
  raw_data: string | null;
  synced_at: string;
}

export interface AdUser {
  id: number;
  integration_id: number;
  object_guid: string;
  sam_account_name: string;
  user_principal_name: string | null;
  display_name: string | null;
  email: string | null;
  department: string | null;
  title: string | null;
  phone: string | null;
  ou: string | null;
  enabled: number;
  last_logon_at: string | null;
  password_last_set_at: string | null;
  raw_data: string | null;
  synced_at: string;
}

export interface AdDhcpLease {
  id: number;
  integration_id: number;
  scope_id: string;
  scope_name: string | null;
  ip_address: string;
  mac_address: string;
  hostname: string | null;
  lease_expires: string | null;
  address_state: string | null;
  description: string | null;
  last_synced: string;
}

export interface AdGroup {
  id: number;
  integration_id: number;
  object_guid: string;
  sam_account_name: string;
  display_name: string | null;
  description: string | null;
  distinguished_name: string;
  group_type: number | null;
  member_guids: string | null;
  synced_at: string;
}

export function getAdIntegrations(): AdIntegration[] {
  return getDb().prepare("SELECT * FROM ad_integrations ORDER BY name").all() as AdIntegration[];
}

/**
 * Restituisce il realm (dominio AD) dalla prima integrazione AD abilitata.
 * Usato per Kerberos auto-kinit nelle connessioni WinRM.
 */
export function getAdRealm(): { realm: string; dcHost: string } | null {
  const row = getDb().prepare(
    "SELECT domain, dc_host FROM ad_integrations WHERE enabled = 1 ORDER BY id LIMIT 1"
  ).get() as { domain: string; dc_host: string } | undefined;
  if (!row) return null;
  return { realm: row.domain, dcHost: row.dc_host };
}

export function getAdIntegrationById(id: number): AdIntegration | undefined {
  return getDb().prepare("SELECT * FROM ad_integrations WHERE id = ?").get(id) as AdIntegration | undefined;
}

export function createAdIntegration(input: {
  name: string;
  dc_host: string;
  domain: string;
  base_dn: string;
  encrypted_username: string;
  encrypted_password: string;
  use_ssl?: number;
  port?: number;
  enabled?: number;
  winrm_credential_id?: number | null;
}): AdIntegration {
  const stmt = getDb().prepare(`INSERT INTO ad_integrations
    (name, dc_host, domain, base_dn, encrypted_username, encrypted_password, use_ssl, port, enabled, winrm_credential_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const r = stmt.run(
    input.name,
    input.dc_host,
    input.domain,
    input.base_dn,
    input.encrypted_username,
    input.encrypted_password,
    input.use_ssl ?? 1,
    input.port ?? 636,
    input.enabled ?? 1,
    input.winrm_credential_id ?? null
  );
  return getAdIntegrationById(Number(r.lastInsertRowid))!;
}

export function updateAdIntegration(id: number, input: Partial<{
  name: string;
  dc_host: string;
  domain: string;
  base_dn: string;
  encrypted_username: string;
  encrypted_password: string;
  use_ssl: number;
  port: number;
  enabled: number;
  winrm_credential_id: number | null;
  dhcp_leases_count: number;
  last_sync_at: string | null;
  last_sync_status: string | null;
  computers_count: number;
  users_count: number;
  groups_count: number;
}>): AdIntegration | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined) {
      fields.push(`${k} = ?`);
      values.push(v);
    }
  }
  if (fields.length === 0) return getAdIntegrationById(id);
  fields.push("updated_at = datetime('now')");
  values.push(id);
  getDb().prepare(`UPDATE ad_integrations SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getAdIntegrationById(id);
}

export function deleteAdIntegration(id: number): boolean {
  const r = getDb().prepare("DELETE FROM ad_integrations WHERE id = ?").run(id);
  return r.changes > 0;
}

// AD Computers
export function getAdComputers(integrationId: number): AdComputer[] {
  return getDb().prepare("SELECT * FROM ad_computers WHERE integration_id = ? ORDER BY sam_account_name").all(integrationId) as AdComputer[];
}

export function getAdComputersPaginated(integrationId: number, page: number, pageSize: number, search?: string, activeDays?: number): { rows: AdComputer[]; total: number } {
  const offset = (page - 1) * pageSize;
  let whereClause = "WHERE integration_id = ?";
  const params: unknown[] = [integrationId];
  if (search?.trim()) {
    whereClause += " AND (sam_account_name LIKE ? OR dns_host_name LIKE ? OR display_name LIKE ? OR operating_system LIKE ?)";
    const s = `%${search.trim()}%`;
    params.push(s, s, s, s);
  }
  if (activeDays && activeDays > 0) {
    whereClause += ` AND last_logon_at IS NOT NULL AND last_logon_at >= datetime('now', '-${activeDays} days')`;
  }
  const total = (getDb().prepare(`SELECT COUNT(*) as c FROM ad_computers ${whereClause}`).get(...params) as { c: number }).c;
  const rows = getDb().prepare(`SELECT * FROM ad_computers ${whereClause} ORDER BY sam_account_name LIMIT ? OFFSET ?`).all(...params, pageSize, offset) as AdComputer[];
  return { rows, total };
}

export function upsertAdComputer(integrationId: number, input: {
  object_guid: string;
  sam_account_name: string;
  dns_host_name?: string | null;
  display_name?: string | null;
  distinguished_name: string;
  operating_system?: string | null;
  operating_system_version?: string | null;
  last_logon_at?: string | null;
  enabled?: number;
  host_id?: number | null;
  ip_address?: string | null;
  ou?: string | null;
  raw_data?: string | null;
}): void {
  getDb().prepare(`INSERT INTO ad_computers
    (integration_id, object_guid, sam_account_name, dns_host_name, display_name, distinguished_name, operating_system, operating_system_version, last_logon_at, enabled, host_id, ip_address, ou, raw_data, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(integration_id, object_guid) DO UPDATE SET
      sam_account_name = excluded.sam_account_name,
      dns_host_name = excluded.dns_host_name,
      display_name = excluded.display_name,
      distinguished_name = excluded.distinguished_name,
      operating_system = excluded.operating_system,
      operating_system_version = excluded.operating_system_version,
      last_logon_at = excluded.last_logon_at,
      enabled = excluded.enabled,
      host_id = excluded.host_id,
      ip_address = excluded.ip_address,
      ou = excluded.ou,
      raw_data = excluded.raw_data,
      synced_at = datetime('now')
  `).run(
    integrationId,
    input.object_guid,
    input.sam_account_name,
    input.dns_host_name ?? null,
    input.display_name ?? null,
    input.distinguished_name,
    input.operating_system ?? null,
    input.operating_system_version ?? null,
    input.last_logon_at ?? null,
    input.enabled ?? 1,
    input.host_id ?? null,
    input.ip_address ?? null,
    input.ou ?? null,
    input.raw_data ?? null
  );
}

export function linkAdComputerToHost(integrationId: number, objectGuid: string, hostId: number): void {
  getDb().prepare("UPDATE ad_computers SET host_id = ? WHERE integration_id = ? AND object_guid = ?").run(hostId, integrationId, objectGuid);
}

/**
 * Re-link AD computers ai host di una rete specifica.
 * Usa hostname, IP e MAC per fare il matching. Non crea nuovi host.
 * Chiamato dopo la scoperta rete per agganciare i dati AD già sincronizzati.
 */
export function relinkAdComputersForNetwork(networkId: number): { linked: number; enriched: number } {
  const db = getDb();
  let linked = 0;
  let enriched = 0;

  // Host della rete
  const hosts = db.prepare(
    `SELECT id, ip, mac, hostname, dns_forward, dns_reverse, os_info, classification FROM hosts WHERE network_id = ?`
  ).all(networkId) as Array<{
    id: number; ip: string; mac: string | null; hostname: string | null;
    dns_forward: string | null; dns_reverse: string | null;
    os_info: string | null; classification: string | null;
  }>;
  if (hosts.length === 0) return { linked: 0, enriched: 0 };

  // Computer AD non ancora linkati (o linkati a host di altre reti)
  const unlinked = db.prepare(
    `SELECT ac.id, ac.integration_id, ac.object_guid, ac.dns_host_name, ac.sam_account_name,
            ac.ip_address, ac.operating_system, ac.host_id
     FROM ad_computers ac
     WHERE ac.host_id IS NULL
        OR ac.host_id IN (SELECT id FROM hosts WHERE network_id = ?)`
  ).all(networkId) as Array<{
    id: number; integration_id: number; object_guid: string;
    dns_host_name: string | null; sam_account_name: string;
    ip_address: string | null; operating_system: string | null;
    host_id: number | null;
  }>;

  // Indici per lookup rapido
  const hostByIp = new Map(hosts.map((h) => [h.ip, h]));
  const hostByHostname = new Map<string, typeof hosts[0]>();
  for (const h of hosts) {
    if (h.hostname) hostByHostname.set(h.hostname.toLowerCase(), h);
    if (h.dns_reverse) hostByHostname.set(h.dns_reverse.toLowerCase(), h);
    if (h.dns_forward) hostByHostname.set(h.dns_forward.toLowerCase(), h);
  }

  const linkStmt = db.prepare(
    `UPDATE ad_computers SET host_id = ? WHERE integration_id = ? AND object_guid = ?`
  );

  // Funzione di arricchimento: AD è fonte autoritativa per hostname
  function enrichHost(hostId: number, comp: typeof unlinked[0], currentHost: typeof hosts[0]) {
    const adHostname = comp.dns_host_name || comp.sam_account_name.replace(/\$$/, "");
    const osRaw = comp.operating_system ?? "";
    const osLower = osRaw.toLowerCase();
    const classification = osLower.includes("server") ? "server_windows" : "workstation";

    // AD è la fonte più affidabile: hostname viene SEMPRE sovrascritto
    const sets: string[] = [];
    const vals: unknown[] = [];

    // Hostname: AD vince sempre
    if (adHostname) {
      sets.push("hostname = ?", "hostname_source = 'ad'");
      vals.push(adHostname);
    }

    // custom_name: se vuoto, usa il nome AD per dare un nome leggibile
    if (adHostname && !currentHost.hostname) {
      sets.push("custom_name = CASE WHEN custom_name IS NULL OR custom_name = '' THEN ? ELSE custom_name END");
      vals.push(adHostname);
    }

    // OS: AD sovrascrive se l'host non ha OS o ha "unknown"
    if (osRaw && (!currentHost.os_info || currentHost.os_info === "unknown")) {
      sets.push("os_info = ?");
      vals.push(osRaw);
    }

    // Classificazione: AD sovrascrive se l'host non ha classificazione o ha "unknown"
    if (!currentHost.classification || currentHost.classification === "unknown") {
      sets.push("classification = ?");
      vals.push(classification);
    }

    if (sets.length > 0) {
      sets.push("updated_at = datetime('now')");
      db.prepare(`UPDATE hosts SET ${sets.join(", ")} WHERE id = ?`).run(...vals, hostId);
      enriched++;
    }
  }

  db.transaction(() => {
    for (const comp of unlinked) {
      const dnsHostName = comp.dns_host_name?.toLowerCase() ?? "";
      const samName = comp.sam_account_name.replace(/\$$/, "").toLowerCase();
      const shortDns = dnsHostName.split(".")[0];

      // Match per hostname
      let host = hostByHostname.get(dnsHostName)
        ?? hostByHostname.get(samName)
        ?? hostByHostname.get(shortDns);

      // Match per IP
      if (!host && comp.ip_address) {
        host = hostByIp.get(comp.ip_address);
      }

      if (!host) continue;

      // Link + enrich (anche se già linkato allo stesso host, aggiorna hostname AD)
      if (comp.host_id !== host.id) {
        linkStmt.run(host.id, comp.integration_id, comp.object_guid);
        linked++;
      }

      enrichHost(host.id, comp, host);
    }
  })();

  return { linked, enriched };
}

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-HOMED DETECTION
// ═══════════════════════════════════════════════════════════════════════════

/** Hostname da escludere dal matching multi-homed (troppo generici). */
const MH_HOSTNAME_BLACKLIST = new Set([
  "localhost", "router", "switch", "firewall", "gateway", "server",
  "ap", "nas", "printer", "unknown", "default", "test",
]);

/**
 * Ricalcola i link multi-homed: stesso dispositivo fisico con IP in subnet diverse.
 * Match per: serial_number > sysName SNMP > hostname > AD dns_host_name.
 * Solo gruppi con host in ≥2 reti diverse.
 */
export function recomputeMultihomedLinks(): { groups: number; hosts_linked: number } {
  const db = getDb();

  const hosts = db.prepare(`
    SELECT h.id, h.network_id, h.ip, h.hostname, h.serial_number, h.snmp_data, h.custom_name,
           nd.sysname AS dev_sysname, nd.serial_number AS dev_serial,
           ac.dns_host_name AS ad_dns
    FROM hosts h
    LEFT JOIN network_devices nd ON nd.host = h.ip
    LEFT JOIN (
      SELECT host_id, MAX(dns_host_name) as dns_host_name
      FROM ad_computers WHERE host_id IS NOT NULL
      GROUP BY host_id
    ) ac ON ac.host_id = h.id
  `).all() as Array<{
    id: number; network_id: number; ip: string;
    hostname: string | null; serial_number: string | null;
    snmp_data: string | null; custom_name: string | null;
    dev_sysname: string | null; dev_serial: string | null;
    ad_dns: string | null;
  }>;

  // Key → Set<host_id>
  const buckets = new Map<string, Set<number>>();
  const hostNet = new Map<number, number>();
  const PRIORITY: Record<string, number> = { serial_number: 4, sysname: 3, hostname: 2, ad_dns: 1 };
  const hostBest = new Map<number, { type: string; value: string; priority: number }>();

  function addToBucket(key: string, hostId: number, type: string, value: string) {
    if (!buckets.has(key)) buckets.set(key, new Set());
    buckets.get(key)!.add(hostId);
    const p = PRIORITY[type] ?? 0;
    const cur = hostBest.get(hostId);
    if (!cur || p > cur.priority) {
      hostBest.set(hostId, { type, value, priority: p });
    }
  }

  for (const h of hosts) {
    hostNet.set(h.id, h.network_id);

    // 1. Serial number (host o device)
    const serial = (h.serial_number || h.dev_serial || "").trim().toUpperCase();
    if (serial && serial.length >= 4) {
      addToBucket(`serial:${serial}`, h.id, "serial_number", serial);
    }

    // 2. SNMP sysName
    let sysName = h.dev_sysname ?? null;
    if (!sysName && h.snmp_data) {
      try { sysName = (JSON.parse(h.snmp_data) as { sysName?: string }).sysName ?? null; } catch { /* skip */ }
    }
    if (sysName?.trim() && !MH_HOSTNAME_BLACKLIST.has(sysName.trim().toLowerCase())) {
      addToBucket(`sysname:${sysName.trim().toLowerCase()}`, h.id, "sysname", sysName.trim());
    }

    // 3. Hostname
    const hn = (h.hostname ?? "").trim().toLowerCase();
    if (hn && hn.length >= 3 && !MH_HOSTNAME_BLACKLIST.has(hn)) {
      // Usa short hostname (prima del primo punto) per matchare FQDN con short
      const shortHn = hn.split(".")[0];
      if (shortHn.length >= 3) {
        addToBucket(`hostname:${shortHn}`, h.id, "hostname", h.hostname!.trim());
      }
    }

    // 4. AD dns_host_name
    const adDns = (h.ad_dns ?? "").trim().toLowerCase();
    if (adDns && adDns.length >= 3) {
      const shortAd = adDns.split(".")[0];
      if (shortAd.length >= 3 && !MH_HOSTNAME_BLACKLIST.has(shortAd)) {
        addToBucket(`ad_dns:${shortAd}`, h.id, "ad_dns", h.ad_dns!.trim());
      }
    }
  }

  // Filtra: solo bucket con host in ≥2 reti diverse
  // Union-find per unire bucket che condividono host
  const parent = new Map<number, number>();
  function find(x: number): number {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  }
  function union(a: number, b: number) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  for (const [, hostIds] of buckets) {
    if (hostIds.size < 2) continue;
    // Verifica che ci siano ≥2 reti diverse
    const nets = new Set<number>();
    for (const hid of hostIds) nets.add(hostNet.get(hid)!);
    if (nets.size < 2) continue;
    // Union tutti gli host del bucket
    const arr = [...hostIds];
    for (let i = 1; i < arr.length; i++) union(arr[0], arr[i]);
  }

  // Costruisci gruppi finali
  const finalGroups = new Map<number, Set<number>>();
  for (const [hid] of parent) {
    const root = find(hid);
    if (!finalGroups.has(root)) finalGroups.set(root, new Set());
    finalGroups.get(root)!.add(hid);
  }

  // Filtra gruppi: ≥2 host in ≥2 reti diverse
  let groupCount = 0;
  let totalLinked = 0;

  db.transaction(() => {
    db.prepare("DELETE FROM multihomed_links").run();
    const ins = db.prepare(
      "INSERT OR IGNORE INTO multihomed_links (group_id, host_id, match_type, match_value) VALUES (?, ?, ?, ?)"
    );

    for (const [, members] of finalGroups) {
      if (members.size < 2) continue;
      const nets = new Set<number>();
      for (const hid of members) nets.add(hostNet.get(hid)!);
      if (nets.size < 2) continue;

      const groupId = randomUUID();
      groupCount++;
      for (const hid of members) {
        const best = hostBest.get(hid);
        if (best) {
          ins.run(groupId, hid, best.type, best.value);
          totalLinked++;
        }
      }
    }
  })();

  return { groups: groupCount, hosts_linked: totalLinked };
}

// AD Users
export function getAdUsers(integrationId: number): AdUser[] {
  return getDb().prepare("SELECT * FROM ad_users WHERE integration_id = ? ORDER BY sam_account_name").all(integrationId) as AdUser[];
}

export function getAdUsersPaginated(integrationId: number, page: number, pageSize: number, search?: string, activeDays?: number): { rows: AdUser[]; total: number } {
  const offset = (page - 1) * pageSize;
  let whereClause = "WHERE integration_id = ?";
  const params: unknown[] = [integrationId];
  if (search?.trim()) {
    whereClause += " AND (sam_account_name LIKE ? OR user_principal_name LIKE ? OR display_name LIKE ? OR email LIKE ? OR department LIKE ?)";
    const s = `%${search.trim()}%`;
    params.push(s, s, s, s, s);
  }
  if (activeDays && activeDays > 0) {
    whereClause += ` AND last_logon_at IS NOT NULL AND last_logon_at >= datetime('now', '-${activeDays} days')`;
  }
  const total = (getDb().prepare(`SELECT COUNT(*) as c FROM ad_users ${whereClause}`).get(...params) as { c: number }).c;
  const rows = getDb().prepare(`SELECT * FROM ad_users ${whereClause} ORDER BY sam_account_name LIMIT ? OFFSET ?`).all(...params, pageSize, offset) as AdUser[];
  return { rows, total };
}

export function upsertAdUser(integrationId: number, input: {
  object_guid: string;
  sam_account_name: string;
  user_principal_name?: string | null;
  display_name?: string | null;
  email?: string | null;
  department?: string | null;
  title?: string | null;
  phone?: string | null;
  ou?: string | null;
  enabled?: number;
  last_logon_at?: string | null;
  password_last_set_at?: string | null;
  raw_data?: string | null;
}): void {
  getDb().prepare(`INSERT INTO ad_users
    (integration_id, object_guid, sam_account_name, user_principal_name, display_name, email, department, title, phone, ou, enabled, last_logon_at, password_last_set_at, raw_data, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(integration_id, object_guid) DO UPDATE SET
      sam_account_name = excluded.sam_account_name,
      user_principal_name = excluded.user_principal_name,
      display_name = excluded.display_name,
      email = excluded.email,
      department = excluded.department,
      title = excluded.title,
      phone = excluded.phone,
      ou = excluded.ou,
      enabled = excluded.enabled,
      last_logon_at = excluded.last_logon_at,
      password_last_set_at = excluded.password_last_set_at,
      raw_data = excluded.raw_data,
      synced_at = datetime('now')
  `).run(
    integrationId,
    input.object_guid,
    input.sam_account_name,
    input.user_principal_name ?? null,
    input.display_name ?? null,
    input.email ?? null,
    input.department ?? null,
    input.title ?? null,
    input.phone ?? null,
    input.ou ?? null,
    input.enabled ?? 1,
    input.last_logon_at ?? null,
    input.password_last_set_at ?? null,
    input.raw_data ?? null
  );
}

// AD Groups
export function getAdGroups(integrationId: number): AdGroup[] {
  return getDb().prepare("SELECT * FROM ad_groups WHERE integration_id = ? ORDER BY sam_account_name").all(integrationId) as AdGroup[];
}

export function getAdGroupsPaginated(integrationId: number, page: number, pageSize: number, search?: string): { rows: AdGroup[]; total: number } {
  const offset = (page - 1) * pageSize;
  let whereClause = "WHERE integration_id = ?";
  const params: unknown[] = [integrationId];
  if (search?.trim()) {
    whereClause += " AND (sam_account_name LIKE ? OR display_name LIKE ? OR description LIKE ?)";
    const s = `%${search.trim()}%`;
    params.push(s, s, s);
  }
  const total = (getDb().prepare(`SELECT COUNT(*) as c FROM ad_groups ${whereClause}`).get(...params) as { c: number }).c;
  const rows = getDb().prepare(`SELECT * FROM ad_groups ${whereClause} ORDER BY sam_account_name LIMIT ? OFFSET ?`).all(...params, pageSize, offset) as AdGroup[];
  return { rows, total };
}

export function upsertAdGroup(integrationId: number, input: {
  object_guid: string;
  sam_account_name: string;
  display_name?: string | null;
  description?: string | null;
  distinguished_name: string;
  group_type?: number | null;
  member_guids?: string | null;
}): void {
  getDb().prepare(`INSERT INTO ad_groups
    (integration_id, object_guid, sam_account_name, display_name, description, distinguished_name, group_type, member_guids, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(integration_id, object_guid) DO UPDATE SET
      sam_account_name = excluded.sam_account_name,
      display_name = excluded.display_name,
      description = excluded.description,
      distinguished_name = excluded.distinguished_name,
      group_type = excluded.group_type,
      member_guids = excluded.member_guids,
      synced_at = datetime('now')
  `).run(
    integrationId,
    input.object_guid,
    input.sam_account_name,
    input.display_name ?? null,
    input.description ?? null,
    input.distinguished_name,
    input.group_type ?? null,
    input.member_guids ?? null
  );
}

export function clearAdData(integrationId: number): void {
  getDb().prepare("DELETE FROM ad_computers WHERE integration_id = ?").run(integrationId);
  getDb().prepare("DELETE FROM ad_users WHERE integration_id = ?").run(integrationId);
  getDb().prepare("DELETE FROM ad_groups WHERE integration_id = ?").run(integrationId);
  getDb().prepare("DELETE FROM ad_dhcp_leases WHERE integration_id = ?").run(integrationId);
}

// AD DHCP Leases
export function getAdDhcpLeasesPaginated(integrationId: number, page: number, pageSize: number, search?: string): { rows: AdDhcpLease[]; total: number } {
  const offset = (page - 1) * pageSize;
  let whereClause = "WHERE integration_id = ?";
  const params: unknown[] = [integrationId];
  if (search?.trim()) {
    whereClause += " AND (hostname LIKE ? OR ip_address LIKE ? OR mac_address LIKE ? OR scope_id LIKE ?)";
    const s = `%${search.trim()}%`;
    params.push(s, s, s, s);
  }
  const total = (getDb().prepare(`SELECT COUNT(*) as c FROM ad_dhcp_leases ${whereClause}`).get(...params) as { c: number }).c;
  const rows = getDb().prepare(`SELECT * FROM ad_dhcp_leases ${whereClause} ORDER BY ip_address LIMIT ? OFFSET ?`).all(...params, pageSize, offset) as AdDhcpLease[];
  return { rows, total };
}

export function upsertAdDhcpLease(integrationId: number, input: {
  scope_id: string;
  scope_name?: string | null;
  ip_address: string;
  mac_address: string;
  hostname?: string | null;
  lease_expires?: string | null;
  address_state?: string | null;
  description?: string | null;
}): void {
  const macNorm = normalizeMacForStorage(input.mac_address) ?? input.mac_address.trim();
  getDb().prepare(`INSERT INTO ad_dhcp_leases
    (integration_id, scope_id, scope_name, ip_address, mac_address, hostname, lease_expires, address_state, description, last_synced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(integration_id, ip_address) DO UPDATE SET
      scope_id = excluded.scope_id,
      scope_name = excluded.scope_name,
      mac_address = excluded.mac_address,
      hostname = excluded.hostname,
      lease_expires = excluded.lease_expires,
      address_state = excluded.address_state,
      description = excluded.description,
      last_synced = datetime('now')
  `).run(
    integrationId,
    input.scope_id,
    input.scope_name ?? null,
    input.ip_address,
    macNorm,
    input.hostname ?? null,
    input.lease_expires ?? null,
    input.address_state ?? null,
    input.description ?? null
  );
}

export function clearAdDhcpLeases(integrationId: number): void {
  getDb().prepare("DELETE FROM ad_dhcp_leases WHERE integration_id = ?").run(integrationId);
}

// ═══════════════════════════════════════════════════════════════════════════
// SNMP VENDOR PROFILES
// ═══════════════════════════════════════════════════════════════════════════

export interface SnmpVendorProfileRow {
  id: number;
  profile_id: string;
  name: string;
  category: string;
  enterprise_oid_prefixes: string;
  sysdescr_pattern: string | null;
  fields: string;
  confidence: number;
  enabled: number;
  builtin: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export function getSnmpVendorProfiles(): SnmpVendorProfileRow[] {
  return getDb().prepare("SELECT * FROM snmp_vendor_profiles ORDER BY category, name").all() as SnmpVendorProfileRow[];
}

export function getEnabledSnmpVendorProfiles(): SnmpVendorProfileRow[] {
  return getDb().prepare("SELECT * FROM snmp_vendor_profiles WHERE enabled = 1 ORDER BY confidence DESC, name").all() as SnmpVendorProfileRow[];
}

/**
 * Stringhe distinte da vendor MAC / produttore SNMP sugli host (per suggerimenti vendor dispositivo).
 */
export function getDistinctHostVendorHints(limit = 400): string[] {
  const rows = getDb()
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

export function getSnmpVendorProfileById(id: number): SnmpVendorProfileRow | undefined {
  return getDb().prepare("SELECT * FROM snmp_vendor_profiles WHERE id = ?").get(id) as SnmpVendorProfileRow | undefined;
}

export function getSnmpVendorProfileByProfileId(profileId: string): SnmpVendorProfileRow | undefined {
  return getDb().prepare("SELECT * FROM snmp_vendor_profiles WHERE profile_id = ?").get(profileId) as SnmpVendorProfileRow | undefined;
}

export function createSnmpVendorProfile(input: {
  profile_id: string;
  name: string;
  category: string;
  enterprise_oid_prefixes?: string[];
  sysdescr_pattern?: string | null;
  fields?: Record<string, string | string[]>;
  confidence?: number;
  enabled?: number;
  builtin?: number;
  note?: string | null;
}): SnmpVendorProfileRow {
  const stmt = getDb().prepare(`INSERT INTO snmp_vendor_profiles
    (profile_id, name, category, enterprise_oid_prefixes, sysdescr_pattern, fields, confidence, enabled, builtin, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const r = stmt.run(
    input.profile_id,
    input.name,
    input.category,
    JSON.stringify(input.enterprise_oid_prefixes ?? []),
    input.sysdescr_pattern ?? null,
    JSON.stringify(input.fields ?? {}),
    input.confidence ?? 0.90,
    input.enabled ?? 1,
    input.builtin ?? 0,
    input.note ?? null
  );
  return getSnmpVendorProfileById(Number(r.lastInsertRowid))!;
}

export function updateSnmpVendorProfile(id: number, input: Partial<{
  profile_id: string;
  name: string;
  category: string;
  enterprise_oid_prefixes: string[];
  sysdescr_pattern: string | null;
  fields: Record<string, string | string[]>;
  confidence: number;
  enabled: number;
  note: string | null;
}>): SnmpVendorProfileRow | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.profile_id !== undefined) { fields.push("profile_id = ?"); values.push(input.profile_id); }
  if (input.name !== undefined) { fields.push("name = ?"); values.push(input.name); }
  if (input.category !== undefined) { fields.push("category = ?"); values.push(input.category); }
  if (input.enterprise_oid_prefixes !== undefined) { fields.push("enterprise_oid_prefixes = ?"); values.push(JSON.stringify(input.enterprise_oid_prefixes)); }
  if (input.sysdescr_pattern !== undefined) { fields.push("sysdescr_pattern = ?"); values.push(input.sysdescr_pattern); }
  if (input.fields !== undefined) { fields.push("fields = ?"); values.push(JSON.stringify(input.fields)); }
  if (input.confidence !== undefined) { fields.push("confidence = ?"); values.push(input.confidence); }
  if (input.enabled !== undefined) { fields.push("enabled = ?"); values.push(input.enabled); }
  if (input.note !== undefined) { fields.push("note = ?"); values.push(input.note); }

  if (fields.length === 0) return getSnmpVendorProfileById(id);
  fields.push("updated_at = datetime('now')");
  values.push(id);

  getDb().prepare(`UPDATE snmp_vendor_profiles SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getSnmpVendorProfileById(id);
}

export function deleteSnmpVendorProfile(id: number): boolean {
  const r = getDb().prepare("DELETE FROM snmp_vendor_profiles WHERE id = ?").run(id);
  return r.changes > 0;
}

export function resetBuiltinSnmpVendorProfiles(): void {
  getDb().prepare("DELETE FROM snmp_vendor_profiles WHERE builtin = 1").run();
  seedBuiltinSnmpVendorProfiles(getDb());
}

export function exportSnmpVendorProfiles(): SnmpVendorProfileRow[] {
  return getDb().prepare("SELECT * FROM snmp_vendor_profiles ORDER BY category, name").all() as SnmpVendorProfileRow[];
}

export function importSnmpVendorProfiles(profiles: Array<{
  profile_id: string;
  name: string;
  category: string;
  enterprise_oid_prefixes: string[] | string;
  sysdescr_pattern?: string | null;
  fields: Record<string, string | string[]> | string;
  confidence?: number;
  enabled?: number;
  note?: string | null;
}>, replaceExisting: boolean = false): { imported: number; skipped: number; errors: string[] } {
  const result = { imported: 0, skipped: 0, errors: [] as string[] };

  for (const p of profiles) {
    try {
      const existing = getSnmpVendorProfileByProfileId(p.profile_id);
      if (existing) {
        if (replaceExisting && !existing.builtin) {
          updateSnmpVendorProfile(existing.id, {
            name: p.name,
            category: p.category,
            enterprise_oid_prefixes: Array.isArray(p.enterprise_oid_prefixes) ? p.enterprise_oid_prefixes : JSON.parse(p.enterprise_oid_prefixes),
            sysdescr_pattern: p.sysdescr_pattern ?? null,
            fields: typeof p.fields === "string" ? JSON.parse(p.fields) : p.fields,
            confidence: p.confidence ?? 0.90,
            enabled: p.enabled ?? 1,
            note: p.note ?? null,
          });
          result.imported++;
        } else {
          result.skipped++;
        }
      } else {
        createSnmpVendorProfile({
          profile_id: p.profile_id,
          name: p.name,
          category: p.category,
          enterprise_oid_prefixes: Array.isArray(p.enterprise_oid_prefixes) ? p.enterprise_oid_prefixes : JSON.parse(p.enterprise_oid_prefixes),
          sysdescr_pattern: p.sysdescr_pattern ?? null,
          fields: typeof p.fields === "string" ? JSON.parse(p.fields) : p.fields,
          confidence: p.confidence ?? 0.90,
          enabled: p.enabled ?? 1,
          builtin: 0,
          note: p.note ?? null,
        });
        result.imported++;
      }
    } catch (err) {
      result.errors.push(`${p.profile_id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// DHCP LEASES (unified table)
// ═══════════════════════════════════════════════════════════════════════════

export interface DhcpLease {
  id: number;
  source_type: "mikrotik" | "windows" | "cisco" | "other";
  source_device_id: number | null;
  source_name: string | null;
  server_name: string | null;
  scope_id: string | null;
  scope_name: string | null;
  ip_address: string;
  mac_address: string;
  hostname: string | null;
  status: string | null;
  lease_start: string | null;
  lease_expires: string | null;
  description: string | null;
  /** 1=dinamico (MikroTik pool), 0=statico, NULL=non noto / altra fonte */
  dynamic_lease: number | null;
  host_id: number | null;
  network_id: number | null;
  last_synced: string;
}

export interface DhcpLeaseWithRelations extends DhcpLease {
  host_hostname?: string | null;
  host_ip?: string | null;
  network_name?: string | null;
  network_cidr?: string | null;
  device_name?: string | null;
}

export function getDhcpLeases(): DhcpLeaseWithRelations[] {
  return getDb().prepare(`
    SELECT 
      d.*,
      h.hostname as host_hostname,
      h.ip as host_ip,
      n.name as network_name,
      n.cidr as network_cidr,
      nd.name as device_name
    FROM dhcp_leases d
    LEFT JOIN hosts h ON h.id = d.host_id
    LEFT JOIN networks n ON n.id = d.network_id
    LEFT JOIN network_devices nd ON nd.id = d.source_device_id
    ORDER BY d.last_synced DESC
  `).all() as DhcpLeaseWithRelations[];
}

export function getDhcpLeasesPaginated(
  page: number,
  pageSize: number,
  filters?: {
    search?: string;
    sourceType?: string;
    sourceDeviceId?: number;
    networkId?: number;
  }
): { rows: DhcpLeaseWithRelations[]; total: number } {
  const offset = (page - 1) * pageSize;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.search?.trim()) {
    const s = `%${filters.search.trim()}%`;
    conditions.push("(d.ip_address LIKE ? OR d.mac_address LIKE ? OR d.hostname LIKE ?)");
    params.push(s, s, s);
  }
  if (filters?.sourceType) {
    conditions.push("d.source_type = ?");
    params.push(filters.sourceType);
  }
  if (filters?.sourceDeviceId) {
    conditions.push("d.source_device_id = ?");
    params.push(filters.sourceDeviceId);
  }
  if (filters?.networkId) {
    conditions.push("d.network_id = ?");
    params.push(filters.networkId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const total = (getDb().prepare(`SELECT COUNT(*) as c FROM dhcp_leases d ${whereClause}`).get(...params) as { c: number }).c;
  const rows = getDb().prepare(`
    SELECT 
      d.*,
      h.hostname as host_hostname,
      h.ip as host_ip,
      n.name as network_name,
      n.cidr as network_cidr,
      nd.name as device_name
    FROM dhcp_leases d
    LEFT JOIN hosts h ON h.id = d.host_id
    LEFT JOIN networks n ON n.id = d.network_id
    LEFT JOIN network_devices nd ON nd.id = d.source_device_id
    ${whereClause}
    ORDER BY d.last_synced DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset) as DhcpLeaseWithRelations[];

  return { rows, total };
}

export function getDhcpLeasesByDevice(deviceId: number): DhcpLease[] {
  return getDb().prepare("SELECT * FROM dhcp_leases WHERE source_device_id = ? ORDER BY ip_address").all(deviceId) as DhcpLease[];
}

export function upsertDhcpLease(input: {
  source_type: "mikrotik" | "windows" | "cisco" | "other";
  source_device_id: number;
  source_name?: string | null;
  server_name?: string | null;
  scope_id?: string | null;
  scope_name?: string | null;
  ip_address: string;
  mac_address: string;
  hostname?: string | null;
  status?: string | null;
  lease_start?: string | null;
  lease_expires?: string | null;
  description?: string | null;
  host_id?: number | null;
  network_id?: number | null;
  dynamic_lease?: number | null;
}): void {
  const macNorm = normalizeMacForStorage(input.mac_address) ?? input.mac_address.trim();
  getDb().prepare(`INSERT INTO dhcp_leases
    (source_type, source_device_id, source_name, server_name, scope_id, scope_name,
     ip_address, mac_address, hostname, status, lease_start, lease_expires, description,
     dynamic_lease, host_id, network_id, last_synced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(source_device_id, ip_address) DO UPDATE SET
      source_name = excluded.source_name,
      server_name = excluded.server_name,
      scope_id = excluded.scope_id,
      scope_name = excluded.scope_name,
      mac_address = excluded.mac_address,
      hostname = excluded.hostname,
      status = excluded.status,
      lease_start = excluded.lease_start,
      lease_expires = excluded.lease_expires,
      description = excluded.description,
      dynamic_lease = COALESCE(excluded.dynamic_lease, dhcp_leases.dynamic_lease),
      host_id = COALESCE(excluded.host_id, dhcp_leases.host_id),
      network_id = COALESCE(excluded.network_id, dhcp_leases.network_id),
      last_synced = datetime('now')
  `).run(
    input.source_type,
    input.source_device_id,
    input.source_name ?? null,
    input.server_name ?? null,
    input.scope_id ?? null,
    input.scope_name ?? null,
    input.ip_address,
    macNorm,
    input.hostname ?? null,
    input.status ?? null,
    input.lease_start ?? null,
    input.lease_expires ?? null,
    input.description ?? null,
    input.dynamic_lease ?? null,
    input.host_id ?? null,
    input.network_id ?? null
  );
}

/** Aggiorna hosts.ip_assignment da dhcp_leases (rete) e ad_dhcp_leases, con match preferito su MAC poi su IP. */
export function syncIpAssignmentsForNetwork(networkId: number): number {
  const network = getNetworkById(networkId);
  if (!network) return 0;
  const rows = getDb().prepare(`SELECT id, ip, mac FROM hosts WHERE network_id = ?`).all(networkId) as {
    id: number;
    ip: string;
    mac: string | null;
  }[];
  if (rows.length === 0) return 0;
  const dhcpLeases = getDb().prepare(`SELECT * FROM dhcp_leases WHERE network_id = ?`).all(networkId) as DhcpLease[];
  const ips = rows.map((r) => r.ip);
  const placeholders = ips.map(() => "?").join(",");
  const adLeasesByIp = getDb()
    .prepare(`SELECT * FROM ad_dhcp_leases WHERE ip_address IN (${placeholders})`)
    .all(...ips) as AdDhcpLease[];
  const byIpAd = new Map<string, AdDhcpLease>();
  for (const a of adLeasesByIp) {
    if (!byIpAd.has(a.ip_address)) byIpAd.set(a.ip_address, a);
  }
  const needsFullAdForMac = rows.some((h) => !!h.mac?.trim() && !byIpAd.get(h.ip));
  const adAllRows = needsFullAdForMac
    ? (getDb().prepare(`SELECT * FROM ad_dhcp_leases`).all() as AdDhcpLease[])
    : [];
  const stmt = getDb().prepare(`UPDATE hosts SET ip_assignment = ?, updated_at = datetime('now') WHERE id = ?`);
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

/** Ricalcola assegnazione IP per tutte le reti (es. dopo sync AD DHCP). */
export function syncIpAssignmentsForAllNetworks(): number {
  const nets = getNetworks();
  let t = 0;
  for (const n of nets) {
    t += syncIpAssignmentsForNetwork(n.id);
  }
  return t;
}

export function bulkUpsertDhcpLeases(leases: Array<{
  source_type: "mikrotik" | "windows" | "cisco" | "other";
  source_device_id: number;
  source_name?: string | null;
  server_name?: string | null;
  ip_address: string;
  mac_address: string;
  hostname?: string | null;
  status?: string | null;
  lease_expires?: string | null;
  description?: string | null;
  network_id?: number | null;
  dynamic_lease?: number | null;
}>): { inserted: number; updated: number } {
  let inserted = 0;
  let updated = 0;

  const netIds = new Set<number | null>();
  const t = getDb().transaction(() => {
    for (const lease of leases) {
      const existing = getDb().prepare(
        "SELECT id FROM dhcp_leases WHERE source_device_id = ? AND ip_address = ?"
      ).get(lease.source_device_id, lease.ip_address);

      upsertDhcpLease(lease);
      if (existing) updated++;
      else inserted++;
      if (lease.network_id != null) netIds.add(lease.network_id);
    }
  });
  t();

  for (const nid of netIds) {
    if (nid != null) syncIpAssignmentsForNetwork(nid);
  }

  return { inserted, updated };
}

export function deleteDhcpLeasesByDevice(deviceId: number): number {
  const r = getDb().prepare("DELETE FROM dhcp_leases WHERE source_device_id = ?").run(deviceId);
  return r.changes;
}

export function getDhcpLeaseStats(): {
  total: number;
  bySource: Record<string, number>;
  byNetwork: Array<{ network_id: number; network_name: string; count: number }>;
} {
  const total = (getDb().prepare("SELECT COUNT(*) as c FROM dhcp_leases").get() as { c: number }).c;

  const bySourceRows = getDb().prepare(
    "SELECT source_type, COUNT(*) as c FROM dhcp_leases GROUP BY source_type"
  ).all() as Array<{ source_type: string; c: number }>;
  const bySource: Record<string, number> = {};
  for (const r of bySourceRows) bySource[r.source_type] = r.c;

  const byNetwork = getDb().prepare(`
    SELECT d.network_id, COALESCE(n.name, 'Sconosciuta') as network_name, COUNT(*) as count
    FROM dhcp_leases d
    LEFT JOIN networks n ON n.id = d.network_id
    GROUP BY d.network_id
    ORDER BY count DESC
  `).all() as Array<{ network_id: number; network_name: string; count: number }>;

  return { total, bySource, byNetwork };
}
