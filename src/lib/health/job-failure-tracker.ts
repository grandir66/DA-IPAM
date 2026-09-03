/**
 * Fallimenti in serie dei job schedulati — rileva un guasto che si ripete.
 *
 * PERCHE' ESISTE: il 2026-09-02, dalle 18:15 alle 22:56, TUTTI i job del tenant
 * 70791 sull'appliance Domarc sono falliti con "Job #N non trovato" — 340
 * esecuzioni consecutive — e **nessun allarme e' scattato**. Il processo
 * rispondeva, il DB era sano, i job erano regolarmente a tabella: a mancare era
 * un controllo che dicesse "stanno fallendo tutti".
 *
 * La causa era la duplicazione del modulo `db-tenant` sotto tsx (import
 * dinamico -> seconda istanza con AsyncLocalStorage vuota): perso il contesto,
 * il facade `getDb()` ripiegava in silenzio sul tenant DEFAULT, che non ha quei
 * job. Da qui le DUE cose che questo modulo copre:
 *
 *   1. `recordOutcome` + `findFailingJobs` — la serie di fallimenti, che e' il
 *      sintomo osservabile di qualunque guasto ripetuto (non solo di questo).
 *   2. `markContextCorruption` — la firma specifica dell'incidente: il contesto
 *      tenant che evapora e' un danno di PROCESSO, non del singolo job. Tutti i
 *      job successivi falliranno e l'unico rimedio e' il riavvio, quindi va
 *      detto esplicitamente invece di lasciarlo dedurre da 340 righe di log.
 *
 * `scheduler-freshness.ts` copre il caso gemello ma diverso: i job che non
 * girano affatto. Questo copre i job che girano e falliscono.
 *
 * Logica PURA e senza I/O: lo stato e' passato dal chiamante e `nowMs` e'
 * iniettato, cosi' e' testabile senza scheduler, senza DB e senza orologio.
 */

/** Quanti fallimenti consecutivi dello stesso job prima di gridare. */
export const ALARM_CONSECUTIVE_FAILURES = 3;

/**
 * Da quanti job in serie dello stesso tenant si deduce un guasto sistemico.
 * Con 2 il rumore sarebbe alto (due integrazioni rotte per conto loro sono
 * plausibili); da 3 in su il denominatore comune e' il processo, non i job.
 */
export const OUTAGE_MIN_JOBS = 3;

/** Non ripetere lo stesso allarme piu' spesso di così (minuti). */
export const ALARM_REPEAT_MINUTES = 60;

/** Storia recente di UN job. `key` e' la chiave dello scheduler: "tenant:jobId". */
export interface JobOutcome {
  consecutiveFailures: number;
  lastError: string | null;
  lastFailureMs: number | null;
  lastSuccessMs: number | null;
  /** Quando e' stato emesso l'ultimo allarme per questo job (anti-spam). */
  lastAlarmMs: number | null;
}

export interface FailureState {
  jobs: Map<string, JobOutcome>;
  /**
   * Contesto tenant corrotto: il processo ha perso l'AsyncLocalStorage e va
   * riavviato. Non si azzera da solo — solo un riavvio lo cancella, ed e'
   * esattamente il messaggio che serve a chi guarda.
   */
  contextCorruption: { atMs: number; tenantCode: string; seen: string | null } | null;
}

export function createFailureState(): FailureState {
  return { jobs: new Map(), contextCorruption: null };
}

function outcomeFor(state: FailureState, key: string): JobOutcome {
  const existing = state.jobs.get(key);
  if (existing) return existing;
  const fresh: JobOutcome = {
    consecutiveFailures: 0,
    lastError: null,
    lastFailureMs: null,
    lastSuccessMs: null,
    lastAlarmMs: null,
  };
  state.jobs.set(key, fresh);
  return fresh;
}

/** Registra l'esito di un'esecuzione. Un successo azzera la serie. */
export function recordOutcome(
  state: FailureState,
  key: string,
  result: { ok: boolean; error?: string | null },
  nowMs: number,
): void {
  const o = outcomeFor(state, key);
  if (result.ok) {
    o.consecutiveFailures = 0;
    o.lastError = null;
    o.lastSuccessMs = nowMs;
    o.lastAlarmMs = null;
    return;
  }
  o.consecutiveFailures += 1;
  o.lastError = result.error ?? null;
  o.lastFailureMs = nowMs;
}

/** Il tenant di una chiave "tenant:jobId". */
export function tenantOfKey(key: string): string {
  const i = key.lastIndexOf(":");
  return i < 0 ? key : key.slice(0, i);
}

