// ========================
// Database Row Types
// ========================

export interface User {
  id: number;
  username: string;
  password_hash: string;
  role: "superadmin" | "admin" | "viewer";
  created_at: string;
  last_login: string | null;
}

export interface Network {
  id: number;
  cidr: string;
  name: string;
  description: string;
  gateway: string | null;
  vlan_id: number | null;
  location: string;
  snmp_community: string | null;
  dns_server: string | null;
  created_at: string;
  updated_at: string;
}

export interface Host {
  id: number;
  network_id: number;
  ip: string;
  mac: string | null;
  vendor: string | null;
  hostname: string | null;
  dns_forward: string | null;
  dns_reverse: string | null;
  custom_name: string | null;
  classification: string;
  inventory_code: string | null;
  notes: string;
  status: "online" | "offline" | "unknown";
  open_ports: string | null;  // JSON: [{port, protocol, service, version}]
  os_info: string | null;
  model: string | null;
  serial_number: string | null;
  /** Firmware da SNMP / sysDescr (se disponibile) */
  firmware: string | null;
  /** Produttore dedotto da SNMP (sysDescr / OID enterprise) */
  device_manufacturer: string | null;
  /** JSON: risultato device fingerprinting (TTL, firme porte, banner, SNMP) */
  detection_json: string | null;
  /** JSON: dati SNMP completi raccolti durante scan (sysDescr, sysObjectID, model, serial, firmware, manufacturer, ecc.) */
  snmp_data: string | null;
  known_host: number;  // 0 or 1 — host verificato/conosciuto
  /** Origine DHCP/statico: derivato da lease o impostato manualmente */
  ip_assignment: "unknown" | "dynamic" | "static" | "reserved";
  /** Presente quando la lista host è arricchita (rete): nome DNS da computer AD collegato */
  ad_dns_host_name?: string | null;
  last_response_time_ms: number | null;
  monitor_ports: string | null;  // JSON array of port numbers, or null
  hostname_source: string | null;  // manual | dhcp | snmp | nmap | dns | arp
  conflict_flags: string | null;
  last_seen: string | null;
  first_seen: string | null;
  created_at: string;
  updated_at: string;
}

/** Host conosciuto con nome rete (JOIN per UI monitoraggio). */
export type KnownHostWithNetworkRow = Host & { network_name: string; network_cidr: string };

/** Struttura JSON di hosts.snmp_data — tutto ciò che SNMP ha restituito durante la scansione. */
export interface HostSnmpData {
  sysName: string | null;
  sysDescr: string | null;
  sysObjectID: string | null;
  serialNumber: string | null;
  model: string | null;
  partNumber: string | null;
  firmware: string | null;
  manufacturer: string | null;
  community: string;
  port: number;
  mikrotikIdentity?: string | null;
  unifiSummary?: string | null;
  ifDescrSummary?: string | null;
  hostResourcesSummary?: string | null;
  sysUpTime?: string | null;
  arpEntryCount?: number | null;
  collected_at: string;
}

/** Match port-signature (matrice pesi 0.75/0.25). */
export interface DeviceFingerprintPortMatch {
  name: string;
  confidence: number;
  matched_ports: number[];
}

/** Snapshot fingerprint per host (persistito in hosts.detection_json). */
export interface DeviceFingerprintSnapshot {
  ip: string;
  hostname?: string | null;
  mac?: string | null;
  ttl?: number | null;
  os_hint?: string | null;
  /** OS rilevato da nmap (-O / service), utile per VM vs hypervisor */
  nmap_os?: string | null;
  open_ports: number[];
  matches: DeviceFingerprintPortMatch[];
  banner_http?: string | null;
  banner_ssh?: string | null;
  snmp_sysdescr?: string | null;
  snmp_vendor_oid?: string | null;
  final_device?: string | null;
  final_confidence?: number;
  /** Ruolo stimato: switch vs AP, NAS vs iLO, hypervisor vs guest, ecc. */
  role_hint?: string | null;
  /** Ipotesi OS per VM / host generico (SMB, nmap OS) */
  guest_os_hint?: string | null;
  /** Dettaglio vendor (es. summary UniFi da walk SNMP) */
  vendor_detail?: string | null;
  detection_sources: string[];
  generated_at: string;
}

