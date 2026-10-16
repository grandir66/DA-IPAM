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

/** Il minimo di un binding che serve a `bindingDelRouter`. */
export interface BindingOrdinato {
  id: number;
  protocol_type: string;
  credential_id: number | null;
  sort_order: number;
}

/**
 * I binding che fanno da voce principale e da voce SNMP separata di un
 * apparato: il primo in ordine (`sort_order`, poi `id`) sul protocollo
 * principale e, se l'accesso non è già SNMP, il primo SNMP. Anche inline
 * (`credential_id` null): sono quelli che il vecchio wizard lasciava.
 *
 * Perché (revisione della 2e, 16/10): il wizard del router trovava il binding
 * da sostituire dalle colonne `credential_id` / `snmp_credential_id`, che la
 * conversione della 2e svuota e che la creazione non scrive più: leggeva
 * «nessuna voce» e aggiungeva i binding nuovi accanto ai vecchi.
 */
export function bindingDelRouter<B extends BindingOrdinato>(protocollo: string, bindings: readonly B[]): { principale: B | undefined; snmp: B | undefined } {
  const ordinati = [...bindings].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  const tipo = tipoBindingPerProtocollo(protocollo);
  return {
    principale: ordinati.find((b) => b.protocol_type === tipo),
    snmp: tipo === "snmp" ? undefined : ordinati.find((b) => b.protocol_type === "snmp"),
  };
}

/** Le due voci del router come le mostra il wizard: dai binding, non dalle colonne. */
export function vociDelRouter(protocollo: string, bindings: readonly BindingOrdinato[]): { credential_id: number | null; snmp_credential_id: number | null } {
  const { principale, snmp } = bindingDelRouter(protocollo, bindings);
  return { credential_id: principale?.credential_id ?? null, snmp_credential_id: snmp?.credential_id ?? null };
}
