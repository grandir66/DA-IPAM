/**
 * Schema SQL per i database tenant (spoke).
 * Ogni tenant ha il proprio SQLite con tutte le tabelle operative.
 * Le tabelle hub (users, settings, nmap_profiles, snmp_vendor_profiles,
 * device_fingerprint_rules, fingerprint_classification_map, sysobj_lookup, snmp_oid_library)
 * risiedono solo nel DB centrale.
 */

export const TENANT_SCHEMA_SQL = `
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
  targeting_mode TEXT DEFAULT 'full_subnet',
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
  known_host INTEGER DEFAULT 0,
  classification_manual INTEGER DEFAULT 0,
  last_response_time_ms INTEGER,
  monitor_ports TEXT,
  hostname_source TEXT,
  conflict_flags TEXT,
  ip_assignment TEXT DEFAULT 'unknown',
  last_seen TEXT,
  first_seen TEXT,
  physical_device_id INTEGER REFERENCES physical_devices(id) ON DELETE SET NULL,
  host_source TEXT DEFAULT 'scan',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  -- Famiglia OS derivata da os_info via keyword matching (Windows/Linux/Apple/Unknown).
  -- GENERATED VIRTUAL: si auto-aggiorna quando os_info cambia; indicizzata per
  -- filtri rapidi su /software e /vulnerabilities. Nessun trigger da mantenere.
  os_family TEXT GENERATED ALWAYS AS (
    CASE
      WHEN os_info IS NULL OR TRIM(os_info) = '' THEN 'Unknown'
      WHEN LOWER(os_info) LIKE '%windows%' THEN 'Windows'
      WHEN LOWER(os_info) LIKE '%macos%' OR LOWER(os_info) LIKE '%mac os%'
        OR LOWER(os_info) LIKE '%darwin%' OR LOWER(os_info) LIKE '%osx%' THEN 'Apple'
      WHEN LOWER(os_info) LIKE '%linux%' OR LOWER(os_info) LIKE '%ubuntu%'
        OR LOWER(os_info) LIKE '%debian%' OR LOWER(os_info) LIKE '%centos%'
        OR LOWER(os_info) LIKE '%rhel%' OR LOWER(os_info) LIKE '%red hat%'
        OR LOWER(os_info) LIKE '%fedora%' OR LOWER(os_info) LIKE '%alpine%'
        OR LOWER(os_info) LIKE '%suse%' OR LOWER(os_info) LIKE '%arch%'
        OR LOWER(os_info) LIKE '%rocky%' OR LOWER(os_info) LIKE '%almalinux%' THEN 'Linux'
      ELSE 'Unknown'
    END
  ) VIRTUAL,
  UNIQUE(network_id, ip)
);

CREATE TABLE IF NOT EXISTS scan_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
  network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
  scan_type TEXT NOT NULL CHECK(scan_type IN ('ping', 'snmp', 'nmap', 'arp', 'dns', 'windows', 'ssh', 'network_discovery', 'credential_validate', 'fast', 'ipam_full', 'scan_icmp', 'scan_nmap_base', 'scan_snmp_verify')),
  status TEXT NOT NULL,
  ports_open TEXT,
  raw_output TEXT,
  duration_ms INTEGER,
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('online', 'offline')),
  response_time_ms INTEGER,
  checked_at TEXT DEFAULT (datetime('now'))
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
  device_type TEXT NOT NULL CHECK(device_type IN ('router', 'switch', 'firewall', 'hypervisor')),
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
  use_for_arp_poll INTEGER NOT NULL DEFAULT 0,
  physical_device_id INTEGER REFERENCES physical_devices(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Identità fisica di un device. Aggrega N network_devices/hosts visibili in subnet diverse
-- ma che rappresentano lo stesso chassis. Anchor: serial_number > primary_mac > sys_object_id+sysname > sysname.
CREATE TABLE IF NOT EXISTS physical_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor TEXT,
  model TEXT,
  serial_number TEXT,
  primary_mac TEXT,
  sys_object_id TEXT,
  sysname TEXT,
  manufacturer TEXT,
  identity_confidence INTEGER NOT NULL DEFAULT 0,
  identity_anchor TEXT,
  first_seen TEXT DEFAULT (datetime('now')),
  last_seen TEXT DEFAULT (datetime('now')),
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_physical_devices_serial ON physical_devices(serial_number) WHERE serial_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_physical_devices_mac ON physical_devices(primary_mac) WHERE primary_mac IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_physical_devices_sysname ON physical_devices(sysname) WHERE sysname IS NOT NULL;

-- Interfacce fisiche/logiche di un physical_device. MAC è il discriminante principale.
-- is_virtual_mac=1 per VRRP/HSRP/CARP (00:00:5E:00:01:xx, etc) — escluso dal matching identità.
CREATE TABLE IF NOT EXISTS device_interfaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  physical_device_id INTEGER NOT NULL REFERENCES physical_devices(id) ON DELETE CASCADE,
  ifname TEXT NOT NULL,
  ifindex INTEGER,
  mac TEXT,
  status TEXT CHECK(status IN ('up','down','unknown')) DEFAULT 'unknown',
  speed_mbps INTEGER,
  type TEXT,
  is_virtual_mac INTEGER NOT NULL DEFAULT 0,
  alias TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(physical_device_id, ifname)
);
CREATE INDEX IF NOT EXISTS idx_device_interfaces_device ON device_interfaces(physical_device_id);
CREATE INDEX IF NOT EXISTS idx_device_interfaces_mac ON device_interfaces(mac) WHERE mac IS NOT NULL;

-- IP assegnati a un'interfaccia. IPv4+IPv6 (family). scope per scartare link-local/host dal multihomed.
CREATE TABLE IF NOT EXISTS device_interface_addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  interface_id INTEGER NOT NULL REFERENCES device_interfaces(id) ON DELETE CASCADE,
  ip TEXT NOT NULL,
  prefix INTEGER,
  family INTEGER NOT NULL DEFAULT 4 CHECK(family IN (4,6)),
  scope TEXT CHECK(scope IN ('global','link','host','unknown')) DEFAULT 'global',
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(interface_id, ip)
);
CREATE INDEX IF NOT EXISTS idx_device_interface_addresses_iface ON device_interface_addresses(interface_id);
CREATE INDEX IF NOT EXISTS idx_device_interface_addresses_ip ON device_interface_addresses(ip);

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
  job_type TEXT NOT NULL CHECK(job_type IN ('ping_sweep', 'snmp_scan', 'nmap_scan', 'arp_poll', 'dns_resolve', 'fast_scan', 'cleanup', 'known_host_check', 'ad_sync', 'anomaly_check', 'librenms_sync', 'vuln_sync', 'wazuh_sync')),
  interval_minutes INTEGER NOT NULL DEFAULT 60,
  last_run TEXT,
  next_run TEXT,
  enabled INTEGER DEFAULT 1,
  config TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

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

CREATE TABLE IF NOT EXISTS mac_ip_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mac_normalized TEXT NOT NULL,
  ip TEXT NOT NULL,
  source TEXT NOT NULL,
  changed_at TEXT DEFAULT (datetime('now'))
);

-- Credenziali per subnet (LEGACY)
CREATE TABLE IF NOT EXISTS network_host_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network_id INTEGER NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  credential_id INTEGER NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('windows', 'linux', 'ssh', 'snmp')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(network_id, credential_id, role)
);

-- Credenziale detect per host (LEGACY)
CREATE TABLE IF NOT EXISTS host_detect_credential (
  host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('windows', 'linux', 'ssh', 'snmp')),
  credential_id INTEGER NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (host_id, role)
);

-- CREDENTIAL SYSTEM v2: subnet-first, lista unificata
CREATE TABLE IF NOT EXISTS network_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network_id INTEGER NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  credential_id INTEGER NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(network_id, credential_id)
);

CREATE TABLE IF NOT EXISTS host_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  credential_id INTEGER NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  protocol_type TEXT NOT NULL CHECK(protocol_type IN ('ssh', 'snmp', 'winrm', 'api')),
  port INTEGER NOT NULL,
  validated INTEGER NOT NULL DEFAULT 0,
  validated_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  auto_detected INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(host_id, credential_id, protocol_type, port)
);

-- Dispositivi multi-homed
-- is_primary: per ogni group_id esattamente UN record ha is_primary=1; sugli altri
-- vengono saltate le scan costose (SNMP query, test cred, software inventory) per
-- evitare di interrogare 5 volte lo stesso device fisico tramite IP differenti.
-- Auto-pick: vedi recomputeMultihomedLinks() in db-tenant.ts.
CREATE TABLE IF NOT EXISTS multihomed_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  -- v0.2.639 audit B8: aggiunto 'physical_device'. Workaround precedente
  -- usava 'serial_number' con match_value="physical_device:<id>" e impediva
  -- una statistica per anchor type pulita.
  match_type TEXT NOT NULL CHECK(match_type IN ('serial_number', 'sysname', 'hostname', 'ad_dns', 'physical_device')),
  match_value TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(host_id)
);

-- Device credential bindings (sistema tabellare multi-credenziale)
CREATE TABLE IF NOT EXISTS device_credential_bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  credential_id INTEGER REFERENCES credentials(id) ON DELETE CASCADE,
  protocol_type TEXT NOT NULL CHECK(protocol_type IN ('ssh', 'snmp', 'winrm', 'api')),
  port INTEGER NOT NULL DEFAULT 22,
  sort_order INTEGER NOT NULL DEFAULT 0,
  inline_username TEXT,
  inline_encrypted_password TEXT,
  test_status TEXT NOT NULL DEFAULT 'untested' CHECK(test_status IN ('success', 'failed', 'untested')),
  test_message TEXT,
  tested_at TEXT,
  auto_detected INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(device_id, credential_id, protocol_type, port)
);

-- Assegnatari asset
CREATE TABLE IF NOT EXISTS asset_assignees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Ubicazioni
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  address TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Inventario asset
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
  utente_assegnatario_id INTEGER,
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
  -- ── NIS2 Fase 3: tracking sync automatico da host/discovery ──
  auto_sync_discovery INTEGER DEFAULT 1,
  last_sync_at TEXT,
  last_sync_source TEXT,
  -- ── NIS2 Fase 2: checklist protezione (art. 21 Misure tecniche e organizzative) ──
  backup_configurato INTEGER DEFAULT 0,
  backup_ultimo_test TEXT,
  patching_automatico INTEGER DEFAULT 0,
  mfa_admin INTEGER DEFAULT 0,
  log_centralizzati INTEGER DEFAULT 0,
  hardening_baseline INTEGER DEFAULT 0,
  dr_plan_documentato INTEGER DEFAULT 0,
  incident_response_documentata INTEGER DEFAULT 0,
  -- ── NIS2 Fase 1: categoria normativa, dual ownership, criticità, dati trattati ──
  categoria_nis2 TEXT CHECK(categoria_nis2 IN ('workstation', 'server', 'rete', 'storage', 'mobile', 'iot', 'supporto_rimovibile', 'servizio_cloud', 'applicazione', 'altro') OR categoria_nis2 IS NULL),
  business_owner_id INTEGER REFERENCES asset_assignees(id) ON DELETE SET NULL,
  technical_owner_id INTEGER REFERENCES asset_assignees(id) ON DELETE SET NULL,
  criticita_nis2 TEXT CHECK(criticita_nis2 IN ('bassa', 'media', 'alta', 'critica') OR criticita_nis2 IS NULL),
  dati_trattati TEXT CHECK(dati_trattati IN ('nessuno', 'personali', 'sensibili', 'finanziari', 'sanitari', 'infrastruttura_critica', 'altro') OR dati_trattati IS NULL),
  supporto_rimovibile INTEGER DEFAULT 0,
  data_review_nis2 TEXT,
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


-- ── NIS2 Fase 4: catalogo servizi e dipendenze su asset (art. 21, §12.4.2a) ──
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  stato TEXT NOT NULL DEFAULT 'attivo' CHECK(stato IN ('attivo', 'in_dismissione', 'dismesso')),
  criticita_servizio TEXT CHECK(criticita_servizio IN ('bassa', 'media', 'alta', 'critica') OR criticita_servizio IS NULL),
  in_scope_nis2 INTEGER NOT NULL DEFAULT 0,
  rto_minutes INTEGER,
  rpo_minutes INTEGER,
  business_owner_id INTEGER REFERENCES asset_assignees(id) ON DELETE SET NULL,
  technical_owner_id INTEGER REFERENCES asset_assignees(id) ON DELETE SET NULL,
  sla_url TEXT,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS service_asset_dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  asset_id INTEGER NOT NULL REFERENCES inventory_assets(id) ON DELETE CASCADE,
  dependency_type TEXT NOT NULL DEFAULT 'primario' CHECK(dependency_type IN ('primario', 'secondario', 'supporto')),
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(service_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_service_asset_deps_service ON service_asset_dependencies(service_id);
CREATE INDEX IF NOT EXISTS idx_service_asset_deps_asset ON service_asset_dependencies(asset_id);

-- Licenze software
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

-- Posti licenza
CREATE TABLE IF NOT EXISTS license_seats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id INTEGER NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  asset_type TEXT CHECK(asset_type IN ('inventory_asset', 'host')),
  asset_id INTEGER,
  asset_assignee_id INTEGER REFERENCES asset_assignees(id) ON DELETE SET NULL,
  assigned_at TEXT DEFAULT (datetime('now')),
  note TEXT
);

-- Audit log inventario
CREATE TABLE IF NOT EXISTS inventory_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES inventory_assets(id) ON DELETE CASCADE,
  user_id INTEGER,
  action TEXT NOT NULL CHECK(action IN ('create', 'update', 'delete')),
  field_name TEXT,
  old_value TEXT,
  new_value TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Proxmox hosts
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

-- Active Directory
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
  winrm_credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
  dhcp_leases_count INTEGER DEFAULT 0,
  last_sync_at TEXT,
  last_sync_status TEXT,
  computers_count INTEGER DEFAULT 0,
  users_count INTEGER DEFAULT 0,
  groups_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(dc_host, domain)
);

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
  ip_address TEXT,
  ou TEXT,
  raw_data TEXT,
  synced_at TEXT DEFAULT (datetime('now')),
  UNIQUE(integration_id, object_guid)
);

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
  phone TEXT,
  ou TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_logon_at TEXT,
  password_last_set_at TEXT,
  raw_data TEXT,
  synced_at TEXT DEFAULT (datetime('now')),
  UNIQUE(integration_id, object_guid)
);

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
  -- v0.2.659: ultima volta che il client DHCP è stato visto attivo.
  -- Per Microsoft DHCP: calcolato lato PowerShell come (LeaseExpiryTime - LeaseDuration).
  -- Per i lease "expired" o reservation inattive, è null.
  -- Permette di filtrare lease "vivi" vs relitti vecchi.
  last_seen TEXT,
  last_synced TEXT DEFAULT (datetime('now')),
  UNIQUE(integration_id, ip_address)
);

-- DHCP Leases (unified)
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
  -- v0.2.659: ultimo "visto" dal DHCP server. Per Mikrotik viene da
  -- last-seen RouterOS convertito in ISO timestamp. Per Windows DHCP
  -- viene calcolato lato PowerShell come LeaseExpiryTime - LeaseDuration.
  -- Filtrare last_seen > datetime now -N days per nascondere relitti.
  last_seen TEXT,
  host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
  network_id INTEGER REFERENCES networks(id) ON DELETE SET NULL,
  last_synced TEXT DEFAULT (datetime('now')),
  UNIQUE(source_device_id, ip_address)
);

-- Analytics: eventi anomalia rilevati automaticamente
CREATE TABLE IF NOT EXISTS anomaly_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id         INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
  network_id      INTEGER REFERENCES networks(id) ON DELETE CASCADE,
  anomaly_type    TEXT NOT NULL CHECK(anomaly_type IN ('mac_flip','new_unknown_host','port_change','uptime_anomaly','latency_anomaly')),
  severity        TEXT NOT NULL DEFAULT 'medium' CHECK(severity IN ('low','medium','high')),
  description     TEXT NOT NULL,
  detail_json     TEXT,
  acknowledged    INTEGER NOT NULL DEFAULT 0,
  acknowledged_at TEXT,
  acknowledged_by TEXT,
  detected_at     TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at     TEXT
);

-- Analytics: feedback correzione classificazione dispositivi
CREATE TABLE IF NOT EXISTS classification_feedback (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id                  INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  corrected_classification TEXT NOT NULL,
  previous_classification  TEXT,
  feature_snapshot_json    TEXT,
  fingerprint_device_label TEXT,
  fingerprint_confidence   REAL,
  corrected_by             TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Neighbors LLDP/CDP/MNDP
CREATE TABLE IF NOT EXISTS device_neighbors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  local_port TEXT NOT NULL,
  remote_device_name TEXT NOT NULL DEFAULT '',
  remote_port TEXT NOT NULL DEFAULT '',
  protocol TEXT NOT NULL CHECK(protocol IN ('lldp', 'cdp', 'mndp', 'unknown')),
  remote_ip TEXT,
  remote_mac TEXT,
  remote_platform TEXT,
  timestamp TEXT DEFAULT (datetime('now')),
  UNIQUE(device_id, local_port, remote_device_name, remote_port)
);

-- Routing table
CREATE TABLE IF NOT EXISTS routing_table (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  destination TEXT NOT NULL,
  gateway TEXT,
  interface_name TEXT,
  protocol TEXT NOT NULL CHECK(protocol IN ('connected', 'static', 'ospf', 'bgp', 'rip', 'other')),
  metric INTEGER,
  distance INTEGER,
  active INTEGER DEFAULT 1,
  timestamp TEXT DEFAULT (datetime('now')),
  UNIQUE(device_id, destination, gateway, interface_name)
);

CREATE TABLE IF NOT EXISTS librenms_host_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network_id INTEGER NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  host_ip TEXT NOT NULL,
  librenms_device_id INTEGER NOT NULL,
  librenms_hostname TEXT,
  last_synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_status TEXT,
  UNIQUE(network_id, host_ip)
);

-- ───────────────────────────────────────────────────────────────────────────
-- Integrazione Wazuh (da-wazuh.domarc.it) — singleton hub-side, ma i dati
-- vengono mirrorati nel tenant DB filtrati per match con gli host del tenant.
-- Match agent ↔ host avviene per IP (preferito), mac normalizzato, hostname.
-- Tabelle additive: nessun ALTER, ogni sync upserta per agent_id.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wazuh_agent (
  agent_id TEXT PRIMARY KEY,             -- Wazuh agent id (es. "001", "042")
  host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
  name TEXT,                             -- Wazuh agent name (di solito hostname)
  ip TEXT,                               -- IP di registrazione lato Wazuh
  mac TEXT,                              -- MAC normalizzato lowercase aa:bb:cc:dd:ee:ff (da syscollector)
  hostname TEXT,                         -- hostname riportato da syscollector/os
  os_platform TEXT,                      -- "windows"|"ubuntu"|"centos"|"darwin"|...
  os_name TEXT,                          -- nome OS leggibile
  os_version TEXT,
  os_arch TEXT,
  agent_version TEXT,                    -- es. "Wazuh v4.7.5"
  status TEXT,                           -- active|disconnected|pending|never_connected
  node_name TEXT,                        -- manager node
  manager_host TEXT,
  last_keep_alive TEXT,
  registered_at TEXT,
  synced_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wazuh_hw (
  agent_id TEXT PRIMARY KEY REFERENCES wazuh_agent(agent_id) ON DELETE CASCADE,
  board_serial TEXT,
  board_vendor TEXT,
  board_product TEXT,
  cpu_name TEXT,
  cpu_cores INTEGER,
  cpu_mhz REAL,
  ram_total_kb INTEGER,
  ram_free_kb INTEGER,
  scan_time TEXT,
  synced_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wazuh_os (
  agent_id TEXT PRIMARY KEY REFERENCES wazuh_agent(agent_id) ON DELETE CASCADE,
  hostname TEXT,
  architecture TEXT,
  os_name TEXT,
  os_version TEXT,
  os_codename TEXT,
  os_major TEXT,
  os_minor TEXT,
  os_build TEXT,
  os_platform TEXT,
  sysname TEXT,
  release TEXT,
  version_full TEXT,
  scan_time TEXT,
  synced_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wazuh_software (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES wazuh_agent(agent_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  version TEXT,
  vendor TEXT,
  architecture TEXT,
  format TEXT,                           -- "deb"|"rpm"|"win"|"pkg"|...
  source TEXT,
  install_time TEXT,
  description TEXT,
  scan_time TEXT,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(agent_id, name, version, architecture)
);

CREATE TABLE IF NOT EXISTS wazuh_vuln (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES wazuh_agent(agent_id) ON DELETE CASCADE,
  cve TEXT NOT NULL,
  severity TEXT,                         -- Low|Medium|High|Critical|Untriaged
  cvss2_score REAL,
  cvss3_score REAL,
  package_name TEXT,
  package_version TEXT,
  package_architecture TEXT,
  status TEXT,                           -- VALID|PENDING|SOLVED|OBSOLETE
  detection_time TEXT,
  published TEXT,
  updated TEXT,
  condition_ TEXT,
  title TEXT,
  external_references TEXT,
  scan_time TEXT,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(agent_id, cve, package_name, package_version)
);

-- Porte in ascolto (syscollector/{id}/ports filtrato state=listening).
-- Una riga per (agent_id, protocol, local_ip, local_port). Replace su ogni sync.
CREATE TABLE IF NOT EXISTS wazuh_ports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES wazuh_agent(agent_id) ON DELETE CASCADE,
  protocol TEXT,                         -- tcp|udp|tcp6|udp6
  local_ip TEXT,
  local_port INTEGER,
  state TEXT,                            -- listening|established (memorizziamo solo listening)
  process TEXT,
  pid INTEGER,
  scan_time TEXT,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(agent_id, protocol, local_ip, local_port)
);

-- Hotfix Windows (syscollector/{id}/hotfixes). Vuoto/404 per agent Linux.
CREATE TABLE IF NOT EXISTS wazuh_hotfix (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES wazuh_agent(agent_id) ON DELETE CASCADE,
  hotfix TEXT NOT NULL,                  -- es. "KB5012170"
  scan_time TEXT,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(agent_id, hotfix)
);

-- Interfacce di rete (syscollector/{id}/netiface). Una riga per (agent_id, name).
CREATE TABLE IF NOT EXISTS wazuh_netiface (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES wazuh_agent(agent_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mac TEXT,
  type TEXT,                             -- ethernet|loopback|wireless|...
  state TEXT,                            -- up|down|unknown
  mtu INTEGER,
  scan_time TEXT,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(agent_id, name)
);

-- Indirizzi IP (syscollector/{id}/netaddr). Multipli per interfaccia (IPv4 + IPv6).
CREATE TABLE IF NOT EXISTS wazuh_netaddr (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES wazuh_agent(agent_id) ON DELETE CASCADE,
  iface TEXT,
  proto TEXT,                            -- ipv4|ipv6
  address TEXT NOT NULL,
  netmask TEXT,
  broadcast TEXT,
  scan_time TEXT,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(agent_id, iface, address)
);

-- Processi in esecuzione (syscollector/{id}/processes). Snapshot ultima scansione:
-- DELETE+INSERT per agent_id ad ogni sync (PID si ricicla, niente storico utile).
-- Volume tipico Windows: ~150-250 righe per agent.
CREATE TABLE IF NOT EXISTS wazuh_process (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES wazuh_agent(agent_id) ON DELETE CASCADE,
  pid INTEGER NOT NULL,
  ppid INTEGER,
  name TEXT,
  cmd TEXT,                              -- comando completo con path
  argvs TEXT,                            -- argomenti
  vm_size INTEGER,                       -- virtual memory KB
  resident_size INTEGER,                 -- resident size (campo 'size')
  priority INTEGER,
  nlwp INTEGER,                          -- num threads
  start_time INTEGER,                    -- unix epoch
  utime INTEGER,
  stime INTEGER,
  scan_time TEXT,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(agent_id, pid)
);

-- Servizi (syscollector/{id}/services). Wazuh ≥ 4.13. Snapshot.
-- Su Windows ~150-300 servizi, su Linux ~30-80 unit systemd.
CREATE TABLE IF NOT EXISTS wazuh_service (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES wazuh_agent(agent_id) ON DELETE CASCADE,
  service_id TEXT NOT NULL,              -- nome servizio (es. "Dnscache", "ssh.service")
  enabled TEXT,                          -- "true"/"false"/" " (Wazuh raw)
  start_type TEXT,                       -- auto|manual|disabled|boot|system
  service_type TEXT,                     -- own|share|kernel_driver|...
  exit_code INTEGER,
  process_pid INTEGER,
  process_executable TEXT,
  process_args TEXT,
  scan_time TEXT,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(agent_id, service_id)
);

-- Routing/protocol config (syscollector/{id}/netproto). Tipicamente 2-3 righe per agent.
CREATE TABLE IF NOT EXISTS wazuh_netproto (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES wazuh_agent(agent_id) ON DELETE CASCADE,
  iface TEXT,
  type TEXT,                             -- ipv4|ipv6
  gateway TEXT,
  dhcp TEXT,                             -- enabled|disabled|unknown
  metric TEXT,
  scan_time TEXT,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(agent_id, iface, type)
);

-- ───────────────────────────────────────────────────────────────────────────
-- Integrazione Scanner-Edge (DA-Vul-can) — singleton applicativo per tenant.
-- DA-IPAM consuma /api/v1/cve dello scanner-edge sulla stessa LAN cliente,
-- archivia findings storici per match con hosts via IP. Token cifrato AES-GCM.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vuln_scanners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  token_encrypted TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  last_sync_at TEXT,
  last_error TEXT,
  -- SPKI pin (TOFU) formato RFC 7469 "sha256/<base64>". Quando settato
  -- ogni chiamata HTTPS verifica che il cert presentato abbia lo stesso
  -- pin. NULL = primo contatto non ancora avvenuto OR edge in HTTP legacy.
  cert_pin TEXT,
  -- Fingerprint sha256 del cert intero (DER). Solo UI diagnostica.
  cert_fingerprint TEXT,
  -- v0.2.638 audit B7: contatore errori consecutivi + timestamp auto-disable.
  -- Dopo 5 errori consecutivi il cron auto-disabilita lo scanner (enabled=0)
  -- per evitare retry muti per ore (es. TOFU pin mismatch).
  consecutive_errors INTEGER DEFAULT 0,
  auto_disabled_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vuln_scan_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scanner_id INTEGER NOT NULL REFERENCES vuln_scanners(id) ON DELETE CASCADE,
  edge_scan_id INTEGER,
  network_id INTEGER REFERENCES networks(id) ON DELETE SET NULL,
  started_at TEXT,
  finished_at TEXT,
  finding_count INTEGER DEFAULT 0,
  status TEXT,
  pulled_at TEXT DEFAULT (datetime('now')),
  UNIQUE(scanner_id, edge_scan_id)
);

CREATE TABLE IF NOT EXISTS vuln_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
  scan_run_id INTEGER NOT NULL REFERENCES vuln_scan_runs(id) ON DELETE CASCADE,
  ip TEXT NOT NULL,
  mac TEXT,
  hostname TEXT,
  port TEXT,
  service TEXT,
  cve_id TEXT,
  cvss_score REAL,
  cvss_vector TEXT,
  severity TEXT,
  nvt_oid TEXT,
  nvt_name TEXT,
  description TEXT,
  scanned_at TEXT NOT NULL
);

-- ───────────────────────────────────────────────────────────────────────────
-- Tenant settings (key/value) — config per-tenant (retention, soglie, ecc.)
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ───────────────────────────────────────────────────────────────────────────
-- Software Inventory — scan applicativo on-demand per host (Windows/Linux).
-- Snapshot immutabili: ogni scan = righe nuove. Diff ricostruito a query time.
-- Vedi docs/plans/software-inventory.md.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS software_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
  device_id INTEGER REFERENCES network_devices(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('running','ok','error','timeout','cancelled')),
  os_family TEXT NOT NULL CHECK(os_family IN ('windows','linux')),
  probe TEXT NOT NULL,
  apps_count INTEGER DEFAULT 0,
  timeout_ms INTEGER NOT NULL DEFAULT 60000,
  attempt INTEGER NOT NULL DEFAULT 1,
  triggered_by_user_id INTEGER,
  triggered_by TEXT NOT NULL DEFAULT 'manual',
  error_message TEXT,
  credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
  CHECK ((host_id IS NOT NULL AND device_id IS NULL) OR (host_id IS NULL AND device_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS software_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER NOT NULL REFERENCES software_scans(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  version TEXT,
  publisher TEXT,
  install_date TEXT,
  install_location TEXT,
  source TEXT NOT NULL,
  architecture TEXT,
  size_bytes INTEGER
);

CREATE TABLE IF NOT EXISTS software_scan_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER NOT NULL REFERENCES software_scans(id) ON DELETE CASCADE,
  ts TEXT NOT NULL,
  level TEXT NOT NULL CHECK(level IN ('info','warn','error','debug')),
  step TEXT,
  message TEXT NOT NULL,
  details TEXT
);

-- v0.2.632: Classification custom per-tenant. Sotto-categorie utente di un built-in.
-- Eredita icona e macro-categoria dal parent_slug (che DEVE essere un built-in,
-- validato lato API — qui CHECK solo formato base). Lo slug è PK e immutabile
-- una volta creato perché referenziato da hosts.classification.
CREATE TABLE IF NOT EXISTS device_classifications_custom (
  slug TEXT PRIMARY KEY NOT NULL,
  label TEXT NOT NULL,
  parent_slug TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (length(slug) >= 2 AND length(slug) <= 64),
  CHECK (slug GLOB '[a-z]*'),
  CHECK (length(label) >= 1 AND length(label) <= 80)
);
`;

