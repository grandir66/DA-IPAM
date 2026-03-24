import cron from "node-cron";
import { getEnabledJobs, updateJobLastRun } from "@/lib/db";
import { getActiveTenants } from "@/lib/db-hub";
import { withTenant } from "@/lib/db-tenant";
import { runJob } from "./jobs";

type ScheduledTask = ReturnType<typeof cron.schedule>;
const activeTasks = new Map<string, ScheduledTask>();

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
  if (minutes < 60) {
    return `*/${minutes} * * * *`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `0 */${hours} * * *`;
  }
  return `0 0 * * *`;
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
    console.info(`[Scheduler] Esecuzione job ${key} (tenant: ${tenantCode})`);
    try {
      await withTenant(tenantCode, async () => {
        await runJob(jobId);
        updateJobLastRun(jobId);
      });
      console.info(`[Scheduler] Job ${key} completato`);
    } catch (error) {
      console.error(`[Scheduler] Job ${key} fallito:`, error);
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
