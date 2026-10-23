/**
 * La guardia della passphrase del cliente (revisione del 23/10, rilievo 5). La passphrase si prova da due rotte, lo
 * sblocco (`/api/vault/sblocca`) e l'esportazione KeePass (`/api/vault/keepass`), e ogni prova è una derivazione scrypt
 * (decine di MiB e circa un secondo di CPU): senza un freno, un utente collegato ci fa indovinare e saturare il
 * processo.
 *
 * - **Per utente**: 5 tentativi sbagliati in 15 minuti, UN contatore per utente condiviso fra le due rotte (prima lo
 *   sblocco ne aveva uno globale, che permetteva a un admin di bloccare tutti, e il KeePass nessuno).
 * - **Prenotato prima**: il tentativo conta subito, non a derivazione finita (`prenotaTentativo`, come il login dopo la
 *   revisione del 20/10): cento richieste in parallelo non passano tutte il controllo prima del primo fallimento.
 *   Giusta = si azzera; sbagliata = resta contato; un errore che non dipende dalla passphrase (archivio assente) =
 *   non conta.
 * - **Tetto alle derivazioni in corso**: `MAX_VERIFICHE_CONCORRENTI`; le altre non si accodano, ricevono 429.
 */
import { annullaTentativo, clearRateLimit, isRateLimited, prenotaTentativo } from "@/lib/rate-limit";
import { ErroreVault } from "./tipi";

export const TENTATIVI_PASSPHRASE = 5;
export const FINESTRA_TENTATIVI_MS = 15 * 60_000;
export const MAX_VERIFICHE_CONCORRENTI = 2;

export type EsitoGuardia<T> = { ok: true; valore: T } | { ok: false; stato: 429; errore: string };

let inCorso = 0;

/** La chiave del contatore dell'utente (id in hub.users; "0" = utenza di servizio). */
export function chiaveTentativi(utenteId: string): string {
  return `vault-passphrase:${utenteId}`;
}

/**
 * Esegue `apri` (la derivazione della passphrase) dentro la guardia. `apri` lancia `ErroreVault("slot_errato")` se la
 * passphrase è sbagliata: l'errore si rilancia com'è (il chiamante sa cosa rispondere), ma il tentativo resta contato.
 */
export async function conGuardiaPassphrase<T>(utenteId: string, apri: () => Promise<T>): Promise<EsitoGuardia<T>> {
  const chiave = chiaveTentativi(utenteId);
  if (isRateLimited(chiave, TENTATIVI_PASSPHRASE, FINESTRA_TENTATIVI_MS)) {
    return { ok: false, stato: 429, errore: "Troppi tentativi sbagliati: riprova fra qualche minuto" };
  }
  if (inCorso >= MAX_VERIFICHE_CONCORRENTI) {
    return { ok: false, stato: 429, errore: "Troppe verifiche della passphrase in corso: riprova fra qualche secondo" };
  }
  inCorso += 1;
  const segno = prenotaTentativo(chiave);
  try {
    const valore = await apri();
    clearRateLimit(chiave);
    return { ok: true, valore };
  } catch (e) {
    if (!(e instanceof ErroreVault && e.codice === "slot_errato")) annullaTentativo(chiave, segno);
    throw e;
  } finally {
    inCorso -= 1;
  }
}
