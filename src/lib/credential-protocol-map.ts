/**
 * Mapping fra protocollo del network device e tipo di credenziale.
 * Usato nei dialog di bulk-add per filtrare la lista delle credenziali
 * mostrate al utente e per impostare il tipo di default nel quick-create.
 */

import { ETICHETTE_TIPO, TIPI_CREDENZIALE, tipiPerProtocollo } from "@/lib/credentials/tipi";

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

/**
 * Voci della tendina «SNMP aggiuntivo» (porte, LLDP, spanning tree): community
 * e SNMP v3, con la regola unica. Prima il filtro era `credential_type ===
 * "snmp"`: dalla 2c una voce `snmp_v3` sarebbe sparita (T12, 16/10).
 */
export function vociSnmpAggiuntive<T extends { credential_type: string }>(voci: readonly T[]): T[] {
  const tipi = tipiPerProtocollo("snmp");
  return voci.filter((v) => tipi.includes(v.credential_type));
}

/**
 * Piattaforma (`network_devices.vendor` di un sistema) → protocollo
 * dell'inventario software. Null: piattaforma assente o non riconosciuta.
 */
export function protocolloSoftware(piattaforma: string | null | undefined): "ssh" | "winrm" | null {
  switch ((piattaforma ?? "").trim().toLowerCase()) {
    case "windows":
      return "winrm";
    case "linux":
    case "macos":
      return "ssh";
    default:
      return null;
  }
}

/**
 * Voci della tendina dell'inventario software (T12, 16/10). Con la
 * piattaforma nota, quelle del suo protocollo; senza (un host), Windows e SSH.
 * Prima si teneva il tipo uguale al vendor («linux»): dalla 2c le voci
 * `linux` sono `ssh` e sarebbero sparite.
 */
export function vociSoftware<T extends { credential_type: string }>(voci: readonly T[], piattaforma?: string | null): T[] {
  const protocollo = protocolloSoftware(piattaforma);
  const tipi = protocollo ? tipiPerProtocollo(protocollo) : [...tipiPerProtocollo("winrm"), ...tipiPerProtocollo("ssh")];
  return voci.filter((v) => tipi.includes(v.credential_type));
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
 * I tipi d'archivio con le etichette per esteso (T13, 16/10): dalla 2c il
 * validatore e il DB accettano tutti e otto. Prima erano i cinque codici
 * grezzi, con «linux» a parte.
 */
export const CRED_TYPE_OPTIONS: Array<{ value: string; label: string }> = TIPI_CREDENZIALE.map((t) => ({ value: t, label: ETICHETTE_TIPO[t] }));

/**
 * Tipi della creazione rapida di una voce accanto a un apparato (pagina della
 * rete, discovery): quelli che valgono per il suo protocollo, e solo quelli
 * che si compilano con utente e password o community. Niente UniFi, Omada o
 * AD legati a un apparato; la SNMP v3, coi suoi livelli e protocolli, si crea
 * dalla pagina Credenziali.
 */
export function opzioniCreazioneRapida(protocollo: string | null | undefined): Array<{ value: string; label: string }> {
  const tipi = tipiPerProtocollo(protocollo);
  return CRED_TYPE_OPTIONS.filter((o) => tipi.includes(o.value) && o.value !== "snmp_v3");
}

/** Il tipo proposto nella creazione rapida: quello atteso dal protocollo, sempre fra gli offerti. */
export function tipoCreazioneRapida(protocollo: string | null | undefined): string {
  const offerti = opzioniCreazioneRapida(protocollo);
  const atteso = credTypeForProtocol(protocollo).primary;
  return offerti.some((o) => o.value === atteso) ? atteso : (offerti[0]?.value ?? atteso);
}

export const CRED_TYPE_SNMP_ONLY: Array<{ value: string; label: string }> = [
  { value: "snmp", label: "SNMP" },
];
