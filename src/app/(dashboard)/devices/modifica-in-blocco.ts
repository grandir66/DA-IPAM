/**
 * Corpi delle richieste di modifica degli apparati: in blocco (PATCH
 * `/api/devices/bulk`) e del singolo (PUT `/api/devices/[id]`). Modulo puro,
 * usato dalle finestre client.
 *
 * Perché esiste (tappa 2 credenziali, T5, 15/10): la finestra in blocco partiva
 * con le tendine delle credenziali a `null` e mandava `credential_id: null` e
 * `snmp_credential_id: null` anche lasciandole su «Non modificare». Il PATCH
 * azzerava così colonne, utente e password di ogni apparato selezionato, e per
 * 6 apparati di H1 e 1 di A erano l'unico accesso. Le finestre del singolo
 * mandavano sempre i due campi, con `null` a tendina vuota.
 *
 * Valori delle tendine (come le tiene `CredentialAssignmentFields`):
 * - `null` o `""`: «Non modificare» nella finestra in blocco, nessuna voce nel
 *   singolo;
 * - `"none"`: «Nessuna», cioè togliere la voce;
 * - `"<id>"`: la voce dell'archivio con quell'id.
 */

/** Lo stato della finestra «Assegna caratteristiche» (modifica in blocco). */
export interface StatoModificaInBlocco {
  deviceIds: number[];
  hostIds: number[];
  /** `""` = «Non modificare». */
  classification: string;
  /** `""` = «Non modificare». */
  protocol: string;
  /** `""` = «Non modificare». */
  vendor: string;
  credentialId: string | null;
  snmpCredentialId: string | null;
}

/** Le due tendine delle credenziali di un apparato. */
export interface TendineCredenziali {
  credentialId: string | null;
  snmpCredentialId: string | null;
}

/** Lo stato della finestra di modifica del singolo apparato al salvataggio. */
export interface StatoModificaApparato extends TendineCredenziali {
  /** I campi che la finestra manda già (nome, IP, profilo, protocollo…), senza credenziali. */
  campi: Record<string, unknown>;
}

/** Campi che la rotta in blocco applica: senza almeno uno di questi non c'è niente da fare. */
const CAMPI_DA_APPLICARE = ["classification", "protocol", "vendor", "credential_id", "snmp_credential_id"] as const;

/**
 * Valore di una tendina per il corpo: `undefined` = non si manda, `null` =
 * «Nessuna», numero = id della voce. Un id non intero positivo è un errore:
 * `Number("abc")` diventerebbe `null` nel JSON, cioè una credenziale tolta.
 */
function valoreTendina(valore: string | null, nonModificare: "assente" | "nessuna"): number | null | undefined {
  if (valore === null || valore === "") return nonModificare === "assente" ? undefined : null;
  if (valore === "none") return null;
  const id = Number(valore);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Credenziale non valida: «${valore}» non è l'id di una voce dell'archivio`);
  }
  return id;
}

/**
 * Corpo del PATCH in blocco. «Non modificare» = campo assente, «Nessuna» =
 * `null`. Le credenziali valgono solo per gli apparati: senza apparati
 * selezionati non si mandano (la rotta le applicherebbe solo a `device_ids`).
 */
export function corpoModificaInBlocco(stato: StatoModificaInBlocco): Record<string, unknown> {
  const corpo: Record<string, unknown> = {};
  if (stato.deviceIds.length) corpo.device_ids = stato.deviceIds;
  if (stato.hostIds.length) corpo.host_ids = stato.hostIds;
  if (stato.classification) corpo.classification = stato.classification;
  if (stato.protocol) corpo.protocol = stato.protocol;
  if (stato.vendor) corpo.vendor = stato.vendor;
  if (stato.deviceIds.length) {
    const credenziale = valoreTendina(stato.credentialId, "assente");
    if (credenziale !== undefined) corpo.credential_id = credenziale;
    const snmp = valoreTendina(stato.snmpCredentialId, "assente");
    if (snmp !== undefined) corpo.snmp_credential_id = snmp;
  }
  return corpo;
}

/** Vero se il corpo in blocco ha almeno un campo da applicare. */
export function corpoHaModifiche(corpo: Record<string, unknown>): boolean {
  return CAMPI_DA_APPLICARE.some((campo) => campo in corpo);
}

/** Le tendine come partono per un apparato: dalle sue colonne `credential_id` e `snmp_credential_id`. */
export function tendineDaApparato(device: {
  credential_id?: number | null;
  snmp_credential_id?: number | null;
}): TendineCredenziali {
  return {
    credentialId: device.credential_id != null ? String(device.credential_id) : null,
    snmpCredentialId: device.snmp_credential_id != null ? String(device.snmp_credential_id) : null,
  };
}

/**
 * Corpo del PUT del singolo apparato: i `campi` della finestra, più le due
 * credenziali solo se cambiate rispetto a `statoIniziale`. Tendina vuota e
 * «Nessuna» valgono uguale (nessuna voce). Dalla 2e un `null` toglie i binding
 * di quel protocollo: un campo non toccato non deve partire.
 */
export function corpoModificaApparato(
  statoIniziale: TendineCredenziali,
  stato: StatoModificaApparato,
): Record<string, unknown> {
  const corpo: Record<string, unknown> = { ...stato.campi };
  const credenziale = valoreTendina(stato.credentialId, "nessuna");
  if (credenziale !== valoreTendina(statoIniziale.credentialId, "nessuna")) corpo.credential_id = credenziale;
  const snmp = valoreTendina(stato.snmpCredentialId, "nessuna");
  if (snmp !== valoreTendina(statoIniziale.snmpCredentialId, "nessuna")) corpo.snmp_credential_id = snmp;
  return corpo;
}
