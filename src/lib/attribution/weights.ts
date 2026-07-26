import type { AttributionDimension, AttributionSource } from "./types";

export const ATTR_SOURCE_WEIGHTS: Record<AttributionSource, number> = {
  manual: 1, ad: 1, wazuh: 1, inv_agent: 0.95, winrm: 0.95,
  snmp_sysobj: 0.95, snmp_sysdescr: 0.85, lldp: 0.9, cdp: 0.9,
  oui: 0.9, mac_product: 0.85, http_banner: 0.9, tls_cert: 0.85,
  wsd: 0.9, mdns: 0.8, ssdp: 0.75, smb: 0.75, ssh: 0.6,
  fingerbank: 0.6, netbios: 0.5, nmap_os: 0.5, nmap_service: 0.5,
  hostname: 0.35, ports: 0.3, dhcp: 0.3, ttl: 0.25, ai: 0.5,
};

/**
 * Sorgenti dichiarative (spec §4.3 punto 4): saltano la somma pesata.
 * Fase 1: lldp/cdp NON sono qui perché device_neighbors non persiste i
 * capability bits — l'evidenza LLDP odierna è testuale (remote_platform)
 * e resta probabilistica. Entreranno quando i collector le raccoglieranno.
 */
export const AUTHORITATIVE_SOURCES: Record<AttributionDimension, readonly AttributionSource[]> = {
  vendor: ["manual"],
  category: ["manual", "wsd"],
  os: ["manual", "ad", "wazuh", "inv_agent", "winrm"],
};
