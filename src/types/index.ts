// ========================
// Database Row Types
// ========================

export interface User {
  id: number;
  username: string;
  password_hash: string;
  role: "admin" | "viewer";
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
  known_host: number;  // 0 or 1 — host verificato/conosciuto
  last_seen: string | null;
  first_seen: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScanHistory {
  id: number;
  host_id: number | null;
  network_id: number | null;
  scan_type: "ping" | "nmap" | "arp" | "dns";
  status: string;
  ports_open: string | null;
  raw_output: string | null;
  duration_ms: number | null;
  timestamp: string;
}

export interface NetworkDevice {
  id: number;
  name: string;
  host: string;
  device_type: "router" | "switch";
  vendor: "mikrotik" | "ubiquiti" | "hp" | "cisco" | "omada" | "other";
  protocol: "ssh" | "snmp_v2" | "snmp_v3" | "api";
  username: string | null;
  encrypted_password: string | null;
  community_string: string | null;
  api_token: string | null;
  api_url: string | null;
  port: number;
  enabled: number;
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
  timestamp: string;
}

export interface ScheduledJob {
  id: number;
  network_id: number | null;
  job_type: "ping_sweep" | "nmap_scan" | "arp_poll" | "dns_resolve" | "cleanup";
  interval_minutes: number;
  last_run: string | null;
  next_run: string | null;
  enabled: number;
  config: string;
  created_at: string;
  updated_at: string;
}

export interface StatusHistory {
  id: number;
  host_id: number;
  status: "online" | "offline";
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

export interface HostDetail extends Host {
  network_cidr: string;
  network_name: string;
  recent_scans: ScanHistory[];
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
}

export interface NetworkDeviceInput {
  name: string;
  host: string;
  device_type: "router" | "switch";
  vendor: "mikrotik" | "ubiquiti" | "hp" | "cisco" | "omada" | "other";
  protocol: "ssh" | "snmp_v2" | "snmp_v3" | "api";
  username?: string;
  password?: string;
  community_string?: string;
  api_token?: string;
  api_url?: string;
  port?: number;
}

export interface ScheduledJobInput {
  network_id?: number | null;
  job_type: "ping_sweep" | "nmap_scan" | "arp_poll" | "dns_resolve" | "cleanup";
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
}

export interface NmapResult {
  ip: string;
  alive: boolean;
  ports: NmapPort[];
  os: string | null;
  mac: string | null;
  snmpHostname?: string | null;
  snmpSysDescr?: string | null;
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
