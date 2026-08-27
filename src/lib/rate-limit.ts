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

/**
 * Backoff INCREMENTALE per il login.
 *
 * I primi `LOGIN_FREE_ATTEMPTS` fallimenti non bloccano. Dal successivo scatta un
 * cooldown che RADDOPPIA a ogni ulteriore fallimento (30s → 1m → 2m → 4m → …,
 * fino a `LOGIN_MAX_COOLDOWN_MS`), calcolato dall'ULTIMO fallimento. Dopo
 * `LOGIN_WINDOW_MS` senza fallimenti la storia si dimentica.
 *
 * Da usare in `auth.ts` PRIMA di verificare la password: se `locked`, tornare
 * senza controllare le credenziali e **senza** `recordFailedAttempt` — i tentativi
 * durante il cooldown non devono aggravare il blocco. `retryAfterSec` è il tempo
 * residuo, da mostrare all'utente: così sa di dover aspettare invece di credere di
 * aver perso la password (incidenti 99.50 del 2026-07-17 e appliance DTS del
 * 2026-08-02, entrambi da blocco "muto" indistinguibile da "credenziali errate").
 */
export const LOGIN_FREE_ATTEMPTS = 4; // il 5° fallimento è il primo blocco
export const LOGIN_BASE_COOLDOWN_MS = 30 * 1000; // 30s al primo blocco
export const LOGIN_MAX_COOLDOWN_MS = 15 * 60 * 1000; // tetto: 15 min
export const LOGIN_WINDOW_MS = 30 * 60 * 1000; // oltre, i fallimenti decadono

export function loginLockState(
  key: string,
  now: number = Date.now(),
): { locked: boolean; retryAfterSec: number; fails: number } {
  const entry = store.get(key);
  if (!entry) return { locked: false, retryAfterSec: 0, fails: 0 };
  const recent = entry.timestamps.filter((t) => now - t < LOGIN_WINDOW_MS);
  const fails = recent.length;
  if (fails <= LOGIN_FREE_ATTEMPTS) return { locked: false, retryAfterSec: 0, fails };
  const over = fails - LOGIN_FREE_ATTEMPTS; // ≥ 1
  const cooldown = Math.min(
    LOGIN_BASE_COOLDOWN_MS * 2 ** (over - 1),
    LOGIN_MAX_COOLDOWN_MS,
  );
  const lastFail = recent[recent.length - 1];
  const retryAfterSec = Math.max(0, Math.ceil((lastFail + cooldown - now) / 1000));
  return { locked: retryAfterSec > 0, retryAfterSec, fails };
}