export interface ScanHistory {
  id: number;
  host_id: number | null;
  network_id: number | null;
  scan_type: "ping" | "snmp" | "nmap" | "arp" | "dns" | "windows" | "ssh" | "network_discovery" | "ipam_full" | "credential_validate";
  status: string;
  ports_open: string | null;
  raw_output: string | null;
  duration_ms: number | null;
  timestamp: string;
}

export interface Credential {
  id: number;
  name: string;
  credential_type: "ssh" | "snmp" | "api" | "windows" | "linux";
  encrypted_username: string | null;
  encrypted_password: string | null;
  created_at: string;
  updated_at: string;
}

export interface NetworkDevice {
  id: number;
  name: string;
  host: string;
  device_type: "router" | "switch" | "hypervisor";
  classification: string | null;
  vendor: "mikrotik" | "ubiquiti" | "hp" | "cisco" | "omada" | "stormshield" | "proxmox" | "vmware" | "linux" | "windows" | "synology" | "qnap" | "other";
  vendor_subtype: "procurve" | "comware" | null;
  protocol: "ssh" | "snmp_v2" | "snmp_v3" | "api" | "winrm";
  credential_id: number | null;
  snmp_credential_id: number | null;
  username: string | null;
  encrypted_password: string | null;
  community_string: string | null;
  api_token: string | null;
  api_url: string | null;
  port: number;
  enabled: number;
  sysname: string | null;
  sysdescr: string | null;
  model: string | null;
  firmware: string | null;
  serial_number: string | null;
  part_number: string | null;
  last_info_update: string | null;
  last_device_info_json: string | null;
  stp_info: string | null;
  last_proxmox_scan_at: string | null;
  last_proxmox_scan_result: string | null;
  scan_target: "proxmox" | "vmware" | "windows" | "linux" | null;
  /** Profilo prodotto (marca + tipologia), assegnazione manuale per scan e inventario dedicati */
  product_profile: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArpEntry {
  id: number;
  device_id: number;
  host_id: number | null;
  mac: string;
  ip: string | null;
  interface_name: string | null;
  timestamp: string;
}

export interface MacPortEntry {
  id: number;
  device_id: number;
  mac: string;
  port_name: string;
  vlan: number | null;
  port_status: "up" | "down" | null;
  speed: string | null;
  timestamp: string;
}

export interface MacIpMapping {
  id: number;
  mac_normalized: string;
  mac_display: string;
  ip: string;
  source: "arp" | "dhcp" | "host" | "switch";
  source_device_id: number | null;
  network_id: number | null;
  host_id: number | null;
  vendor: string | null;
  hostname: string | null;
  first_seen: string;
  last_seen: string;
  previous_ip: string | null;
  network_name?: string | null;
  source_device_name?: string | null;
}

export type InventoryAssetCategoria =
  | "Desktop" | "Laptop" | "Server" | "Switch" | "Firewall" | "NAS" | "Stampante"
  | "VM" | "Licenza" | "Access Point" | "Router" | "Other";
export type InventoryAssetStato =
  | "Attivo" | "In magazzino" | "In riparazione" | "Dismesso" | "Rubato";
export type InventoryAssetStorageTipo = "SSD" | "HDD" | "NVMe";
export type InventoryAssetClassificazioneDati = "Pubblico" | "Interno" | "Confidenziale" | "Riservato";

export interface InventoryAsset {
  id: number;
  asset_id: string | null;
  asset_tag: string | null;
  serial_number: string | null;
  network_device_id: number | null;
  host_id: number | null;
  hostname: string | null;
  nome_prodotto: string | null;
  categoria: InventoryAssetCategoria | null;
  marca: string | null;
  modello: string | null;
  part_number: string | null;
  sede: string | null;
  reparto: string | null;
  utente_assegnatario_id: number | null;
  asset_assignee_id: number | null;
  location_id: number | null;
  posizione_fisica: string | null;
  data_assegnazione: string | null;
  data_acquisto: string | null;
  data_installazione: string | null;
  data_dismissione: string | null;
  stato: InventoryAssetStato | null;
  fine_garanzia: string | null;
  fine_supporto: string | null;
  vita_utile_prevista: number | null;
  sistema_operativo: string | null;
  versione_os: string | null;
  cpu: string | null;
  ram_gb: number | null;
  storage_gb: number | null;
  storage_tipo: InventoryAssetStorageTipo | null;
  mac_address: string | null;
  ip_address: string | null;
  vlan: number | null;
  firmware_version: string | null;
  prezzo_acquisto: number | null;
  fornitore: string | null;
  numero_ordine: string | null;
  numero_fattura: string | null;
  valore_attuale: number | null;
  metodo_ammortamento: "Lineare" | "Quote decrescenti" | null;
  centro_di_costo: string | null;
  crittografia_disco: number;
  antivirus: string | null;
  gestito_da_mdr: number;
  classificazione_dati: InventoryAssetClassificazioneDati | null;
  in_scope_gdpr: number;
  in_scope_nis2: number;
  ultimo_audit: string | null;
  contratto_supporto: string | null;
  tipo_garanzia: string | null;
  contatto_supporto: string | null;
  ultimo_intervento: string | null;
  prossima_manutenzione: string | null;
  note_tecniche: string | null;
  technical_data: string | null;
  created_at: string;
  updated_at: string;
}

export interface InventoryAssetInput {
  asset_tag?: string | null;
  serial_number?: string | null;
  network_device_id?: number | null;
  host_id?: number | null;
  hostname?: string | null;
  nome_prodotto?: string | null;
  categoria?: InventoryAssetCategoria | null;
  marca?: string | null;
  modello?: string | null;
  part_number?: string | null;
  sede?: string | null;
  reparto?: string | null;
  utente_assegnatario_id?: number | null;
  asset_assignee_id?: number | null;
  location_id?: number | null;
  posizione_fisica?: string | null;
  data_assegnazione?: string | null;
  data_acquisto?: string | null;
  data_installazione?: string | null;
  data_dismissione?: string | null;
  stato?: InventoryAssetStato | null;
  fine_garanzia?: string | null;
  fine_supporto?: string | null;
  vita_utile_prevista?: number | null;
  sistema_operativo?: string | null;
  versione_os?: string | null;
  cpu?: string | null;
  ram_gb?: number | null;
  storage_gb?: number | null;
  storage_tipo?: InventoryAssetStorageTipo | null;
  mac_address?: string | null;
  ip_address?: string | null;
  vlan?: number | null;
  firmware_version?: string | null;
  prezzo_acquisto?: number | null;
  fornitore?: string | null;
  numero_ordine?: string | null;
  numero_fattura?: string | null;
  valore_attuale?: number | null;
  metodo_ammortamento?: "Lineare" | "Quote decrescenti" | null;
  centro_di_costo?: string | null;
  crittografia_disco?: number;
  antivirus?: string | null;
  gestito_da_mdr?: number;
  classificazione_dati?: InventoryAssetClassificazioneDati | null;
  in_scope_gdpr?: number;
  in_scope_nis2?: number;
  ultimo_audit?: string | null;
  contratto_supporto?: string | null;
  tipo_garanzia?: string | null;
  contatto_supporto?: string | null;
  ultimo_intervento?: string | null;
  prossima_manutenzione?: string | null;
  note_tecniche?: string | null;
  technical_data?: string | null;
}

export interface AssetAssignee {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  note: string | null;
  user_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface Location {
  id: number;
  name: string;
  parent_id: number | null;
  address: string | null;
  created_at: string;
  updated_at: string;
}

export interface License {
  id: number;
  name: string;
  serial: string | null;
  seats: number;
  category: string | null;
  expiration_date: string | null;
  purchase_cost: number | null;
  min_amt: number;
  fornitore: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface LicenseSeat {
  id: number;
  license_id: number;
  asset_type: "inventory_asset" | "host" | null;
  asset_id: number | null;
  asset_assignee_id: number | null;
  assigned_at: string;
  note: string | null;
}

export interface InventoryAuditLog {
  id: number;
  asset_id: number;
  user_id: number | null;
  action: "create" | "update" | "delete";
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

export interface SwitchPort {
  id: number;
  device_id: number;
  port_index: number;
  port_name: string;
  status: "up" | "down" | "disabled" | null;
  speed: string | null;
  duplex: string | null;
  vlan: number | null;
  poe_status: string | null;
  poe_power_mw: number | null;
  mac_count: number;
  is_trunk: number;
  single_mac: string | null;
  single_mac_vendor: string | null;
  single_mac_ip: string | null;
  single_mac_hostname: string | null;
  host_id: number | null;
  trunk_neighbor_name: string | null;
  trunk_neighbor_port: string | null;
  trunk_primary_device_id: number | null;
  trunk_primary_name: string | null;
  stp_state: string | null;
  timestamp: string;
}

export interface ScheduledJob {
  id: number;
  network_id: number | null;
  job_type: "ping_sweep" | "snmp_scan" | "nmap_scan" | "arp_poll" | "dns_resolve" | "cleanup" | "known_host_check" | "ad_sync" | "anomaly_check" | "librenms_sync";
  interval_minutes: number;
  last_run: string | null;
  next_run: string | null;
  enabled: number;
  config: string;
  created_at: string;
  updated_at: string;
}

export interface ProxmoxHost {
  id: number;
  name: string;
  host: string;
  port: number;
  credential_id: number | null;
  enabled: number;
  last_scan_at: string | null;
  last_scan_result: string | null;
  created_at: string;
  updated_at: string;
}

export interface StatusHistory {
  id: number;
  host_id: number;
  status: "online" | "offline";
  response_time_ms: number | null;
  checked_at: string;
}

// ========================
// Derived / View Types
// ========================

export interface NetworkWithStats extends Network {
  total_hosts: number;
  online_count: number;
  offline_count: number;
  unknown_count: number;
  last_scan: string | null;
}

export interface HostDetectCredentialRow {
  role: "windows" | "linux" | "ssh" | "snmp";
  credential_id: number;
  credential_name: string;
}

export interface HostDetail extends Host {
  network_cidr: string;
  network_name: string;
  recent_scans: ScanHistory[];
  /** Tipi di scansione già eseguiti su questo host (deduplicati). */
  scan_types_used?: string[];
  /** Credenziali archivio usate con successo per acquisizione (per ruolo). [Legacy] */
  detect_credentials?: HostDetectCredentialRow[];
  /** Credenziali validate per questo host (sistema v2 — multi-protocollo). */
  host_credentials?: Array<{
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
  }>;
  arp_source: {
    device_name: string;
    device_vendor: string;
    last_query: string;
  } | null;
  switch_port: {
    device_name: string;
    device_vendor: string;
    port_name: string;
    vlan: number | null;
  } | null;
  /** Dispositivo gestito (WINRM, SSH, SNMP) con stesso IP */
  network_device: {
    id: number;
    name: string;
    sysname: string | null;
    vendor: string;
    protocol: string;
  } | null;
}

export interface PortMappingView {
  ip: string;
  mac: string;
  vendor: string | null;
  hostname: string | null;
  router_name: string | null;
  switch_name: string | null;
  port_name: string | null;
  vlan: number | null;
}

// ========================
// Input Types (for API)
// ========================

export interface NetworkInput {
  cidr: string;
  name: string;
  description?: string;
  gateway?: string;
  vlan_id?: number | null;
  location?: string;
  snmp_community?: string | null;
  dns_server?: string | null;
}

export interface HostInput {
  network_id: number;
  ip: string;
  mac?: string;
  hostname?: string;
  custom_name?: string;
  classification?: string;
  inventory_code?: string;
  notes?: string;
}

export interface HostUpdate {
  custom_name?: string;
  classification?: string;
  inventory_code?: string;
  notes?: string;
  mac?: string;
  known_host?: 0 | 1;
  status?: "online" | "offline" | "unknown";
  monitor_ports?: string | null;
  device_manufacturer?: string | null;
  ip_assignment?: "dynamic" | "static" | "reserved" | "unknown";
}

export interface NetworkDeviceInput {
  name: string;
  host: string;
  device_type: "router" | "switch";
  vendor: "mikrotik" | "ubiquiti" | "hp" | "cisco" | "omada" | "stormshield" | "proxmox" | "vmware" | "linux" | "windows" | "synology" | "qnap" | "other";
  vendor_subtype?: "procurve" | "comware" | null;
  protocol: "ssh" | "snmp_v2" | "snmp_v3" | "api" | "winrm";
  credential_id?: number | null;
  snmp_credential_id?: number | null;
  username?: string;
  password?: string;
  community_string?: string;
  api_token?: string;
  api_url?: string;
  port?: number;
}

export interface CredentialInput {
  name: string;
  credential_type: "ssh" | "snmp" | "api" | "windows" | "linux";
  username?: string;
  password?: string;
}

export interface ScheduledJobInput {
  network_id?: number | null;
  job_type: "ping_sweep" | "snmp_scan" | "nmap_scan" | "arp_poll" | "dns_resolve" | "cleanup" | "known_host_check" | "ad_sync" | "anomaly_check" | "librenms_sync";
  interval_minutes: number;
  config?: Record<string, unknown>;
}

// ========================
// Scan Types
// ========================

export interface PingResult {
  ip: string;
  alive: boolean;
  latency_ms: number | null;
  /** TTL ICMP se ricavato dall'output di ping (fingerprint OS). */
  ttl?: number | null;
}

export interface NmapResult {
  ip: string;
  alive: boolean;
  ports: NmapPort[];
  os: string | null;
  mac: string | null;
  snmpHostname?: string | null;
  snmpSysDescr?: string | null;
  snmpSysObjectID?: string | null;
}

export interface NmapPort {
  port: number;
  protocol: string;
  state: string;
  service: string | null;
  version: string | null;
}

export interface ScanProgress {
  id: string;
  network_id: number;
  scan_type: string;
  status: "running" | "completed" | "failed";
  total: number;
  scanned: number;
  found: number;
  phase: string;
  started_at: string;
  error?: string;
  /** Log live delle operazioni in corso (ultime N righe) */
  logs?: string[];
}

export interface DiscoveryResult {
  network_id: number;
  total_ips: number;
  hosts_found: number;
  hosts_online: number;
  hosts_offline: number;
  new_hosts: number;
  duration_ms: number;
}

// ── Analytics: Anomaly Detection ─────────────────────────────────────────────

export type AnomalyType =
  | "mac_flip"
  | "new_unknown_host"
  | "port_change"
  | "uptime_anomaly"
  | "latency_anomaly";

export type AnomalySeverity = "low" | "medium" | "high";

export interface AnomalyEvent {
  id: number;
  host_id: number | null;
  network_id: number | null;
  anomaly_type: AnomalyType;
  severity: AnomalySeverity;
  description: string;
  detail_json: string | null;
  acknowledged: number; // 0 | 1 (SQLite boolean)
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  detected_at: string;
  resolved_at: string | null;
}

export interface MacFlipDetail {
  ip: string;
  old_mac: string;
  new_mac: string;
  old_vendor: string | null;
  new_vendor: string | null;
}

export interface PortChangeDetail {
  ip: string;
  ports_added: number[];
  ports_removed: number[];
  baseline_ports: number[];
  current_ports: number[];
}

export interface UptimeAnomalyDetail {
  ip: string;
  offline_rate_recent: number;
  offline_rate_baseline: number;
  check_window_hours: number;
}

export interface LatencyAnomalyDetail {
  ip: string;
  current_ms: number;
  baseline_mean_ms: number;
  baseline_stddev_ms: number;
  z_score: number;
}

// ── Analytics: Classificazione Migliorata ────────────────────────────────────

export type FeatureSource =
  | "ports"
  | "snmp_oid"
  | "snmp_sysdescr"
  | "banner_http"
  | "banner_ssh"
  | "hostname"
  | "mac_vendor"
  | "ttl"
  | "nmap_os";

export interface ClassificationFeature {
  source: FeatureSource;
  label: string;        // es. "Porta 8006 (Proxmox web)"
  value: string;        // es. "8006" oppure "Linux 3.x"
  contribution: number; // 0.0 – 1.0
}

export interface FingerprintExplanation {
  final_device: string | null;
  final_confidence: number;
  classification: string;
  features: ClassificationFeature[];
  unmatched_signals: { source: FeatureSource; value: string }[];
}

export interface ClassificationFeedback {
  id: number;
  host_id: number;
  corrected_classification: string;
  previous_classification: string | null;
  feature_snapshot_json: string | null;
  fingerprint_device_label: string | null;
  fingerprint_confidence: number | null;
  corrected_by: string | null;
  created_at: string;
}

// ═══════════════════════════════════════════════════════════
// LibreNMS integration
// ═══════════════════════════════════════════════════════════

export interface LibreNMSHostMap {
  id: number;
  network_id: number;
  host_ip: string;
  librenms_device_id: number;
  librenms_hostname: string | null;
  last_synced_at: string;
  last_status: string | null;
}

export interface LibreNMSDevice {
  device_id: number;
  hostname: string;
  ip?: string;
  sysName?: string;
  sysDescr?: string;
  os?: string;
  status: number; // 1=up, 0=down
  status_reason?: string;
  uptime?: number;
  last_polled?: string;
  hardware?: string;
  serial?: string;
  type?: string;
}

export interface LibreNMSSyncResult {
  networkId: number;
  added: number;
  updated: number;
  skipped: number;
  errors: string[];
}
