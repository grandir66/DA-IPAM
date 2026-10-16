/**
 * Le colonne vecchie delle credenziali di `network_devices` (tappa 2g
 * credenziali, T26).
 *
 * Dalla 2e le credenziali di un apparato stanno nei binding d'archivio, e
 * dalla 2g nessuno legge più queste colonne. Restano però nello schema
 * (toglierle vorrebbe dire ricostruire la tabella più collegata), vuote dopo
 * la 2e tranne per gli apparati che la 2e ha lasciato, e la pulizia della 2g
 * le svuota. Una `SELECT *` le porta ancora: chi manda una riga alla pagina
 * le toglie con `senzaColonneVecchie`, così un segreto rimasto (cifrato)
 * non esce. Prima le rotte le mandavano mascherate («●●●●●●●●»).
 *
 * Modulo puro, senza DB: lo usano le rotte.
 */

export const COLONNE_CREDENZIALI_VECCHIE = [
  "credential_id",
  "snmp_credential_id",
  "username",
  "encrypted_password",
  "community_string",
  "api_token",
] as const;

/** Una copia della riga senza le colonne vecchie delle credenziali. */
export function senzaColonneVecchie<T extends object>(riga: T): T {
  const copia: Record<string, unknown> = { ...(riga as Record<string, unknown>) };
  for (const c of COLONNE_CREDENZIALI_VECCHIE) delete copia[c];
  return copia as T;
}
