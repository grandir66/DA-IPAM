/**
 * Binding delle credenziali di un apparato: tipo di binding per il protocollo
 * dell'apparato e porta della voce principale. Condiviso da `creaApparato` e
 * dalla modifica del router del wizard (tappa 4 credenziali, revisione del
 * 15/10): prima la regola stava solo dentro `creaApparato`, e la modifica del
 * router aggiornava le colonne senza i binding che il sistema legge per primi.
 * Modulo puro.
 */
import { DEFAULT_PORTS, type CredProtocol } from "@/lib/credentials/porte";
import { portaVoceValePer } from "@/lib/credentials/tipi";

/** `network_devices.protocol` → `device_credential_bindings.protocol_type`, come in `creaApparato`. */
export function tipoBindingPerProtocollo(protocollo: string): CredProtocol {
  if (protocollo === "winrm") return "winrm";
  if (protocollo === "snmp_v2" || protocollo === "snmp_v3") return "snmp";
  if (protocollo === "api") return "api";
  return "ssh";
}

/**
 * Porta con cui si usa la voce principale dell'apparato: quella propria della
 * voce se è di un tipo di quel protocollo (una SSH sulla 2222), altrimenti lo
 * standard del protocollo.
 */
export function portaVocePrincipale(voce: { credential_type: string; port: number | null }, protocollo: string): number {
  if (voce.port != null && portaVoceValePer(voce.credential_type, protocollo)) return voce.port;
  return DEFAULT_PORTS[tipoBindingPerProtocollo(protocollo)];
}
