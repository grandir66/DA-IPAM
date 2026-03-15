export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('admin', 'viewer')),
  created_at TEXT DEFAULT (datetime('now')),
  last_login TEXT
);

CREATE TABLE IF NOT EXISTS networks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cidr TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  gateway TEXT,
  vlan_id INTEGER,
  location TEXT DEFAULT '',
  snmp_community TEXT,
  dns_server TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hosts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network_id INTEGER NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  ip TEXT NOT NULL,
  mac TEXT,
  vendor TEXT,
  hostname TEXT,
  dns_forward TEXT,
  dns_reverse TEXT,
  custom_name TEXT,
  classification TEXT DEFAULT 'unknown',
  inventory_code TEXT,
  notes TEXT DEFAULT '',
  status TEXT DEFAULT 'unknown' CHECK(status IN ('online', 'offline', 'unknown')),
  open_ports TEXT,
  os_info TEXT,
  last_seen TEXT,
  first_seen TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(network_id, ip)
);

CREATE TABLE IF NOT EXISTS scan_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
  network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
  scan_type TEXT NOT NULL CHECK(scan_type IN ('ping', 'nmap', 'arp', 'dns')),
  status TEXT NOT NULL,
  ports_open TEXT,
  raw_output TEXT,
  duration_ms INTEGER,
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS network_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  device_type TEXT NOT NULL CHECK(device_type IN ('router', 'switch')),
  vendor TEXT NOT NULL CHECK(vendor IN ('mikrotik', 'ubiquiti', 'hp', 'cisco', 'omada', 'other')),
  protocol TEXT NOT NULL CHECK(protocol IN ('ssh', 'snmp_v2', 'snmp_v3', 'api')),
  username TEXT,
  encrypted_password TEXT,
  community_string TEXT,
  api_token TEXT,
  api_url TEXT,
  port INTEGER DEFAULT 22,
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Assegnazione router per rete (ARP): quale router interroga per quale subnet
CREATE TABLE IF NOT EXISTS network_router (
  network_id INTEGER NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  router_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  PRIMARY KEY (network_id)
);

CREATE TABLE IF NOT EXISTS arp_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
  mac TEXT NOT NULL,
  ip TEXT,
  interface_name TEXT,
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mac_port_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  mac TEXT NOT NULL,
  port_name TEXT NOT NULL,
  vlan INTEGER,
  port_status TEXT CHECK(port_status IN ('up', 'down')),
  speed TEXT,
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS switch_ports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  port_index INTEGER NOT NULL,
  port_name TEXT NOT NULL,
  status TEXT CHECK(status IN ('up', 'down', 'disabled')),
  speed TEXT,
  duplex TEXT,
  vlan INTEGER,
  poe_status TEXT,
  poe_power_mw INTEGER,
  mac_count INTEGER DEFAULT 0,
  is_trunk INTEGER DEFAULT 0,
  single_mac TEXT,
  single_mac_vendor TEXT,
  single_mac_ip TEXT,
  single_mac_hostname TEXT,
  host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
  trunk_neighbor_name TEXT,
  trunk_neighbor_port TEXT,
  trunk_primary_device_id INTEGER REFERENCES network_devices(id) ON DELETE SET NULL,
  trunk_primary_name TEXT,
  timestamp TEXT DEFAULT (datetime('now')),
  UNIQUE(device_id, port_index)
);

CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK(job_type IN ('ping_sweep', 'nmap_scan', 'arp_poll', 'dns_resolve', 'cleanup')),
  interval_minutes INTEGER NOT NULL DEFAULT 60,
  last_run TEXT,
  next_run TEXT,
  enabled INTEGER DEFAULT 1,
  config TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS nmap_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  args TEXT NOT NULL,
  snmp_community TEXT,
  custom_ports TEXT,
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Default nmap profiles
INSERT OR IGNORE INTO nmap_profiles (name, description, args, snmp_community, custom_ports, is_default) VALUES
  ('Quick', 'Solo scoperta host, nessuna scansione porte', '-sn', NULL, NULL, 1),
  ('Standard', 'Top 100 porte TCP', '-sT --top-ports 100 -T4 --host-timeout 30s', NULL, NULL, 1),
  ('Completo', 'Top 1000 porte TCP con rilevamento versione', '-sT -sV --top-ports 1000 -T4 --host-timeout 120s', NULL, NULL, 1),
  ('Personalizzato', 'Top 100 TCP + porte esplicite + UDP note + SNMP con community', '', 'public', '', 0);

-- Default settings
INSERT OR IGNORE INTO settings (key, value) VALUES ('server_port', '3000');

CREATE TABLE IF NOT EXISTS status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('online', 'offline')),
  checked_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hosts_network ON hosts(network_id);
CREATE INDEX IF NOT EXISTS idx_hosts_status ON hosts(status);
CREATE INDEX IF NOT EXISTS idx_hosts_ip ON hosts(ip);
CREATE INDEX IF NOT EXISTS idx_hosts_mac ON hosts(mac);
CREATE INDEX IF NOT EXISTS idx_scan_history_host ON scan_history(host_id);
CREATE INDEX IF NOT EXISTS idx_scan_history_network ON scan_history(network_id);
CREATE INDEX IF NOT EXISTS idx_status_history_host ON status_history(host_id);
CREATE INDEX IF NOT EXISTS idx_status_history_checked ON status_history(checked_at);
CREATE INDEX IF NOT EXISTS idx_arp_entries_device ON arp_entries(device_id);
CREATE INDEX IF NOT EXISTS idx_arp_entries_mac ON arp_entries(mac);
CREATE INDEX IF NOT EXISTS idx_mac_port_entries_device ON mac_port_entries(device_id);
CREATE INDEX IF NOT EXISTS idx_mac_port_entries_mac ON mac_port_entries(mac);
CREATE INDEX IF NOT EXISTS idx_network_router_network ON network_router(network_id);
CREATE INDEX IF NOT EXISTS idx_network_router_router ON network_router(router_id);
CREATE INDEX IF NOT EXISTS idx_switch_ports_device ON switch_ports(device_id);
`;
