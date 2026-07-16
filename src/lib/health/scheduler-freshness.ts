/**
 * Freshness dei job schedulati — rileva uno scheduler fermo.
 *
 * PERCHE' ESISTE: il 2026-07-05 l'appliance PX-NAS si e' congelata (stallo I/O
 * dell'hypervisor) e nessuno se n'e' accorto per **11 giorni**: zero scan, zero
 * sync. `/api/health` guardava solo DB + chiave di cifratura, quindi appena il
 * processo tornava a rispondere diceva "ok" pur con lo scheduler fermo da giorni.
 * Un check sulla freschezza di `scheduled_jobs.last_run` lo avrebbe rilevato lo
 * stesso giorno.
 *
 * Logica PURA e senza I/O: le righe arrivano dal chiamante, `nowMs` e' iniettato.
 * Cosi' e' testabile senza DB ne' orologio.
 */

/** Riga minima di `scheduled_jobs` necessaria al calcolo. */
export interface SchedulerJobRow {
  job_type: string;
  interval_minutes: number;
  last_run: string | null;
  created_at: string | null;
  enabled: number;
}

export interface StaleJob {
  jobType: string;
  intervalMinutes: number;
  /** Da quanti minuti il job avrebbe dovuto girare (elapsed - interval). */
  overdueMinutes: number;
  /** null se il job non e' MAI girato (allora si usa created_at come riferimento). */
  lastRun: string | null;
  neverRan: boolean;
}

/**
 * Tolleranza prima di gridare "fermo": `interval * MULT + GRACE` minuti.
 * Volutamente generosa — un job puo' saltare un giro per carico o per un
 * riavvio senza che sia un incidente. Con i default un job da 15 min viene
 * segnalato dopo ~1h, uno da 120 min dopo ~6h: l'incidente da 11 giorni sarebbe
 * emerso in meno di un'ora, che e' l'obiettivo.
 */
export const STALE_INTERVAL_MULTIPLIER = 3;
export const STALE_GRACE_MINUTES = 15;

/**
 * Parsing dei timestamp SQLite. `datetime('now')` produce
 * `YYYY-MM-DD HH:MM:SS` in **UTC senza timezone**: passarlo a `new Date()` cosi'
 * com'e' lo fa interpretare come ora LOCALE, sfasando il calcolo di ore intere
 * (in Italia d'estate 2h: bastano a mascherare o inventare uno stallo).
 * Qui normalizziamo esplicitamente a UTC. Alcune colonne usano invece ISO con
 * `Z`/offset: in quel caso il timestamp e' gia' esplicito e va lasciato stare.
 * Vedi memoria: SQLite datetime footgun.
 */
export function parseSqlUtc(value: string | null): number | null {
  if (!value) return null;
  const s = value.trim();
  if (!s) return null;
  const hasZone = /[zZ]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s);
  const iso = hasZone ? s.replace(" ", "T") : `${s.replace(" ", "T")}Z`;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Ritorna i job abilitati che non girano da troppo tempo.
 *
 * - `enabled = 0` → ignorato (e' spento di proposito, non fermo).
 * - mai girato → si usa `created_at` come riferimento, cosi' uno scheduler che
 *   non ha MAI funzionato non resta invisibile. Un job appena creato non e'
 *   stale: rientra nella tolleranza.
 * - senza alcun riferimento temporale → ignorato (non giudicabile).
 */
export function findStaleJobs(
  rows: SchedulerJobRow[],
  nowMs: number,
  opts: { multiplier?: number; graceMinutes?: number } = {},
): StaleJob[] {
  const mult = opts.multiplier ?? STALE_INTERVAL_MULTIPLIER;
  const grace = opts.graceMinutes ?? STALE_GRACE_MINUTES;
  const out: StaleJob[] = [];

  for (const row of rows) {
    if (!row.enabled) continue;
    const interval = Number(row.interval_minutes);
    if (!Number.isFinite(interval) || interval <= 0) continue;

    const neverRan = !row.last_run;
    const refMs = parseSqlUtc(row.last_run) ?? parseSqlUtc(row.created_at);
    if (refMs == null) continue;

    const elapsedMin = (nowMs - refMs) / 60_000;
    if (elapsedMin <= interval * mult + grace) continue;

    out.push({
      jobType: row.job_type,
      intervalMinutes: interval,
      overdueMinutes: Math.round(elapsedMin - interval),
      lastRun: row.last_run,
      neverRan,
    });
  }

  // Il piu' in ritardo per primo: e' quello che racconta la gravita'.
  return out.sort((a, b) => b.overdueMinutes - a.overdueMinutes);
}

/** Riassunto aggregato, sicuro da esporre su un endpoint pubblico. */
export interface SchedulerFreshness {
  ok: boolean;
  staleCount: number;
  /** Minuti di ritardo del job messo peggio; null se va tutto bene. */
  worstOverdueMinutes: number | null;
}

/**
 * Vista AGGREGATA per `/api/health`, che e' pubblico (no auth).
 * Volutamente NON espone job_type ne' codici tenant: a un chiamante anonimo
 * basta sapere che qualcosa e' fermo e da quanto. Il dettaglio sta su
 * `/api/modules/health`, che richiede autenticazione.
 */
export function summarizeFreshness(stale: StaleJob[]): SchedulerFreshness {
  return {
    ok: stale.length === 0,
    staleCount: stale.length,
    worstOverdueMinutes: stale.length ? stale[0].overdueMinutes : null,
  };
}
