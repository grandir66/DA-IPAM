// src/lib/transfer/table-registry.ts
import type { TableSpec, Tier } from "./types";

/** Tabelle del DB tenant. Tier: config sempre incluso; asset/mirror default ON; history default OFF. */
export const TENANT_TABLES: TableSpec[] = [
  // --- config ---
  { table: "networks", scope: "tenant", tier: "config" },
  { table: "credentials", scope: "tenant", tier: "config" },
  { table: "network_credentials", scope: "tenant", tier: "config" },
  { table: "host_credentials", scope: "tenant", tier: "config" },
  { table: "network_host_credentials", scope: "tenant", tier: "config" },
  { table: "host_detect_credential", scope: "tenant", tier: "config" },
  { table: "device_credential_bindings", scope: "tenant", tier: "config" },
  { table: "network_devices", scope: "tenant", tier: "config" },
  { table: "network_router", scope: "tenant", tier: "config" },
  { table: "ad_integrations", scope: "tenant", tier: "config" },
  { table: "vuln_scanners", scope: "tenant", tier: "config" },
  { table: "librenms_host_map", scope: "tenant", tier: "config" },
  { table: "scheduled_jobs", scope: "tenant", tier: "config" },
  { table: "tenant_settings", scope: "tenant", tier: "config" },
  { table: "excluded_ips", scope: "tenant", tier: "config" },
  { table: "physical_devices", scope: "tenant", tier: "config" },
  { table: "device_interfaces", scope: "tenant", tier: "config" },
  { table: "device_interface_addresses", scope: "tenant", tier: "config" },
  { table: "multihomed_links", scope: "tenant", tier: "config" },
  { table: "device_classifications_custom", scope: "tenant", tier: "config" },
  { table: "proxmox_hosts", scope: "tenant", tier: "config" },
  // --- asset (default ON) ---
  { table: "hosts", scope: "tenant", tier: "asset" },
  { table: "inventory_assets", scope: "tenant", tier: "asset" },
  { table: "asset_assignees", scope: "tenant", tier: "asset" },
  { table: "locations", scope: "tenant", tier: "asset" },
  { table: "services", scope: "tenant", tier: "asset" },
  { table: "service_asset_dependencies", scope: "tenant", tier: "asset" },
  { table: "licenses", scope: "tenant", tier: "asset" },
  { table: "license_seats", scope: "tenant", tier: "asset" },
  { table: "inventory_audit_log", scope: "tenant", tier: "asset" },
  // --- history (default OFF) ---
  { table: "scan_history", scope: "tenant", tier: "history" },
  { table: "status_history", scope: "tenant", tier: "history" },
  { table: "software_scans", scope: "tenant", tier: "history" },
  { table: "software_scan_logs", scope: "tenant", tier: "history" },
  { table: "anomaly_events", scope: "tenant", tier: "history" },
  { table: "classification_feedback", scope: "tenant", tier: "history" },
  { table: "arp_entries", scope: "tenant", tier: "history" },
  { table: "mac_port_entries", scope: "tenant", tier: "history" },
  { table: "mac_ip_mapping", scope: "tenant", tier: "history" },
  { table: "mac_ip_history", scope: "tenant", tier: "history" },
  { table: "switch_ports", scope: "tenant", tier: "history" },
  { table: "routing_table", scope: "tenant", tier: "history" },
  { table: "device_neighbors", scope: "tenant", tier: "history" },
  // --- mirror (default ON) ---
  { table: "software_inventory", scope: "tenant", tier: "mirror" },
  { table: "wazuh_agent", scope: "tenant", tier: "mirror" },
  { table: "wazuh_hw", scope: "tenant", tier: "mirror" },
  { table: "wazuh_os", scope: "tenant", tier: "mirror" },
  { table: "wazuh_software", scope: "tenant", tier: "mirror" },
  { table: "wazuh_vuln", scope: "tenant", tier: "mirror" },
  { table: "wazuh_ports", scope: "tenant", tier: "mirror" },
  { table: "wazuh_hotfix", scope: "tenant", tier: "mirror" },
  { table: "wazuh_netiface", scope: "tenant", tier: "mirror" },
  { table: "wazuh_netaddr", scope: "tenant", tier: "mirror" },
  { table: "wazuh_netproto", scope: "tenant", tier: "mirror" },
  { table: "wazuh_process", scope: "tenant", tier: "mirror" },
  { table: "wazuh_service", scope: "tenant", tier: "mirror" },
  { table: "ad_computers", scope: "tenant", tier: "mirror" },
  { table: "ad_users", scope: "tenant", tier: "mirror" },
  { table: "ad_groups", scope: "tenant", tier: "mirror" },
  { table: "ad_dhcp_leases", scope: "tenant", tier: "mirror" },
  { table: "dhcp_leases", scope: "tenant", tier: "mirror" },
  { table: "vuln_findings", scope: "tenant", tier: "mirror" },
  { table: "vuln_scan_runs", scope: "tenant", tier: "mirror" },
];

/** Tabelle hub incluse nel bundle per-tenant. */
export const HUB_TABLES: TableSpec[] = [
  { table: "tenants", scope: "hub-tenant", tier: "config", tenantColumn: "codice_cliente", mergeKey: ["codice_cliente"] },
  { table: "tenant_features", scope: "hub-tenant", tier: "config", tenantColumn: "tenant_code" },
  { table: "system_credentials", scope: "hub-vault", tier: "config", mergeKey: ["kind", "label"] },
  { table: "nmap_profiles", scope: "hub-global", tier: "config", mergeKey: ["name"] },
  { table: "snmp_vendor_profiles", scope: "hub-global", tier: "config", mergeKey: ["name"] },
  { table: "device_fingerprint_rules", scope: "hub-global", tier: "config", mergeKey: ["name"] },
  { table: "fingerprint_classification_map", scope: "hub-global", tier: "config", mergeKey: ["fingerprint"] },
  { table: "sysobj_lookup", scope: "hub-global", tier: "config", mergeKey: ["sys_object_id"] },
];

/** Tabelle tenant volutamente NON esportate (nessuna oggi: tutte classificate). */
export const EXCLUDED_TENANT_TABLES: string[] = [];

/** Tabelle hub install-level: identità/auth/setup, NON viaggiano col tenant. */
export const EXCLUDED_HUB_TABLES: string[] = [
  "users",
  "user_tenant_access",
  "settings",
  "inventory_ingest_tokens",
  "tenant_agents",
  "system_credential_events",
];

const BY_NAME = new Map<string, TableSpec>(
  [...TENANT_TABLES, ...HUB_TABLES].map((t) => [t.table, t]),
);

export function tableSpec(table: string): TableSpec | undefined {
  return BY_NAME.get(table);
}

/** Specs da esportare per i tier scelti. config sempre incluso; vault solo se includeVault. */
export function tablesForTiers(tiers: Tier[], includeVault: boolean): TableSpec[] {
  const wanted = new Set<Tier>(["config", ...tiers]);
  return [...TENANT_TABLES, ...HUB_TABLES].filter((t) => {
    if (t.scope === "hub-vault") return includeVault;
    return wanted.has(t.tier);
  });
}
