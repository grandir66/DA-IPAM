/**
 * Mapping fra protocollo del network device e tipo di credenziale.
 * Usato nei dialog di bulk-add per filtrare la lista delle credenziali
 * mostrate al utente e per impostare il tipo di default nel quick-create.
 */

/**
 * Regola unica (tappa 1 credenziali, 15/10): quali tipi di credenziale
 * (`credentials.credential_type`) valgono per un protocollo — di apparato
 * (`network_devices.protocol`) o di binding (`protocol_type`). Prima c'erano
 * cinque regole diverse: per SSH le tendine mostravano le «windows» e
 * nascondevano le «linux», che la scansione SSH accetta.
 * - SSH: `ssh` e `linux` (getSshLinuxCredentialPair accetta entrambe);
 * - WinRM: solo `windows` (la prova WinRM rifiuta le altre);
 * - SNMP: solo `snmp`;
 * - API: `api` e `ssh` (Proxmox con utente root: l'acquisizione non guarda il tipo);
 * - Redfish/ONVIF: `api`.
 * Protocollo sconosciuto o assente: i tipi di accesso, senza SNMP (come prima).
 */
export function tipiCredenzialePerProtocollo(protocollo: string | null | undefined): string[] {
  switch (protocollo) {
    case "ssh":
      return ["ssh", "linux"];
    case "winrm":
      return ["windows"];
    case "snmp":
    case "snmp_v2":
    case "snmp_v3":
      return ["snmp"];
    case "api":
      return ["api", "ssh"];
    case "redfish":
    case "onvif":
      return ["api"];
    default:
      return ["ssh", "api", "windows", "linux"];
  }
}

export interface CredentialProtocolMap {
  /** Tipo di credenziale "atteso" (default in quick-create). */
  primary: string;
  /** Tipi accettabili da mostrare nel select primario. */
  allowedPrimary: string[];
}

export function credTypeForProtocol(protocol: string | undefined | null): CredentialProtocolMap {
  const allowedPrimary = tipiCredenzialePerProtocollo(protocol);
  switch (protocol) {
    case "winrm":
      return { primary: "windows", allowedPrimary };
    case "snmp_v2":
    case "snmp_v3":
      return { primary: "snmp", allowedPrimary };
    case "api":
      return { primary: "api", allowedPrimary };
    default:
      return { primary: "ssh", allowedPrimary };
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
