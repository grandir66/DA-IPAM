/**
 * Mapping fra protocollo del network device e tipo di credenziale.
 * Usato nei dialog di bulk-add per filtrare la lista delle credenziali
 * mostrate al utente e per impostare il tipo di default nel quick-create.
 */

export interface CredentialProtocolMap {
  /** Tipo di credenziale "atteso" (default in quick-create). */
  primary: string;
  /** Tipi accettabili da mostrare nel select primario. */
  allowedPrimary: string[];
}

export function credTypeForProtocol(protocol: string | undefined | null): CredentialProtocolMap {
  switch (protocol) {
    case "winrm":
      return { primary: "windows", allowedPrimary: ["windows", "ssh", "api"] };
    case "ssh":
      return { primary: "ssh", allowedPrimary: ["ssh", "api", "linux"] };
    case "snmp_v2":
    case "snmp_v3":
      return { primary: "snmp", allowedPrimary: ["snmp"] };
    case "api":
      return { primary: "api", allowedPrimary: ["api", "ssh"] };
    default:
      return { primary: "ssh", allowedPrimary: ["ssh", "api", "windows", "linux"] };
  }
}

export const CRED_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "windows", label: "Windows (WinRM)" },
  { value: "ssh", label: "SSH" },
  { value: "linux", label: "Linux" },
  { value: "api", label: "API" },
  { value: "snmp", label: "SNMP community" },
];

export const CRED_TYPE_SNMP_ONLY: Array<{ value: string; label: string }> = [
  { value: "snmp", label: "SNMP" },
];
