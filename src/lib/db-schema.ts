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
  model TEXT,
  serial_number TEXT,
  firmware TEXT,
  device_manufacturer TEXT,
  detection_json TEXT,
  snmp_data TEXT,
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
  scan_type TEXT NOT NULL CHECK(scan_type IN ('ping', 'snmp', 'nmap', 'arp', 'dns', 'windows', 'ssh', 'network_discovery')),
  status TEXT NOT NULL,
  ports_open TEXT,
  raw_output TEXT,
  duration_ms INTEGER,
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  credential_type TEXT NOT NULL CHECK(credential_type IN ('ssh', 'snmp', 'api', 'windows', 'linux')),
  encrypted_username TEXT,
  encrypted_password TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS network_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  device_type TEXT NOT NULL CHECK(device_type IN ('router', 'switch', 'hypervisor')),
  vendor TEXT NOT NULL CHECK(vendor IN ('mikrotik', 'ubiquiti', 'hp', 'cisco', 'omada', 'stormshield', 'proxmox', 'vmware', 'linux', 'windows', 'synology', 'qnap', 'other')),
  vendor_subtype TEXT CHECK(vendor_subtype IN ('procurve', 'comware')),
  protocol TEXT NOT NULL CHECK(protocol IN ('ssh', 'snmp_v2', 'snmp_v3', 'api', 'winrm')),
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
  serial_number TEXT,
  part_number TEXT,
  last_info_update TEXT,
  last_device_info_json TEXT,
  stp_info TEXT,
  last_proxmox_scan_at TEXT,
  last_proxmox_scan_result TEXT,
  scan_target TEXT CHECK(scan_target IN ('proxmox', 'vmware', 'windows', 'linux')),
  product_profile TEXT,
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
  stp_state TEXT,
  timestamp TEXT DEFAULT (datetime('now')),
  UNIQUE(device_id, port_index)
);

CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK(job_type IN ('ping_sweep', 'snmp_scan', 'nmap_scan', 'arp_poll', 'dns_resolve', 'cleanup', 'known_host_check', 'ad_sync')),
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

-- Default nmap profile (unico profilo, editabile dalle impostazioni)
INSERT OR IGNORE INTO nmap_profiles (name, description, args, snmp_community, custom_ports, is_default) VALUES
  ('Personalizzato', 'Top 100 TCP + porte esplicite + UDP note + SNMP con community', '', 'public', '', 1);

-- Default settings
INSERT OR IGNORE INTO settings (key, value) VALUES ('server_port', '3000');
INSERT OR IGNORE INTO settings (key, value) VALUES ('onboarding_completed', '0');

CREATE TABLE IF NOT EXISTS status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('online', 'offline')),
  checked_at TEXT DEFAULT (datetime('now'))
);

-- Tabella cumulativa MAC-IP: aggrega da ARP, DHCP, switch, hosts. Aggiornata quando un MAC cambia IP.
CREATE TABLE IF NOT EXISTS mac_ip_mapping (
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
);

-- Cronologia cambi IP per MAC (analisi spostamenti)
CREATE TABLE IF NOT EXISTS mac_ip_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mac_normalized TEXT NOT NULL,
  ip TEXT NOT NULL,
  source TEXT NOT NULL,
  changed_at TEXT DEFAULT (datetime('now'))
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
CREATE INDEX IF NOT EXISTS idx_network_devices_credential ON network_devices(credential_id);
CREATE INDEX IF NOT EXISTS idx_mac_ip_mapping_mac ON mac_ip_mapping(mac_normalized);
CREATE INDEX IF NOT EXISTS idx_mac_ip_mapping_ip ON mac_ip_mapping(ip);
CREATE INDEX IF NOT EXISTS idx_mac_ip_history_mac ON mac_ip_history(mac_normalized);

