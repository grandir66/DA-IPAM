export const ATTR_ENGINE_VERSION = "2.0.0";
export const MIN_CLAIM_SCORE = 0.56;   // coerente con MIN_APPLY_CONFIDENCE=56 del motore legacy
export const CONFLICT_WINDOW = 0.1;    // finestra di conflitto sulla scala score 0-1

/**
 * Soglia minima di confidence perché una sorgente in `AUTHORITATIVE_SOURCES`
 * (weights.ts) salti davvero la somma pesata. Caso reale che ha motivato la
 * soglia (VM 533, tenant 70791, 192.168.40.23 — Synology NAS): `wsd` è
 * autoritativa su `category`, ma il claim generico `wsdp:Device pub:Computer`
 * (emesso a confidence 0.5 — qualunque device SMB/Windows/NAS risponde così)
 * imponeva `compute` schiacciando `storage.nas` che valeva 1.2675 nella somma
 * pesata. L'autorità deve valere solo per claim DICHIARATIVI (manual=1.0,
 * ad/wazuh/inv_agent/winrm os=0.95, wsd av.camera/printer specifici >=0.9),
 * non per risposte deboli/ambigue che una sorgente "autoritativa" può comunque
 * emettere. Sotto soglia l'evidenza ricade nella normale somma pesata.
 */
export const AUTHORITY_MIN_CONFIDENCE = 0.9;

export type AttributionDimension = "vendor" | "category" | "os";

export const PHASE_ORDER = [
  "scan_icmp",
  "scan_naabu",
  "scan_nmap_base",
  "scan_snmp_verify",
  "credential_validate",
  "integration", // AD / Wazuh / agent GLPI / LLDP: presenti solo se il modulo è attivo
  "manual",
] as const;
export type AttributionPhase = (typeof PHASE_ORDER)[number];

export function phaseIndex(p: AttributionPhase): number {
  return PHASE_ORDER.indexOf(p);
}

// Vocabolario completo spec §4.2 — la fase 1 ne usa un sottoinsieme,
// ma il tipo è chiuso qui una volta sola.
export type AttributionSource =
  | "oui" | "mac_product" | "hostname" | "dhcp" | "ttl" | "ports"
  | "http_banner" | "tls_cert" | "snmp_sysobj" | "snmp_sysdescr"
  | "lldp" | "cdp" | "mdns" | "ssdp" | "wsd" | "netbios" | "smb"
  | "nmap_os" | "nmap_service" | "ad" | "wazuh" | "inv_agent"
  | "ssh" | "winrm" | "fingerbank" | "ai" | "manual" | "redfish";

export interface AttributionEvidenceRow {
  id: number;
  host_id: number;
  source: AttributionSource;
  phase: AttributionPhase;
  dimension: AttributionDimension;
  claim: string;
  confidence: number;   // 0-1
  weight: number;       // 0-1
  raw_value: string | null;
  observed_at: string;
  expires_at: string | null;
  superseded_by: number | null;
}

export interface EvidenceInput {
  source: AttributionSource;
  phase: AttributionPhase;
  dimension: AttributionDimension;
  claim: string;
  confidence: number;
  weight?: number;             // default: ATTR_SOURCE_WEIGHTS[source]
  raw_value?: string | null;
  expires_at?: string | null;  // segnali volatili (DHCP, TTL)
}
