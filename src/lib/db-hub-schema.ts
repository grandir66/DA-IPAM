export const HUB_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codice_cliente TEXT NOT NULL UNIQUE,
  ragione_sociale TEXT NOT NULL,
  indirizzo TEXT,
  citta TEXT,
  provincia TEXT,
  cap TEXT,
  telefono TEXT,
  email TEXT,
  piva TEXT,
  cf TEXT,
  referente TEXT,
  note TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('superadmin', 'admin', 'viewer')),
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now')),
  last_login TEXT
);

CREATE TABLE IF NOT EXISTS user_tenant_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('admin', 'viewer')),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, tenant_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Default settings
INSERT OR IGNORE INTO settings (key, value) VALUES ('server_port', '3000');
INSERT OR IGNORE INTO settings (key, value) VALUES ('onboarding_completed', '0');

CREATE TABLE IF NOT EXISTS nmap_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  args TEXT NOT NULL,
  snmp_community TEXT,
  custom_ports TEXT,
  tcp_ports TEXT,
  udp_ports TEXT,
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Default nmap profile (unico profilo, editabile dalle impostazioni)
INSERT OR IGNORE INTO nmap_profiles (name, description, args, snmp_community, custom_ports, is_default) VALUES
  ('Personalizzato', 'Top 100 TCP + porte esplicite + UDP note + SNMP con community', '', 'public', '', 1);

CREATE TABLE IF NOT EXISTS snmp_vendor_profiles (
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
);

CREATE TABLE IF NOT EXISTS device_fingerprint_rules (
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
);

CREATE TABLE IF NOT EXISTS fingerprint_classification_map (
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
);

CREATE TABLE IF NOT EXISTS sysobj_lookup (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  oid TEXT NOT NULL UNIQUE,
  vendor TEXT NOT NULL,
  product TEXT NOT NULL,
  category TEXT NOT NULL,
  enterprise_id INTEGER NOT NULL,
  builtin INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
`;

export const HUB_INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_tenants_codice ON tenants(codice_cliente);
CREATE INDEX IF NOT EXISTS idx_tenants_active ON tenants(active);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_tenant_access_user ON user_tenant_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_tenant_access_tenant ON user_tenant_access(tenant_id);
CREATE INDEX IF NOT EXISTS idx_snmp_vendor_profiles_category ON snmp_vendor_profiles(category);
CREATE INDEX IF NOT EXISTS idx_snmp_vendor_profiles_enabled ON snmp_vendor_profiles(enabled);
CREATE INDEX IF NOT EXISTS idx_device_fp_rules_pri ON device_fingerprint_rules(enabled, priority ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_fingerprint_class_map_pri ON fingerprint_classification_map(enabled, priority ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_sysobj_lookup_oid ON sysobj_lookup(oid);
CREATE INDEX IF NOT EXISTS idx_sysobj_lookup_enabled ON sysobj_lookup(enabled);
`;