export const TENANT_INDEXES_SQL = `
-- Hosts
CREATE INDEX IF NOT EXISTS idx_hosts_network ON hosts(network_id);
CREATE INDEX IF NOT EXISTS idx_hosts_status ON hosts(status);
CREATE INDEX IF NOT EXISTS idx_hosts_ip ON hosts(ip);
CREATE INDEX IF NOT EXISTS idx_hosts_mac ON hosts(mac);
CREATE INDEX IF NOT EXISTS idx_hosts_network_ip ON hosts(network_id, ip);
CREATE INDEX IF NOT EXISTS idx_hosts_hostname ON hosts(hostname);
CREATE INDEX IF NOT EXISTS idx_hosts_custom_name ON hosts(custom_name);
CREATE INDEX IF NOT EXISTS idx_hosts_vendor ON hosts(vendor);
CREATE INDEX IF NOT EXISTS idx_hosts_network_status ON hosts(network_id, status);
CREATE INDEX IF NOT EXISTS idx_hosts_os_family ON hosts(os_family);
CREATE INDEX IF NOT EXISTS idx_hosts_known_status ON hosts(known_host, status);
CREATE INDEX IF NOT EXISTS idx_hosts_network_mac ON hosts(network_id, mac);

-- Scan History
CREATE INDEX IF NOT EXISTS idx_scan_history_host ON scan_history(host_id);
CREATE INDEX IF NOT EXISTS idx_scan_history_network ON scan_history(network_id);

-- Status History
CREATE INDEX IF NOT EXISTS idx_status_history_host ON status_history(host_id);
CREATE INDEX IF NOT EXISTS idx_status_history_checked ON status_history(checked_at);
CREATE INDEX IF NOT EXISTS idx_status_history_checked_host ON status_history(checked_at DESC, host_id);

-- ARP
CREATE INDEX IF NOT EXISTS idx_arp_entries_device ON arp_entries(device_id);
CREATE INDEX IF NOT EXISTS idx_arp_entries_mac ON arp_entries(mac);
CREATE INDEX IF NOT EXISTS idx_arp_entries_mac_timestamp ON arp_entries(mac, timestamp DESC);

-- MAC Port
CREATE INDEX IF NOT EXISTS idx_mac_port_entries_device ON mac_port_entries(device_id);
CREATE INDEX IF NOT EXISTS idx_mac_port_entries_mac ON mac_port_entries(mac);
CREATE INDEX IF NOT EXISTS idx_mac_port_entries_device_mac ON mac_port_entries(device_id, mac);
-- v0.2.645 audit perf DB2: index composito per "ultimo entry per mac".
-- Sostituisce il pattern ROW_NUMBER() OVER (PARTITION BY mac) full-scan in
-- getAllHostsEnriched con JOIN su (mac, MAX(timestamp)) seek-only.
CREATE INDEX IF NOT EXISTS idx_mac_port_entries_mac_ts ON mac_port_entries(mac, timestamp DESC);

-- Network Router
CREATE INDEX IF NOT EXISTS idx_network_router_network ON network_router(network_id);
CREATE INDEX IF NOT EXISTS idx_network_router_router ON network_router(router_id);

-- Switch Ports
CREATE INDEX IF NOT EXISTS idx_switch_ports_device ON switch_ports(device_id);

-- Network Devices
CREATE INDEX IF NOT EXISTS idx_network_devices_credential ON network_devices(credential_id);
CREATE INDEX IF NOT EXISTS idx_network_devices_host ON network_devices(host);
CREATE INDEX IF NOT EXISTS idx_network_devices_device_type ON network_devices(device_type);
CREATE INDEX IF NOT EXISTS idx_network_devices_product_profile ON network_devices(product_profile);

-- MAC IP Mapping
CREATE INDEX IF NOT EXISTS idx_mac_ip_mapping_mac ON mac_ip_mapping(mac_normalized);
CREATE INDEX IF NOT EXISTS idx_mac_ip_mapping_ip ON mac_ip_mapping(ip);
CREATE INDEX IF NOT EXISTS idx_mac_ip_history_mac ON mac_ip_history(mac_normalized);

-- Scheduled Jobs
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_enabled_next ON scheduled_jobs(enabled, next_run);

-- Network Host Credentials (legacy)
CREATE INDEX IF NOT EXISTS idx_network_host_credentials_net_role ON network_host_credentials(network_id, role);

-- Network Credentials v2
CREATE INDEX IF NOT EXISTS idx_network_credentials_net ON network_credentials(network_id, sort_order);

-- Host Credentials v2
CREATE INDEX IF NOT EXISTS idx_host_credentials_host ON host_credentials(host_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_host_credentials_validated ON host_credentials(host_id, validated);

-- Multihomed Links
CREATE INDEX IF NOT EXISTS idx_multihomed_links_group ON multihomed_links(group_id);
CREATE INDEX IF NOT EXISTS idx_multihomed_links_host ON multihomed_links(host_id);

-- Device Credential Bindings
CREATE INDEX IF NOT EXISTS idx_dcb_device ON device_credential_bindings(device_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_dcb_credential ON device_credential_bindings(credential_id);

-- Inventory
CREATE INDEX IF NOT EXISTS idx_inventory_assets_network_device ON inventory_assets(network_device_id);
CREATE INDEX IF NOT EXISTS idx_inventory_assets_host ON inventory_assets(host_id);
CREATE INDEX IF NOT EXISTS idx_inventory_assets_asset_tag ON inventory_assets(asset_tag);
CREATE INDEX IF NOT EXISTS idx_inventory_assets_serial ON inventory_assets(serial_number);
CREATE INDEX IF NOT EXISTS idx_inventory_assets_stato ON inventory_assets(stato);
CREATE INDEX IF NOT EXISTS idx_inventory_assets_fine_garanzia ON inventory_assets(fine_garanzia);
CREATE INDEX IF NOT EXISTS idx_inventory_assets_asset_assignee ON inventory_assets(asset_assignee_id);
CREATE INDEX IF NOT EXISTS idx_inventory_assets_location ON inventory_assets(location_id);

-- Asset Assignees / Locations
CREATE INDEX IF NOT EXISTS idx_locations_parent ON locations(parent_id);

-- License Seats
CREATE INDEX IF NOT EXISTS idx_license_seats_license ON license_seats(license_id);
CREATE INDEX IF NOT EXISTS idx_license_seats_asset ON license_seats(asset_type, asset_id);
CREATE INDEX IF NOT EXISTS idx_license_seats_assignee ON license_seats(asset_assignee_id);

-- Audit Log
CREATE INDEX IF NOT EXISTS idx_inventory_audit_log_asset ON inventory_audit_log(asset_id);
CREATE INDEX IF NOT EXISTS idx_inventory_audit_log_created ON inventory_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_audit_log_asset_created ON inventory_audit_log(asset_id, created_at DESC);

-- Proxmox
CREATE INDEX IF NOT EXISTS idx_proxmox_hosts_credential ON proxmox_hosts(credential_id);

-- AD
CREATE INDEX IF NOT EXISTS idx_ad_computers_integration ON ad_computers(integration_id);
CREATE INDEX IF NOT EXISTS idx_ad_computers_host ON ad_computers(host_id);
CREATE INDEX IF NOT EXISTS idx_ad_computers_dns ON ad_computers(dns_host_name);
CREATE INDEX IF NOT EXISTS idx_ad_users_integration ON ad_users(integration_id);
CREATE INDEX IF NOT EXISTS idx_ad_users_upn ON ad_users(user_principal_name);
CREATE INDEX IF NOT EXISTS idx_ad_users_email ON ad_users(email);
CREATE INDEX IF NOT EXISTS idx_ad_groups_integration ON ad_groups(integration_id);
CREATE INDEX IF NOT EXISTS idx_ad_dhcp_leases_integration ON ad_dhcp_leases(integration_id);
CREATE INDEX IF NOT EXISTS idx_ad_dhcp_leases_mac ON ad_dhcp_leases(mac_address);

-- DHCP Leases
CREATE INDEX IF NOT EXISTS idx_dhcp_leases_source ON dhcp_leases(source_type, source_device_id);
CREATE INDEX IF NOT EXISTS idx_dhcp_leases_mac ON dhcp_leases(mac_address);
CREATE INDEX IF NOT EXISTS idx_dhcp_leases_ip ON dhcp_leases(ip_address);
CREATE INDEX IF NOT EXISTS idx_dhcp_leases_host ON dhcp_leases(host_id);
CREATE INDEX IF NOT EXISTS idx_dhcp_leases_network ON dhcp_leases(network_id);

-- Anomaly Events
CREATE INDEX IF NOT EXISTS idx_anomaly_events_host     ON anomaly_events(host_id);
CREATE INDEX IF NOT EXISTS idx_anomaly_events_network  ON anomaly_events(network_id);
CREATE INDEX IF NOT EXISTS idx_anomaly_events_type     ON anomaly_events(anomaly_type);
CREATE INDEX IF NOT EXISTS idx_anomaly_events_detected ON anomaly_events(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_anomaly_events_ack      ON anomaly_events(acknowledged, detected_at DESC);

-- Classification Feedback
CREATE INDEX IF NOT EXISTS idx_classification_feedback_host    ON classification_feedback(host_id);
CREATE INDEX IF NOT EXISTS idx_classification_feedback_class   ON classification_feedback(corrected_classification);
CREATE INDEX IF NOT EXISTS idx_classification_feedback_created ON classification_feedback(created_at DESC);

-- Neighbors / Routes
CREATE INDEX IF NOT EXISTS idx_device_neighbors_device ON device_neighbors(device_id);
CREATE INDEX IF NOT EXISTS idx_device_neighbors_remote ON device_neighbors(remote_device_name);
CREATE INDEX IF NOT EXISTS idx_routing_table_device ON routing_table(device_id);
CREATE INDEX IF NOT EXISTS idx_routing_table_dest ON routing_table(destination);

-- LibreNMS host map
CREATE INDEX IF NOT EXISTS idx_librenms_host_map_network ON librenms_host_map(network_id);
CREATE INDEX IF NOT EXISTS idx_librenms_host_map_ip ON librenms_host_map(host_ip);

-- Wazuh
CREATE INDEX IF NOT EXISTS idx_wazuh_agent_host ON wazuh_agent(host_id);
CREATE INDEX IF NOT EXISTS idx_wazuh_agent_ip ON wazuh_agent(ip);
CREATE INDEX IF NOT EXISTS idx_wazuh_agent_mac ON wazuh_agent(mac);
CREATE INDEX IF NOT EXISTS idx_wazuh_agent_hostname ON wazuh_agent(hostname);
CREATE INDEX IF NOT EXISTS idx_wazuh_software_agent ON wazuh_software(agent_id);
CREATE INDEX IF NOT EXISTS idx_wazuh_software_name ON wazuh_software(name);
CREATE INDEX IF NOT EXISTS idx_wazuh_vuln_agent ON wazuh_vuln(agent_id);
CREATE INDEX IF NOT EXISTS idx_wazuh_vuln_cve ON wazuh_vuln(cve);
CREATE INDEX IF NOT EXISTS idx_wazuh_vuln_severity ON wazuh_vuln(severity);
CREATE INDEX IF NOT EXISTS idx_wazuh_ports_agent ON wazuh_ports(agent_id);
CREATE INDEX IF NOT EXISTS idx_wazuh_hotfix_agent ON wazuh_hotfix(agent_id);
CREATE INDEX IF NOT EXISTS idx_wazuh_netiface_agent ON wazuh_netiface(agent_id);
CREATE INDEX IF NOT EXISTS idx_wazuh_netaddr_agent ON wazuh_netaddr(agent_id);
CREATE INDEX IF NOT EXISTS idx_wazuh_netaddr_address ON wazuh_netaddr(address);
CREATE INDEX IF NOT EXISTS idx_wazuh_process_agent ON wazuh_process(agent_id);
CREATE INDEX IF NOT EXISTS idx_wazuh_process_name ON wazuh_process(name);
CREATE INDEX IF NOT EXISTS idx_wazuh_service_agent ON wazuh_service(agent_id);
CREATE INDEX IF NOT EXISTS idx_wazuh_service_enabled ON wazuh_service(agent_id, enabled);
CREATE INDEX IF NOT EXISTS idx_wazuh_netproto_agent ON wazuh_netproto(agent_id);

-- Vulnerability findings (scanner-edge integration)
CREATE INDEX IF NOT EXISTS idx_vuln_findings_host ON vuln_findings(host_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_vuln_findings_ip ON vuln_findings(ip, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_vuln_findings_severity ON vuln_findings(severity);
CREATE INDEX IF NOT EXISTS idx_vuln_findings_cve ON vuln_findings(cve_id);
CREATE INDEX IF NOT EXISTS idx_vuln_scan_runs_scanner ON vuln_scan_runs(scanner_id, finished_at DESC);

-- Software Inventory
CREATE INDEX IF NOT EXISTS idx_software_scans_host ON software_scans(host_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_software_scans_device ON software_scans(device_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_software_scans_status ON software_scans(status);
CREATE INDEX IF NOT EXISTS idx_software_inventory_scan ON software_inventory(scan_id);
CREATE INDEX IF NOT EXISTS idx_software_inventory_name_version ON software_inventory(name, version);
CREATE INDEX IF NOT EXISTS idx_software_scan_logs_scan ON software_scan_logs(scan_id, ts);

-- Aggregazioni globali (pagine /vulnerabilities e /software)
CREATE INDEX IF NOT EXISTS idx_vuln_findings_cve_severity ON vuln_findings(cve_id, severity);
CREATE INDEX IF NOT EXISTS idx_vuln_findings_nvt_severity ON vuln_findings(nvt_oid, severity) WHERE cve_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_vuln_findings_severity_cvss ON vuln_findings(severity, cvss_score DESC);
CREATE INDEX IF NOT EXISTS idx_wazuh_vuln_cve_severity ON wazuh_vuln(cve, severity);
CREATE INDEX IF NOT EXISTS idx_wazuh_vuln_status_severity ON wazuh_vuln(status, severity);
CREATE INDEX IF NOT EXISTS idx_wazuh_software_name_version ON wazuh_software(name, version);

-- Tombstone IP esclusi (vedi db-schema.ts per i dettagli).
CREATE TABLE IF NOT EXISTS excluded_ips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network_id INTEGER NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  ip TEXT NOT NULL,
  excluded_at TEXT NOT NULL DEFAULT (datetime('now')),
  reason TEXT,
  excluded_by TEXT,
  UNIQUE(network_id, ip)
);
CREATE INDEX IF NOT EXISTS idx_excluded_ips_network_ip ON excluded_ips(network_id, ip);

-- v0.2.632: Classification custom — unique label case-insensitive per evitare
-- collisioni cognitive (Server PG / server pg) nelle UI.
CREATE UNIQUE INDEX IF NOT EXISTS idx_dcc_label_ci ON device_classifications_custom(lower(label));
CREATE INDEX IF NOT EXISTS idx_dcc_parent ON device_classifications_custom(parent_slug);

-- v0.2.634 audit B4: indici mancanti su filtri/aggregazioni frequenti.
-- - hosts(classification): filtro chip discovery + countHostsByClassification (DELETE custom)
-- - hosts(physical_device_id): cluster multihomed UI (objects/[id] tab cluster)
-- - network_devices(classification): join refresh + apply-classifications
-- - network_devices(physical_device_id): merge fisico devices/cluster lookup
CREATE INDEX IF NOT EXISTS idx_hosts_classification ON hosts(classification);
CREATE INDEX IF NOT EXISTS idx_hosts_physical_device_id ON hosts(physical_device_id);
CREATE INDEX IF NOT EXISTS idx_network_devices_classification ON network_devices(classification);
CREATE INDEX IF NOT EXISTS idx_network_devices_physical_device_id ON network_devices(physical_device_id);

-- v0.2.641 audit perf (DB3/DB9/DB12):
-- - scan_history(timestamp DESC): "recent activity" dashboard + scan card per-host
--   prima full-scan (80-150ms), ora index seek (~5ms).
-- - wazuh_vuln(agent_id, severity): counter dashboard "Critical/High per agent"
--   prima scan-filter dopo idx_agent (15ms × 2 sev × N agent), ora index composito.
-- - ad_computers(host_id, dns_host_name): covering index per JOIN
--   MAX(dns_host_name) ... GROUP BY host_id in getHostsByNetworkWithDevices /
--   getAllHostsEnriched (30ms -> 5ms per pagina rete).
CREATE INDEX IF NOT EXISTS idx_scan_history_timestamp ON scan_history(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_wazuh_vuln_agent_severity ON wazuh_vuln(agent_id, severity);
CREATE INDEX IF NOT EXISTS idx_ad_computers_host_dns ON ad_computers(host_id, dns_host_name);
`;
