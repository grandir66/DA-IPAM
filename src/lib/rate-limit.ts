/**
 * Rate limiter in-memory con sliding window.
 * Usato per protezione brute force login e limite scan concorrenti.
 */

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

// Pulizia periodica ogni 5 minuti
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => now - t < 15 * 60 * 1000);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}, 5 * 60 * 1000);

/**
 * Controlla se un'azione è rate-limited.
 * @param key Identificativo unico (es. IP address, "scan:networkId")
 * @param maxAttempts Numero massimo di tentativi nella finestra
 * @param windowMs Durata finestra in millisecondi (default 15 min)
 * @returns true se l'azione è consentita, false se rate-limited
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