-- Assegnatari asset: elenco persone a cui possono essere assegnati gli asset (diversi dagli utenti di sistema)
CREATE TABLE IF NOT EXISTS asset_assignees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  note TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Ubicazioni: sedi, edifici, stanze (gerarchia opzionale)
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  address TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Inventario asset: device di rete, host, o standalone. Molti campi opzionali.
CREATE TABLE IF NOT EXISTS inventory_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id TEXT UNIQUE,
  asset_tag TEXT,
  serial_number TEXT,
  network_device_id INTEGER REFERENCES network_devices(id) ON DELETE SET NULL,
  host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
  hostname TEXT,
  nome_prodotto TEXT,
  categoria TEXT CHECK(categoria IN ('Desktop', 'Laptop', 'Server', 'Switch', 'Firewall', 'NAS', 'Stampante', 'VM', 'Licenza', 'Access Point', 'Router', 'Other') OR categoria IS NULL),
  marca TEXT,
  modello TEXT,
  part_number TEXT,
  sede TEXT,
  reparto TEXT,
  utente_assegnatario_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  asset_assignee_id INTEGER REFERENCES asset_assignees(id) ON DELETE SET NULL,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  posizione_fisica TEXT,
  data_assegnazione TEXT,
  data_acquisto TEXT,
  data_installazione TEXT,
  data_dismissione TEXT,
  stato TEXT CHECK(stato IN ('Attivo', 'In magazzino', 'In riparazione', 'Dismesso', 'Rubato') OR stato IS NULL),
  fine_garanzia TEXT,
  fine_supporto TEXT,
  vita_utile_prevista INTEGER,
  sistema_operativo TEXT,
  versione_os TEXT,
  cpu TEXT,
  ram_gb INTEGER,
  storage_gb INTEGER,
  storage_tipo TEXT CHECK(storage_tipo IN ('SSD', 'HDD', 'NVMe') OR storage_tipo IS NULL),
  mac_address TEXT,
  ip_address TEXT,
  vlan INTEGER,
  firmware_version TEXT,
  prezzo_acquisto REAL,
  fornitore TEXT,
  numero_ordine TEXT,
  numero_fattura TEXT,
  valore_attuale REAL,
  metodo_ammortamento TEXT CHECK(metodo_ammortamento IN ('Lineare', 'Quote decrescenti') OR metodo_ammortamento IS NULL),
  centro_di_costo TEXT,
  crittografia_disco INTEGER DEFAULT 0,
  antivirus TEXT,
  gestito_da_mdr INTEGER DEFAULT 0,
  classificazione_dati TEXT CHECK(classificazione_dati IN ('Pubblico', 'Interno', 'Confidenziale', 'Riservato') OR classificazione_dati IS NULL),
  in_scope_gdpr INTEGER DEFAULT 0,
  in_scope_nis2 INTEGER DEFAULT 0,
  ultimo_audit TEXT,
  contratto_supporto TEXT,
  tipo_garanzia TEXT,
  contatto_supporto TEXT,
  ultimo_intervento TEXT,
  prossima_manutenzione TEXT,
  note_tecniche TEXT,
  technical_data TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inventory_assets_network_device ON inventory_assets(network_device_id);
CREATE INDEX IF NOT EXISTS idx_inventory_assets_host ON inventory_assets(host_id);
CREATE INDEX IF NOT EXISTS idx_inventory_assets_asset_tag ON inventory_assets(asset_tag);
CREATE INDEX IF NOT EXISTS idx_inventory_assets_serial ON inventory_assets(serial_number);
CREATE INDEX IF NOT EXISTS idx_inventory_assets_stato ON inventory_assets(stato);
CREATE INDEX IF NOT EXISTS idx_inventory_assets_fine_garanzia ON inventory_assets(fine_garanzia);
CREATE INDEX IF NOT EXISTS idx_inventory_assets_asset_assignee ON inventory_assets(asset_assignee_id);
CREATE INDEX IF NOT EXISTS idx_inventory_assets_location ON inventory_assets(location_id);

-- Licenze software (stile Snipe-IT)
CREATE TABLE IF NOT EXISTS licenses (
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
);

