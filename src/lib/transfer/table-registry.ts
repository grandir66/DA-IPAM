// src/lib/transfer/table-registry.ts
import type { TableSpec, Tier } from "./types";

/** Tabelle del DB tenant. Tier: config sempre incluso; asset/mirror default ON; history default OFF. */
export const TENANT_TABLES: TableSpec[] = [
  // --- config ---
  { table: "networks", scope: "tenant", tier: "config" },
  { table: "credentials", scope: "tenant", tier: "config" },
  { table: "network_credentials", scope: "tenant", tier: "config" },
  { table: "host_credentials", scope: "tenant", tier: "config" },
  // network_host_credentials e host_detect_credential: in EXCLUDED_TENANT_TABLES dalla 2g (T26).
  { table: "device_credential_bindings", scope: "tenant", tier: "config" },
  { table: "network_devices", scope: "tenant", tier: "config", secretColumns: ["community_string", "api_token"] },
  { table: "mc_config", scope: "tenant", tier: "config", secretColumns: ["login_token_key_encrypted", "admin_pass_encrypted"] },
  { table: "network_router", scope: "tenant", tier: "config" },
  { table: "ad_integrations", scope: "tenant", tier: "config" },
  { table: "vuln_scanners", scope: "tenant", tier: "config" },
  { table: "librenms_host_map", scope: "tenant", tier: "config" },
  { table: "scheduled_jobs", scope: "tenant", tier: "config" },
  { table: "tenant_settings", scope: "tenant", tier: "config" },
  { table: "excluded_ips", scope: "tenant", tier: "config" },
  { table: "physical_devices", scope: "tenant", tier: "config" },
  { table: "device_interfaces", scope: "tenant", tier: "config" },
  { table: "topology_position", scope: "tenant", tier: "config" },
  { table: "topology_link_overrides", scope: "tenant", tier: "config" },
  { table: "topology_maps", scope: "tenant", tier: "config" }, // nasce in migrateTopologyPhase2, non nello schema
  // Unioni e separazioni a mano (ADR 0021): scelte di un admin, con la loro storia (righe tolte comprese).
  { table: "topology_unioni", scope: "tenant", tier: "config" },
  { table: "topology_separazioni", scope: "tenant", tier: "config" },
  { table: "device_interface_addresses", scope: "tenant", tier: "config" },
  { table: "multihomed_links", scope: "tenant", tier: "config" },
  { table: "device_classifications_custom", scope: "tenant", tier: "config" },
  { table: "proxmox_hosts", scope: "tenant", tier: "config" },
  { table: "mdm_config", scope: "tenant", tier: "config", secretColumns: ["password_encrypted"] },
  { table: "edge_scan_schedules", scope: "tenant", tier: "config" },
  { table: "network_controllers", scope: "tenant", tier: "config", secretColumns: ["password_enc", "api_key_enc"] },
  // Pannello Zabbix (passo 7.4): gli abbinamenti verificati da una persona viaggiano con gli host.
  // La configurazione no (in EXCLUDED_TENANT_TABLES): la chiave di lettura vale per un'istanza sola.
  { table: "zabbix_abbinamenti", scope: "tenant", tier: "config" },
  // --- asset (default ON) ---
  { table: "hosts", scope: "tenant", tier: "asset" },
  // Archivio della pulizia degli host (piano 2026-10-20): istantanee degli host tolti, viaggiano con gli host.
  { table: "hosts_archivio", scope: "tenant", tier: "asset" },
  { table: "mobile_devices", scope: "tenant", tier: "asset" },
  { table: "inventory_assets", scope: "tenant", tier: "asset" },
  { table: "asset_assignees", scope: "tenant", tier: "asset" },
  { table: "locations", scope: "tenant", tier: "asset" },
  { table: "services", scope: "tenant", tier: "asset" },
  { table: "service_asset_dependencies", scope: "tenant", tier: "asset" },
  { table: "licenses", scope: "tenant", tier: "asset" },
  { table: "license_seats", scope: "tenant", tier: "asset" },
  { table: "inventory_audit_log", scope: "tenant", tier: "asset" },
  // --- history (default OFF) ---
  { table: "network_controller_runs", scope: "tenant", tier: "history" },
  { table: "scan_history", scope: "tenant", tier: "history" },
  { table: "status_history", scope: "tenant", tier: "history" },
  { table: "software_scans", scope: "tenant", tier: "history" },
  { table: "software_scan_logs", scope: "tenant", tier: "history" },
  { table: "anomaly_events", scope: "tenant", tier: "history" },
  { table: "classification_feedback", scope: "tenant", tier: "history" },
  { table: "host_classification_history", scope: "tenant", tier: "history" },
  { table: "attribution_evidence", scope: "tenant", tier: "history" },
  { table: "arp_entries", scope: "tenant", tier: "history" },
  // Indice unico (device_id, mac, port_name) dalla fase 2 della topologia: una sorgente più vecchia ha i doppi.
  { table: "mac_port_entries", scope: "tenant", tier: "history", dedupe: { key: ["device_id", "mac", "port_name"], latest: "timestamp" } },
  { table: "mac_ip_mapping", scope: "tenant", tier: "history" },
  { table: "mac_ip_history", scope: "tenant", tier: "history" },
  { table: "switch_ports", scope: "tenant", tier: "history" },
  { table: "routing_table", scope: "tenant", tier: "history" },
  { table: "device_neighbors", scope: "tenant", tier: "history" },
  // Fatti delle letture in più della topologia (T2, spec §13.5.7): storico per lettore, potato a 90 giorni come i vicini.
  { table: "topology_port_facts", scope: "tenant", tier: "history" },
  { table: "topology_bridge_facts", scope: "tenant", tier: "history" },
  { table: "topology_device_macs", scope: "tenant", tier: "history" },
  // Scheda MikroTik (ADR 0027): fotografia di bridge, porte e bond dell'ultima lettura, riscritta a ogni giro.
  { table: "mikrotik_bridge", scope: "tenant", tier: "history" },
  { table: "mikrotik_bridge_port", scope: "tenant", tier: "history" },
  { table: "mikrotik_bond", scope: "tenant", tier: "history" },
  // Livello 3 (Task 10): VLAN dei bridge, interfacce VLAN, DNS e utenti del router (questi solo admin, come l'esportazione).
  { table: "mikrotik_bridge_vlan", scope: "tenant", tier: "history" },
  { table: "mikrotik_vlan", scope: "tenant", tier: "history" },
  { table: "mikrotik_dns", scope: "tenant", tier: "history" },
  { table: "mikrotik_user", scope: "tenant", tier: "history" },
  // VLAN degli switch via SNMP (ADR 0029): fotografia dell'ultima lettura buona, riscritta a ogni lettura.
  { table: "switch_vlan", scope: "tenant", tier: "history" },
  { table: "switch_vlan_porte", scope: "tenant", tier: "history" },
  { table: "switch_porta_pvid", scope: "tenant", tier: "history" },
  { table: "switch_vlan_lettura", scope: "tenant", tier: "history" },
  // VLAN native dal controller UniFi (Task 13): fotografia della sync UniFi, riscritta a ogni giro.
  { table: "switch_vlan_nativa", scope: "tenant", tier: "history" },
  // Ultimo esito per apparato dei job apparati_scelti (piano 2026-10-22): riscritto a ogni giro, segue i job.
  { table: "job_apparati_esiti", scope: "tenant", tier: "history" },
  // LibreNMS come fonte di dati (piano 2026-10-22): fotografia dell'ultima lettura buona per parte, riscritta a ogni giro.
  { table: "librenms_apparato", scope: "tenant", tier: "history" },
  { table: "librenms_porta", scope: "tenant", tier: "history" },
  { table: "librenms_vicino", scope: "tenant", tier: "history" },
  { table: "librenms_vlan", scope: "tenant", tier: "history" },
  { table: "librenms_mac_porta", scope: "tenant", tier: "history" },
  { table: "librenms_arp", scope: "tenant", tier: "history" },
  { table: "librenms_sensore", scope: "tenant", tier: "history" },
  { table: "librenms_inventario", scope: "tenant", tier: "history" },
  { table: "librenms_lettura", scope: "tenant", tier: "history" },
  { table: "librenms_rifiuto", scope: "tenant", tier: "history" },
  { table: "mobile_inventory_history", scope: "tenant", tier: "history" },
  { table: "mc_remote_session", scope: "tenant", tier: "history" }, // sessioni remote effimere
  { table: "mc_command_log", scope: "tenant", tier: "history" },    // audit comandi RMM
  // --- mirror (default ON) ---
  { table: "software_inventory", scope: "tenant", tier: "mirror" },
  { table: "mobile_device_inventory", scope: "tenant", tier: "mirror" },
  { table: "mobile_device_apps", scope: "tenant", tier: "mirror" },
  { table: "mc_node", scope: "tenant", tier: "mirror" },      // mapping host→nodo MeshCentral
  { table: "mc_node_bind", scope: "tenant", tier: "mirror" },
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
  { table: "tenant_features", scope: "hub-tenant", tier: "config", tenantColumn: "tenant_code", mergeKey: ["tenant_code", "feature_key"] },
  { table: "system_credentials", scope: "hub-vault", tier: "config", mergeKey: ["kind", "label"] },
  { table: "nmap_profiles", scope: "hub-global", tier: "config", mergeKey: ["name"] },
  { table: "snmp_vendor_profiles", scope: "hub-global", tier: "config", mergeKey: ["name"] },
  { table: "device_fingerprint_rules", scope: "hub-global", tier: "config", mergeKey: ["name"] },
  { table: "fingerprint_classification_map", scope: "hub-global", tier: "config", mergeKey: ["fingerprint"] },
  { table: "sysobj_lookup", scope: "hub-global", tier: "config", mergeKey: ["oid"] },
  { table: "mac_product_map", scope: "hub-global", tier: "config", mergeKey: ["mac_prefix", "hostname_pattern"] },
];

/**
 * Tabelle tenant volutamente NON esportate: le catene vecchie e i pin (tappa 2g
 * credenziali, T26). Non le legge né le scrive più nessuno, la pulizia della 2g
 * le toglie, e l'import di un bundle di prima le converte in memoria.
 */
export const EXCLUDED_TENANT_TABLES: string[] = [
  "network_host_credentials",
  "host_detect_credential",
  // Chiave di lettura del centro Zabbix: una per cliente E per istanza (design dell'API, §2). Un'altra
  // installazione riceve la sua dal kit di DA-Link; copiarla farebbe parlare due istanze con la stessa chiave.
  "zabbix_lettura_config",
];

/** Tabelle hub install-level: identità/auth/setup, NON viaggiano col tenant. */
export const EXCLUDED_HUB_TABLES: string[] = [
  "users",
  "user_tenant_access",
  "settings",
  "inventory_ingest_tokens",
  "tenant_agents",
  "system_credential_events",
  // DA-Link (tappa C1): la scelta di cosa esce è di questa istanza, non dei dati
  // del cliente; un'altra istanza la dichiara da sé.
  "dalink_livello_registro",
  "dalink_segnale_stato",
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
