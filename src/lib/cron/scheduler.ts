import cron from "node-cron";
import { currentFacadeTenant, getEnabledJobs, updateJobLastRun } from "@/lib/db";
import { getActiveTenants } from "@/lib/db-hub";
import { withTenant } from "@/lib/db-tenant";
import { runJob } from "./jobs";
import {
  createFailureState,
  findTenantOutages,
  markContextCorruption,
  recordOutcome,
  shouldEmitAlarm,
  summarizeFailures,
} from "@/lib/health/job-failure-tracker";

type ScheduledTask = ReturnType<typeof cron.schedule>;
const activeTasks = new Map<string, ScheduledTask>();
/** Guard: job keys currently running (prevents overlapping execution) */
const runningJobs = new Set<string>();
/**
 * Serie di fallimenti per chiave job. Vive SOLO in questo processo (quello che
 * regge node-cron): non va esposto alle route Next, che sotto build girano in un
 * bundle separato e ne vedrebbero una copia sempre vuota. La superficie di
 * allarme verso l'esterno resta `/api/health?strict=1`, che legge da DB.
 */
const failureState = createFailureState();

/**
 * Guardia del contesto tenant, da eseguire DENTRO withTenant e PRIMA del job.
 *
 * PERCHE' ESISTE: il 2026-09-02 il processo ha perso l'AsyncLocalStorage di
 * `db-tenant` (istanza duplicata del modulo sotto tsx). Senza contesto il facade
 * `getDb()` ripiega in silenzio sul tenant DEFAULT, e questo ha prodotto DUE
 * danni: 340 job falliti con un messaggio fuorviante ("Job #N non trovato",
 * perche' quei job non esistono nel DB di DEFAULT) e — piu' grave — 179 host del
 * tenant 70791 scritti dentro DEFAULT.db dai fast_scan gia' in corso.
 *
 * Qui il confronto e' possibile perche' lo scheduler SA quale tenant ha aperto:
 * se il modulo legge qualcosa di diverso, si ferma prima di toccare il DB.
 */
function assertTenantContext(key: string, tenantCode: string): void {
  // Si interroga il FACADE, non l'import statico qui sopra. Cruciale: withTenant
  // ha aperto il contesto sull'istanza importata staticamente, che quindi vede
  // sempre il codice giusto — chiedere a lei darebbe un "tutto bene" falso. La
  // scrittura passa da getDb(), ed e' la SUA risoluzione che va verificata.
  const seen = currentFacadeTenant();
  if (seen === tenantCode) return;

  markContextCorruption(failureState, { tenantCode, seen }, Date.now());
  console.error(
    `[Scheduler] CONTESTO TENANT CORROTTO su ${key}: withTenant("${tenantCode}") ` +
      `e' attivo ma il facade getDb() risolve su ${seen === null ? "nessun contesto (-> tenant DEFAULT)" : `"${seen}"`}. ` +
      "Causa tipica: due istanze del modulo db-tenant nello stesso processo " +
      "(import dinamico di db-tenant sotto tsx). Il job NON viene eseguito, per non " +
      "scrivere sul database del tenant sbagliato. Ogni job successivo fallira' " +
      "allo stesso modo: IL PROCESSO VA RIAVVIATO (systemctl restart da-invent).",
  );
  throw new Error(
    `Contesto tenant corrotto: atteso "${tenantCode}", letto ${seen ?? "null"} — processo da riavviare`,
  );
}

/**
 * Escalation sui fallimenti in serie. Un singolo errore e' gia' nel log; qui si
 * alza la voce quando il guasto si ripete, e si distingue il caso sistemico
 * (piu' job dello stesso tenant) da un'integrazione rotta per conto sua.
 *
 * PERCHE' ESISTE: cinque ore di fallimento totale senza un solo allarme. Il log
 * conteneva 340 righe identiche e nessuna che dicesse "stanno fallendo tutti".
 */
function escalateIfSerial(key: string, tenantCode: string): void {
  const now = Date.now();
  if (!shouldEmitAlarm(failureState, key, now)) return;

  const health = summarizeFailures(failureState);
  console.error(
    `[Scheduler] ALLARME: il job ${key} e' fallito ${health.worstStreak ?? "?"} volte di fila. ` +
      `Job in fallimento seriale nel processo: ${health.failingJobs}.`,
  );

  const outage = findTenantOutages(failureState).find((o) => o.tenantCode === tenantCode);
  if (outage) {
    console.error(
      `[Scheduler] ALLARME SISTEMICO: ${outage.jobCount} job del tenant ${tenantCode} ` +
        "falliscono in serie. Un guasto comune a piu' job non e' un'integrazione rotta: " +
        "cercare 'CONTESTO TENANT CORROTTO' nel log e verificare /api/health?strict=1.",
    );
  }
}