-- Posti licenza: ogni licenza ha N posti, assegnabili a asset o assegnatario
CREATE TABLE IF NOT EXISTS license_seats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id INTEGER NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  asset_type TEXT CHECK(asset_type IN ('inventory_asset', 'host')),
  asset_id INTEGER,
  asset_assignee_id INTEGER REFERENCES asset_assignees(id) ON DELETE SET NULL,
  assigned_at TEXT DEFAULT (datetime('now')),
  note TEXT
);

-- Audit log modifiche inventario (GDPR/NIS2 tracciabilità)
CREATE TABLE IF NOT EXISTS inventory_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES inventory_assets(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN ('create', 'update', 'delete')),
  field_name TEXT,
  old_value TEXT,
  new_value TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_asset_assignees_user ON asset_assignees(user_id);
CREATE INDEX IF NOT EXISTS idx_locations_parent ON locations(parent_id);
CREATE INDEX IF NOT EXISTS idx_license_seats_license ON license_seats(license_id);
CREATE INDEX IF NOT EXISTS idx_license_seats_asset ON license_seats(asset_type, asset_id);
CREATE INDEX IF NOT EXISTS idx_license_seats_assignee ON license_seats(asset_assignee_id);
CREATE INDEX IF NOT EXISTS idx_inventory_audit_log_asset ON inventory_audit_log(asset_id);
CREATE INDEX IF NOT EXISTS idx_inventory_audit_log_created ON inventory_audit_log(created_at);

-- Hypervisor Proxmox: configurazione per estrazione dati host e VM
CREATE TABLE IF NOT EXISTS proxmox_hosts (
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
);

CREATE INDEX IF NOT EXISTS idx_proxmox_hosts_credential ON proxmox_hosts(credential_id);

-- Performance indexes (composite e lookup frequenti)
CREATE INDEX IF NOT EXISTS idx_hosts_network_ip ON hosts(network_id, ip);
CREATE INDEX IF NOT EXISTS idx_hosts_hostname ON hosts(hostname);
CREATE INDEX IF NOT EXISTS idx_hosts_custom_name ON hosts(custom_name);
CREATE INDEX IF NOT EXISTS idx_hosts_vendor ON hosts(vendor);
CREATE INDEX IF NOT EXISTS idx_network_devices_host ON network_devices(host);
CREATE INDEX IF NOT EXISTS idx_network_devices_device_type ON network_devices(device_type);
CREATE INDEX IF NOT EXISTS idx_arp_entries_mac_timestamp ON arp_entries(mac, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_mac_port_entries_device_mac ON mac_port_entries(device_id, mac);
CREATE INDEX IF NOT EXISTS idx_status_history_checked_host ON status_history(checked_at DESC, host_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_enabled_next ON scheduled_jobs(enabled, next_run);
CREATE INDEX IF NOT EXISTS idx_hosts_network_status ON hosts(network_id, status);
CREATE INDEX IF NOT EXISTS idx_hosts_known_status ON hosts(known_host, status);
CREATE INDEX IF NOT EXISTS idx_hosts_network_mac ON hosts(network_id, mac);
CREATE INDEX IF NOT EXISTS idx_inventory_audit_log_asset_created ON inventory_audit_log(asset_id, created_at DESC);

-- Credenziali Windows/Linux aggiuntive per subnet (ordine = tentativi sequenziali)
CREATE TABLE IF NOT EXISTS network_host_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network_id INTEGER NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  credential_id INTEGER NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('windows', 'linux', 'ssh', 'snmp')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(network_id, credential_id, role)
);
CREATE INDEX IF NOT EXISTS idx_network_host_credentials_net_role ON network_host_credentials(network_id, role);

-- Credenziale usata con successo per detect (una combinazione host+ruolo)
CREATE TABLE IF NOT EXISTS host_detect_credential (
  host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('windows', 'linux', 'ssh', 'snmp')),
  credential_id INTEGER NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (host_id, role)
);

