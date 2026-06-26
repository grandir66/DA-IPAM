import cron from "node-cron";
import { getEnabledJobs, updateJobLastRun } from "@/lib/db";
import { getActiveTenants } from "@/lib/db-hub";
import { withTenant } from "@/lib/db-tenant";
import { runJob } from "./jobs";

type ScheduledTask = ReturnType<typeof cron.schedule>;
const activeTasks = new Map<string, ScheduledTask>();
/** Guard: job keys currently running (prevents overlapping execution) */
const runningJobs = new Set<string>();

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
        await runJob(jobId);
        updateJobLastRun(jobId);
      });
      console.info(`[Scheduler] Job ${key} completato`);
    } catch (error) {
      console.error(`[Scheduler] Job ${key} fallito:`, error);
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
