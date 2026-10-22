/**
 * Forma dei dati che la scheda apparato legge da GET /api/devices/[id] (spostata qui da
 * `objects/[id]/page.tsx`, 21/10): serve alla pagina che li carica e a tutti i componenti di `scheda/`.
 */
import type { UsataAdesso } from "@/lib/devices/usata-adesso";
import type { NasInventorySnapshot } from "@/lib/devices/device-info";
import type { HardwareMikrotik, RisorseMikrotik } from "@/lib/devices/mikrotik-scheda";
import type { NetworkDevice, ArpEntry, MacPortEntry, SwitchPort } from "@/types";

/** Dati addizionali ritornati da GET /api/devices/[id] oltre al NetworkDevice base. */
export interface DeviceExtras {
  /** Credenziale che il motore usa davvero per ogni protocollo (tappa 5): la scheda «Credenziali assegnate». */
  usata_adesso?: UsataAdesso[];
  /** L'API ritorna già parsato (campo proxmox_data); last_proxmox_scan_result viene nullificato. */
  proxmox_data?: ProxmoxScanViewModel | null;
  /** L'API ritorna già parsato (campo device_info); last_device_info_json viene rimosso. */
  device_info?: DeviceInfoJson | null;
  /** stp_info è già oggetto, non stringa. */
  stp_info?: StpInfo | null;
  /** Solo MikroTik letto via SSH (lo riempie GET /api/devices/[id], Task 9): bridge dell'ultima lettura, sua data, lettura della topologia accesa. */
  mikrotik?: { bridge: number; letto_il: string | null; topologia_accesa: boolean } | null;
  arp_entries?: Array<ArpEntry & { hostname?: string | null; host_ip?: string | null; host_name?: string | null }>;
  mac_port_entries?: Array<MacPortEntry & { host_ip?: string | null; host_name?: string | null }>;
  switch_ports?: SwitchPort[];
  /** VLAN dell'ultima lettura «VLAN degli switch via SNMP» (GET /api/devices/[id], Task 11 accorpamento); 0 = nessuna. */
  switch_vlan_n?: number;
  neighbors?: Array<{
    id?: number;
    interface_name?: string | null;
    neighbor_name?: string | null;
    neighbor_port?: string | null;
    neighbor_platform?: string | null;
    neighbor_address?: string | null;
    protocol?: string | null;
    // Le colonne vere di `device_neighbors` (la rotta le restituisce così): le usa la scheda switch.
    local_port?: string | null;
    remote_device_name?: string | null;
    remote_port?: string | null;
    remote_ip?: string | null;
    remote_mac?: string | null;
    remote_platform?: string | null;
    /** Scheda MikroTik: `version=` annunciata dal vicino (MNDP). */
    remote_version?: string | null;
  }>;
  routes?: Array<{
    id?: number;
    destination?: string;
    gateway?: string | null;
    interface_name?: string | null;
    distance?: number | null;
    protocol?: string | null;
    /** Colonne vere di `routing_table`: 1 = attiva. */
    active?: number | null;
    metric?: number | null;
    timestamp?: string | null;
  }>;
  dhcp_leases?: Array<{
    id?: number;
    ip: string;
    mac: string;
    hostname?: string | null;
    status?: string | null;
    server?: string | null;
    expires_at?: string | null;
    lease_type?: string | null;
    updated_at?: string | null;
    // Le colonne vere di `dhcp_leases` (la rotta restituisce la riga così): le usa la scheda router e firewall.
    ip_address?: string;
    mac_address?: string;
    server_name?: string | null;
    lease_expires?: string | null;
    dynamic_lease?: number | null;
    description?: string | null;
    last_seen?: string | null;
  }>;
}

export type DeviceFull = NetworkDevice & DeviceExtras;

/**
 * Subset esteso dei dati di `network_devices.last_device_info_json`.
 * Campi rilevati da audit Windows + Linux server (chiavi del DB reale).
 */
