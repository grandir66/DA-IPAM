/**
 * Rate limiter in-memory con sliding window.
 * Usato per protezione brute force login e limite scan concorrenti.
 */

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

// Pulizia periodica ogni 5 minuti.
// .unref(): senza, questo timer tiene vivo l'event loop e qualunque processo che
// importi il modulo non termina piu' — motivo per cui questo file non aveva test
// (il runner restava appeso all'infinito). Sul server non cambia nulla: il
// processo e' comunque long-running.
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => now - t < 15 * 60 * 1000);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}, 5 * 60 * 1000);
cleanupTimer.unref?.();

/**
 * Controlla se un'azione è rate-limited.
 * @param key Identificativo unico (es. IP address, "scan:networkId")
 * @param maxAttempts Numero massimo di tentativi nella finestra
 * @param windowMs Durata finestra in millisecondi (default 15 min)
 * @returns true se l'azione è consentita, false se rate-limited
 */
/**
 * Verifica SENZA consumare un tentativo: risponde solo "sei gia' oltre la soglia?".
 *
 * Serve per il login, dove il contatore deve riempirsi con i FALLIMENTI e non con
 * gli accessi riusciti. Usare `checkRateLimit` per quello e' un errore sottile e
 * costoso: quella funzione registra un timestamp a OGNI chiamata, quindi bastano
 * 5 login (anche tutti CORRETTI) in 15 minuti per bloccare l'utente — e siccome
 * `auth.ts` non distingue il blocco dalla password errata, l'utente legge
 * "credenziali errate", si convince di aver dimenticato la password e riprova,
 * peggiorando la situazione. Successo il 2026-07-17 su 99.50 (incidente reale).
 */
export function isRateLimited(
  key: string,
  maxAttempts: number,
  windowMs: number = 15 * 60 * 1000,
): boolean {
  const entry = store.get(key);
  if (!entry) return false;
  const now = Date.now();
  const recent = entry.timestamps.filter((t) => now - t < windowMs);
  return recent.length >= maxAttempts;
}

/**
 * Azzera il contatore. Da chiamare dopo un'autenticazione RIUSCITA: senza,
 * 4 fallimenti + 1 successo + 1 fallimento bloccherebbero comunque l'utente, e
 * chi indovina la password al 5° tentativo resterebbe fuori lo stesso.
 */
export function clearRateLimit(key: string): void {
  store.delete(key);
}

/**
 * ATTENZIONE: consuma un tentativo a ogni chiamata (registra il timestamp anche
 * se l'azione poi riesce). Va bene per limitare azioni costose (es. scan
 * concorrenti), NON per il login: li' serve `isRateLimited` + `recordFailedAttempt`.
 */
export function checkRateLimit(key: string, maxAttempts: number, windowMs: number = 15 * 60 * 1000): boolean {
  const now = Date.now();
  const entry = store.get(key) || { timestamps: [] };

  // Rimuovi timestamp fuori finestra
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

  if (entry.timestamps.length >= maxAttempts) {
    return false; // Rate limited
  }

  entry.timestamps.push(now);
  store.set(key, entry);
  return true;
}

/**
 * Registra un tentativo fallito senza consumare un "pass".
 * Usato per login falliti: il tentativo deve essere registrato anche se non consumato.
 */
export function recordFailedAttempt(key: string): void {
  const entry = store.get(key) || { timestamps: [] };
  entry.timestamps.push(Date.now());
  store.set(key, entry);
}

/**
 * Conta tentativi attivi nella finestra per una chiave.
 */
export function getAttemptCount(key: string, windowMs: number = 15 * 60 * 1000): number {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry) return 0;
  return entry.timestamps.filter((t) => now - t < windowMs).length;
}