export interface FailingJob {
  key: string;
  tenantCode: string;
  consecutiveFailures: number;
  lastError: string | null;
}

/** I job oltre soglia, dal peggiore al migliore. */
export function findFailingJobs(
  state: FailureState,
  opts: { threshold?: number } = {},
): FailingJob[] {
  const threshold = opts.threshold ?? ALARM_CONSECUTIVE_FAILURES;
  const out: FailingJob[] = [];
  for (const [key, o] of state.jobs) {
    if (o.consecutiveFailures >= threshold) {
      out.push({
        key,
        tenantCode: tenantOfKey(key),
        consecutiveFailures: o.consecutiveFailures,
        lastError: o.lastError,
      });
    }
  }
  return out.sort((a, b) => b.consecutiveFailures - a.consecutiveFailures);
}

/**
 * La firma del guasto sistemico: piu' job dello STESSO tenant falliscono in
 * serie. E' il pattern del 2026-09-02, dove a cadere non era un'integrazione
 * ma il processo.
 */
export function findTenantOutages(
  state: FailureState,
  opts: { threshold?: number; minJobs?: number } = {},
): Array<{ tenantCode: string; jobCount: number }> {
  const minJobs = opts.minJobs ?? OUTAGE_MIN_JOBS;
  const perTenant = new Map<string, number>();
  for (const f of findFailingJobs(state, opts)) {
    perTenant.set(f.tenantCode, (perTenant.get(f.tenantCode) ?? 0) + 1);
  }
  return [...perTenant]
    .filter(([, n]) => n >= minJobs)
    .map(([tenantCode, jobCount]) => ({ tenantCode, jobCount }))
    .sort((a, b) => b.jobCount - a.jobCount);
}

/**
 * Segnala che il contesto tenant e' evaporato: `withTenant(X)` era attivo ma il
 * modulo letto dal job vede Y (o niente). Significa istanze duplicate del
 * modulo `db-tenant` -> il processo e' compromesso e va riavviato.
 */
export function markContextCorruption(
  state: FailureState,
  args: { tenantCode: string; seen: string | null },
  nowMs: number,
): void {
  if (state.contextCorruption) return; // il primo e' quello che conta
  state.contextCorruption = { atMs: nowMs, tenantCode: args.tenantCode, seen: args.seen };
}

/**
 * Va emesso ORA un allarme per questo job? Vero al superamento della soglia e
 * poi non piu' di una volta ogni `ALARM_REPEAT_MINUTES`: un job che fallisce
 * ogni 15 minuti non deve generare 96 avvisi al giorno, o il canale diventa
 * rumore e lo si smette di leggere.
 */
export function shouldEmitAlarm(
  state: FailureState,
  key: string,
  nowMs: number,
  opts: { threshold?: number; repeatMinutes?: number } = {},
): boolean {
  const threshold = opts.threshold ?? ALARM_CONSECUTIVE_FAILURES;
  const repeatMs = (opts.repeatMinutes ?? ALARM_REPEAT_MINUTES) * 60_000;
  const o = state.jobs.get(key);
  if (!o || o.consecutiveFailures < threshold) return false;
  if (o.lastAlarmMs !== null && nowMs - o.lastAlarmMs < repeatMs) return false;
  o.lastAlarmMs = nowMs;
  return true;
}

export interface JobFailureHealth {
  ok: boolean;
  /** Job oltre soglia. */
  failingJobs: number;
  /** Serie piu' lunga in corso; null se non fallisce nulla. */
  worstStreak: number | null;
  /** Quanti tenant hanno un guasto sistemico (piu' job in serie). */
  tenantOutages: number;
  /** Contesto tenant perso: il processo va riavviato. */
  contextCorrupted: boolean;
}

/**
 * Vista AGGREGATA per `/api/health`, che e' pubblico (no auth): numeri e
 * booleani, mai nomi di job ne' codici tenant. Il dettaglio sta nel log di
 * processo, che e' gia' un canale autenticato dal fatto di essere sul server.
 */
export function summarizeFailures(state: FailureState): JobFailureHealth {
  const failing = findFailingJobs(state);
  const outages = findTenantOutages(state);
  return {
    ok: failing.length === 0 && state.contextCorruption === null,
    failingJobs: failing.length,
    worstStreak: failing.length ? failing[0].consecutiveFailures : null,
    tenantOutages: outages.length,
    contextCorrupted: state.contextCorruption !== null,
  };
}
