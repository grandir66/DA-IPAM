/**
 * Mapping fra protocollo del network device e tipo di credenziale.
 * Usato nei dialog di bulk-add per filtrare la lista delle credenziali
 * mostrate al utente e per impostare il tipo di default nel quick-create.
 */

import { etichettaTipo, tipiPerProtocollo } from "@/lib/credentials/tipi";

/**
 * Regola unica (tappa 1 credenziali, 15/10): quali tipi di credenziale
 * (`credentials.credential_type`) valgono per un protocollo — di apparato
 * (`network_devices.protocol`) o di binding (`protocol_type`). Prima c'erano
 * cinque regole diverse: per SSH le tendine mostravano le «windows» e
 * nascondevano le «linux», che la scansione SSH accetta.
 *
 * Tappa 2 (T2, 15/10): la regola sta in `credentials/tipi.ts`
 * (`tipiPerProtocollo`), la stessa che usa il motore; qui resta il nome che
 * le pagine importano già.
 */
export function tipiCredenzialePerProtocollo(protocollo: string | null | undefined): string[] {
  return tipiPerProtocollo(protocollo);
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

/**
 * Tipi della creazione rapida di una voce. Restano i cinque che
 * `CredentialSchema` e il CHECK di `credentials` accettano fino alla 2c: un
 * tipo nuovo qui darebbe 400 o 500. `linux` ha un'etichetta sua, altrimenti
 * comparirebbe due volte «SSH».
 */
export const CRED_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "windows", label: etichettaTipo("windows") },
  { value: "ssh", label: etichettaTipo("ssh") },
  { value: "linux", label: "Linux (come SSH)" },
  { value: "api", label: etichettaTipo("api") },
  { value: "snmp", label: etichettaTipo("snmp") },
];

export const CRED_TYPE_SNMP_ONLY: Array<{ value: string; label: string }> = [
  { value: "snmp", label: "SNMP" },
];
