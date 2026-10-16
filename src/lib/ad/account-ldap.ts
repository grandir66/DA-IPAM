/**
 * L'account LDAP di un'integrazione Active Directory nel modulo e nella
 * richiesta (tappa 2f credenziali, T24): regole pure, le stesse per la pagina
 * e per il server. Niente DB e niente cifratura: lo importa anche la pagina.
 *
 * Dalla 2f l'account è una voce dell'archivio di tipo «Active Directory»
 * (`credential_id`): scelta nella tendina, oppure scritta nel modulo
 * («Nuova nell'archivio», e il wizard di avvio), e allora il server la crea
 * come «AD · <nome>» nella stessa transazione dell'integrazione.
 */

/** La voce scelta, oppure un account nuovo che diventa una voce. */
export type AccountLdap = { credential_id: number } | { nuovo: { username: string; password: string } };

/**
 * Con che cosa entra la riga, senza decifrare niente: la sua voce o niente
 * («Credenziale mancante»). Dalla 2g (T26) le colonne della riga non valgono più.
 */
export type StatoAccountLdap = "voce" | "mancante";

/** Nome della voce che nasce da un account nuovo; se c'è già, il server aggiunge « (AD #id)». */
export function nomeVoceAd(nomeIntegrazione: string): string {
  return `AD · ${nomeIntegrazione.trim()}`;
}

/**
 * Stesso Domain Controller: l'indirizzo senza spazi attorno e senza badare
 * alle maiuscole (un nome DNS non le distingue). Con D12 = (a) un DC diverso
 * scollega la voce.
 */
export function stessoDc(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export type EsitoAccountDalCorpo = { ok: true; account: AccountLdap | null } | { ok: false; errore: string };

/**
 * L'account dal corpo di POST/PUT `/api/ad`: `credential_id` oppure
 * `username` e `password` (un account nuovo), mai tutti e due. Senza niente:
 * in creazione è un errore (`obbligatorio`), in modifica vuol dire «resta
 * quello di adesso» (null). Un account nuovo vuole utente e password: la
 * voce non si crea a metà.
 */
export function accountDalCorpo(
  corpo: { credential_id?: number | null; username?: string; password?: string },
  obbligatorio: boolean,
): EsitoAccountDalCorpo {
  const username = corpo.username ?? "";
  const password = corpo.password ?? "";
  const scritto = username.trim() !== "" || password !== "";
  if (corpo.credential_id != null) {
    if (scritto) return { ok: false, errore: "Scegli l'account LDAP dall'archivio oppure scrivine uno nuovo, non tutti e due" };
    return { ok: true, account: { credential_id: corpo.credential_id } };
  }
  if (scritto) {
    if (username.trim() === "" || password === "") return { ok: false, errore: "Per un account LDAP nuovo servono utente e password" };
    return { ok: true, account: { nuovo: { username, password } } };
  }
  if (obbligatorio) return { ok: false, errore: "Scegli l'account LDAP dall'archivio oppure scrivine uno nuovo" };
  return { ok: true, account: null };
}