export interface DeviceInfoJson {
  mikrotik_risorse?: RisorseMikrotik;
  mikrotik_hardware?: HardwareMikrotik;
  // OS / Identità
  hostname?: string;
  domain?: string;
  domain_role?: string;
  is_domain_controller?: boolean;
  is_server?: boolean;
  is_virtual?: boolean;
  virtualization?: string;
  os_name?: string;
  os_version?: string;
  os_build?: string;
  os_serial?: string;
  kernel_version?: string;
  architecture?: string;
  uptime_days?: number;
  uptime?: string;
  last_boot?: string;
  install_date?: string;
  registered_user?: string;
  organization?: string;
  load_average?: string;
  // Hardware
  manufacturer?: string;
  model?: string;
  system_type?: string;
  serial_number?: string;
  bios_manufacturer?: string;
  bios_version?: string;
  cpu_model?: string;
  cpu_manufacturer?: string;
  cpu_cores?: number;
  cpu_threads?: number;
  cpu_speed_mhz?: number;
  processor_count?: number;
  ram_total_gb?: number;
  ram_total_mb?: number;
  ram_free_mb?: number;
  gpu?: Array<{ name?: string; vram_mb?: number; driver?: string }> | string;
  memory_modules?: Array<{ size_gb?: number; speed_mhz?: number; manufacturer?: string; locator?: string }>;
  // Storage
  disks?: Array<{ device?: string; size_gb?: number; free_gb?: number; filesystem?: string; label?: string; mountpoint?: string }>;
  physical_disks?: Array<{ device?: string; model?: string; size_gb?: number; serial?: string; interface_type?: string; vendor?: string; rotational?: boolean }>;
  disk_total_gb?: number;
  disk_free_gb?: number;
  // Network adapters
  network_adapters?: Array<{ name?: string; ips?: string[] | string; mac?: string; mac_address?: string; dhcp?: boolean; speed_mbps?: number; status?: string }>;
  // Sicurezza Windows
  license_name?: string;
  license_status?: string;
  license_partial_key?: string;
  antivirus?: Array<{ name?: string; status?: string } | string>;
  firewall_active?: boolean;
  firewall_type?: string;
  firewall_rules_count?: number;
  /** MikroTik: conteggi delle regole per tabella (letti dalla scansione SSH). */
  firewall_filter_count?: number | null;
  firewall_nat_count?: number | null;
  firewall_mangle_count?: number | null;
  // Aggiornamenti
  installed_hotfixes?: Array<{ id?: string; description?: string; installed_on?: string }>;
  pending_updates_count?: number;
  // Servizi & ruoli
  server_roles?: string[];
  important_services?: Array<{ name?: string; display_name?: string; state?: string; start_mode?: string }>;
  // Linux processi
  listening_ports?: Array<{ protocol?: string; port?: number; process?: string; bind_address?: string }>;
  cron_jobs?: Array<{ user?: string; schedule?: string; command?: string }>;
  // Utenti
  local_users?: Array<{ name?: string; full_name?: string; disabled?: boolean }>;
  logged_on_users?: Array<{ username?: string; session_type?: string; logon_time?: string }>;
  /** Ultimo utente che ha fatto il login (registro Windows) e profili sul sistema, con i dati AD se il server è nel dominio. */
  last_logged_on_user?: string | null;
  user_profiles?: Array<{
    username?: string; sid?: string; profile_path?: string; loaded?: boolean; last_use?: string;
    ad_display_name?: string; ad_email?: string; ad_department?: string; ad_title?: string; ad_enabled?: boolean; ad_last_logon?: string;
  }>;
  // Software
  key_software?: Array<{ name?: string; version?: string; publisher?: string }>;
  installed_software_count?: number;
  packages_count?: number;
  // Snapshot NAS Synology/QNAP (scan SNMP/SSH): il tipo è quello che lo scrive l'acquisizione
  nas_inventory?: NasInventorySnapshot;
  // Metadata
  scanned_at?: string;
}

/** STP info salvata in `network_devices.stp_info` come JSON. */
export interface StpInfo {
  bridge_id?: string | null;
  root_bridge_id?: string | null;
  priority?: number | null;
  root_cost?: number | null;
  root_port?: string | null;
  hello_time_s?: number | null;
  forward_delay_s?: number | null;
  max_age_s?: number | null;
  is_root_bridge?: boolean;
  protocol?: "stp" | "rstp" | null;
}

/** Payload da `network_devices.last_proxmox_scan_result`. */
export interface ProxmoxScanViewModel {
  hosts?: Array<{
    hostname: string;
    status: string;
    cpu_model?: string | null;
    cpu_total_cores?: number | null;
    cpu_sockets?: number | null;
    cpu_cores?: number | null;
    cpu_mhz?: number | null;
    memory_total_gb?: number | null;
    memory_used_gb?: number | null;
    memory_free_gb?: number | null;
    memory_usage_percent?: number | null;
    proxmox_version?: string | null;
    kernel_version?: string | null;
    uptime_human?: string | null;
    uptime_seconds?: number | null;
    rootfs_total_gb?: number | null;
    rootfs_used_gb?: number | null;
    hardware_serial?: string | null;
    hardware_model?: string | null;
    hardware_manufacturer?: string | null;
    subscription?: {
      status?: string;
      productname?: string;
      level?: string;
      key?: string;
      regdate?: string;
      nextduedate?: string;
      sockets?: number;
      serverid?: string;
    } | null;
    storage?: Array<{
      name: string;
      type?: string;
      status?: string;
      total_gb?: number;
      used_gb?: number;
      available_gb?: number;
      content?: string;
    }>;
    network_interfaces?: Array<{
      name: string;
      type?: string;
      state?: string;
      mac_address?: string | null;
      ip_addresses?: string | null;
      bridge?: string | null;
      speed_mbps?: number | null;
    }>;
  }>;
  vms?: Array<{
    node: string;
    vmid: number;
    name: string;
    type: string;
    status?: string;
    maxcpu: number;
    cores?: number;
    sockets?: number;
    memory_mb: number;
    maxmem?: number;
    disk_gb: number;
    maxdisk?: number;
    ip_addresses: string[];
    disks_details?: Array<{ id?: string; storage?: string; size?: string }>;
    networks_details?: Array<{ id?: string; model?: string; mac?: string; bridge?: string; vlan?: string }>;
    bios?: string;
    agent?: number;
  }>;
  scanned_at?: string;
  _truncated?: boolean;
  _total_vm_rows?: number;
}
