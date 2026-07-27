// src/lib/attribution/retry.ts
// Helper generico per retry con backoff su errori di lock SQLite (SQLITE_BUSY*,
// "database is locked"). Usato dalla CLI di recompute (scripts/attribution-recompute-cli.ts)
// per non interrompere l'intero batch quando gira in parallelo a un writer
// (es. servizio di scan sullo stesso tenant DB). Nessuna dipendenza da better-sqlite3
// qui: opera su una funzione qualsiasi che può lanciare un errore "di lock".

/** Attese di default tra un tentativo e il successivo (ms), in ordine. */
const DEFAULT_DELAYS_MS = [500, 1500, 4000];

export interface RetryOptions {
  /** Attese (ms) tra i tentativi. Il numero di retry = delaysMs.length. Default [500, 1500, 4000]. */
  delaysMs?: number[];
  /** Predicato che decide se l'errore va ritentato. Default: isLockError. */
  isRetryable?: (err: unknown) => boolean;
  /** Iniettabile per i test: default un vero setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
}

/** true se il messaggio dell'errore indica un lock SQLite (case-insensitive). */
export function isLockError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /locked|busy/i.test(err.message);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Esegue `fn`; se lancia un errore "ritentabile" (default: lock SQLite), riprova
 * con le attese di `delaysMs` (default 500/1500/4000ms → fino a 3 retry, 4
 * tentativi totali). Se anche l'ultimo tentativo fallisce, rilancia l'errore
 * originale (il chiamante decide cosa fare: es. contare l'host come "saltato"
 * e proseguire con gli altri, invece di interrompere l'intero batch).
 * Un errore non ritentabile viene rilanciato subito, senza attese.
 */
export async function withLockRetry<T>(fn: () => T, opts: RetryOptions = {}): Promise<T> {
  const delays = opts.delaysMs ?? DEFAULT_DELAYS_MS;
  const isRetryable = opts.isRetryable ?? isLockError;
  const sleep = opts.sleep ?? defaultSleep;

  for (let attempt = 0; ; attempt++) {
    try {
      return fn();
    } catch (err) {
      const isLastAttempt = attempt >= delays.length;
      if (!isRetryable(err) || isLastAttempt) throw err;
      await sleep(delays[attempt]);
    }
  }
}