export function initializeScheduler(): void {
  console.info("[Scheduler] Inizializzazione scheduler multi-tenant...");

  let totalJobs = 0;
  const tenants = getActiveTenants();

  for (const tenant of tenants) {
    withTenant(tenant.codice_cliente, () => {
      const jobs = getEnabledJobs();
      for (const job of jobs) {
        const key = `${tenant.codice_cliente}:${job.id}`;
        scheduleJob(key, job.id, job.interval_minutes, tenant.codice_cliente);
        totalJobs++;
      }
      if (jobs.length > 0) {
        console.info(`[Scheduler] Tenant ${tenant.codice_cliente}: ${jobs.length} job caricati`);
      }
    });
  }

  console.info(`[Scheduler] ${totalJobs} job attivi caricati da ${tenants.length} tenant`);
}

function intervalToCron(minutes: number): string {
  // Fix B1 2026-06-23: la vecchia versione collassava ogni intervallo ≥1440min
  // (3 giorni, settimana) in "0 0 * * *" = GIORNALIERO → VA scan 7× troppo
  // frequenti; e `*/N` per N che non divide il campo dava cadenza irregolare.
  // Mappiamo onestamente su minuti/ore/giorni divisori; per il resto, fallback
  // alla granularità più vicina che NON sovra-esegua (arrotonda PER ECCESSO).
  if (minutes < 60) {
    const m = [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30].find((d) => d >= minutes) ?? 30;
    return `*/${m} * * * *`;
  }
  if (minutes < 1440) {
    const hours = Math.round(minutes / 60);
    const h = [1, 2, 3, 4, 6, 8, 12].find((d) => d >= hours) ?? 12;
    return `0 */${h} * * *`;
  }
  // ≥ 1 giorno: esegui ogni N giorni (N≥1). cron `*/d` sul campo day-of-month
  // approssima "ogni d giorni" (reset a inizio mese, ma niente più 7× al giorno).
  const days = Math.max(1, Math.round(minutes / 1440));
  if (days === 1) return `0 3 * * *`;       // giornaliero alle 03:00
  if (days >= 7) return `0 3 * * 1`;        // settimanale: lunedì 03:00
  return `0 3 */${days} * *`;               // ogni N giorni alle 03:00
}

export function scheduleJob(
  key: string,
  jobId: number,
  intervalMinutes: number,
  tenantCode: string,
): void {
  // Stop existing task if any
  stopJob(key);

  const cronExpr = intervalToCron(intervalMinutes);

  const task = cron.schedule(cronExpr, async () => {
    if (runningJobs.has(key)) {
      console.warn(`[Scheduler] Job ${key} già in esecuzione, skip`);
      return;
    }
    runningJobs.add(key);
    console.info(`[Scheduler] Esecuzione job ${key} (tenant: ${tenantCode})`);
    try {
      await withTenant(tenantCode, async () => {
        assertTenantContext(key, tenantCode);
        await runJob(jobId);
        updateJobLastRun(jobId);
      });
      recordOutcome(failureState, key, { ok: true }, Date.now());
      console.info(`[Scheduler] Job ${key} completato`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordOutcome(failureState, key, { ok: false, error: message }, Date.now());
      console.error(`[Scheduler] Job ${key} fallito:`, error);
      escalateIfSerial(key, tenantCode);
    } finally {
      runningJobs.delete(key);
    }
  });

  activeTasks.set(key, task);
}

export function stopJob(key: string): void {
  const existing = activeTasks.get(key);
  if (existing) {
    existing.stop();
    activeTasks.delete(key);
  }
}

/**
 * Stop and remove all jobs for a specific tenant.
 */
export function stopTenantJobs(tenantCode: string): void {
  for (const [key, task] of activeTasks) {
    if (key.startsWith(`${tenantCode}:`)) {
      task.stop();
      activeTasks.delete(key);
    }
  }
}

/**
 * Reload jobs for a single tenant (e.g. after job config change).
 */
export function reloadTenantScheduler(tenantCode: string): void {
  stopTenantJobs(tenantCode);
  withTenant(tenantCode, () => {
    const jobs = getEnabledJobs();
    for (const job of jobs) {
      const key = `${tenantCode}:${job.id}`;
      scheduleJob(key, job.id, job.interval_minutes, tenantCode);
    }
    console.info(`[Scheduler] Tenant ${tenantCode}: ${jobs.length} job ricaricati`);
  });
}

export function reloadScheduler(): void {
  // Stop all
  for (const [, task] of activeTasks) {
    task.stop();
  }
  activeTasks.clear();
  // Reload
  initializeScheduler();
}