-- Mapping manuale: etichetta fingerprint (final_device) → classificazione host
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
CREATE INDEX IF NOT EXISTS idx_fingerprint_class_map_pri ON fingerprint_classification_map(enabled, priority ASC, id ASC);

-- Regole unificate fingerprint: ogni riga è una "firma" dispositivo.
-- Tutti i criteri sono opzionali (JSON): la regola matcha quando TUTTI i criteri specificati sono soddisfatti.
CREATE TABLE IF NOT EXISTS device_fingerprint_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  device_label TEXT NOT NULL,
  classification TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1,
  -- Criteri di match (tutti opzionali, JSON dove servono array/pattern)
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
CREATE INDEX IF NOT EXISTS idx_device_fp_rules_pri ON device_fingerprint_rules(enabled, priority ASC, id ASC);

-- ═══════════════════════════════════════════════════════════════════════════
-- ACTIVE DIRECTORY INTEGRATION
-- ═══════════════════════════════════════════════════════════════════════════

-- Configurazione connessione AD / LDAP
CREATE TABLE IF NOT EXISTS ad_integrations (
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
);

-- Computer AD sincronizzati
CREATE TABLE IF NOT EXISTS ad_computers (
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
);
CREATE INDEX IF NOT EXISTS idx_ad_computers_integration ON ad_computers(integration_id);
CREATE INDEX IF NOT EXISTS idx_ad_computers_host ON ad_computers(host_id);
CREATE INDEX IF NOT EXISTS idx_ad_computers_dns ON ad_computers(dns_host_name);

-- Utenti AD sincronizzati
CREATE TABLE IF NOT EXISTS ad_users (
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
);
CREATE INDEX IF NOT EXISTS idx_ad_users_integration ON ad_users(integration_id);
CREATE INDEX IF NOT EXISTS idx_ad_users_upn ON ad_users(user_principal_name);
CREATE INDEX IF NOT EXISTS idx_ad_users_email ON ad_users(email);

-- Gruppi AD sincronizzati
CREATE TABLE IF NOT EXISTS ad_groups (
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
);
CREATE INDEX IF NOT EXISTS idx_ad_groups_integration ON ad_groups(integration_id);

-- Lease DHCP da Windows Server DHCP (opzionale, richiede WinRM sul DC)
CREATE TABLE IF NOT EXISTS ad_dhcp_leases (
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
);
CREATE INDEX IF NOT EXISTS idx_ad_dhcp_leases_integration ON ad_dhcp_leases(integration_id);
CREATE INDEX IF NOT EXISTS idx_ad_dhcp_leases_mac ON ad_dhcp_leases(mac_address);

-- ═══════════════════════════════════════════════════════════════════════════
-- SNMP VENDOR PROFILES (gestione dinamica profili OID)
-- ═══════════════════════════════════════════════════════════════════════════

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
CREATE INDEX IF NOT EXISTS idx_snmp_vendor_profiles_category ON snmp_vendor_profiles(category);
CREATE INDEX IF NOT EXISTS idx_snmp_vendor_profiles_enabled ON snmp_vendor_profiles(enabled);

-- ═══════════════════════════════════════════════════════════════════════════
-- DHCP LEASES (tabella unificata per lease da tutte le fonti)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS dhcp_leases (
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
  dynamic_lease INTEGER,
  host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
  network_id INTEGER REFERENCES networks(id) ON DELETE SET NULL,
  last_synced TEXT DEFAULT (datetime('now')),
  UNIQUE(source_device_id, ip_address)
);
CREATE INDEX IF NOT EXISTS idx_dhcp_leases_source ON dhcp_leases(source_type, source_device_id);
CREATE INDEX IF NOT EXISTS idx_dhcp_leases_mac ON dhcp_leases(mac_address);
CREATE INDEX IF NOT EXISTS idx_dhcp_leases_ip ON dhcp_leases(ip_address);
CREATE INDEX IF NOT EXISTS idx_dhcp_leases_host ON dhcp_leases(host_id);
CREATE INDEX IF NOT EXISTS idx_dhcp_leases_network ON dhcp_leases(network_id);
`;
