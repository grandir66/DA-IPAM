import cron from "node-cron";
import { getEnabledJobs, updateJobLastRun } from "@/lib/db";
import { runJob } from "./jobs";

type ScheduledTask = ReturnType<typeof cron.schedule>;
const activeTasks = new Map<number, ScheduledTask>();

export function initializeScheduler(): void {
  console.log("[Scheduler] Inizializzazione scheduler...");

  const jobs = getEnabledJobs();
  for (const job of jobs) {
    scheduleJob(job.id, job.interval_minutes);
  }

  console.log(`[Scheduler] ${jobs.length} job attivi caricati`);
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

export function scheduleJob(jobId: number, intervalMinutes: number): void {
  // Stop existing task if any
  stopJob(jobId);

  const cronExpr = intervalToCron(intervalMinutes);

  const task = cron.schedule(cronExpr, async () => {
    console.log(`[Scheduler] Esecuzione job #${jobId}`);
    try {
      await runJob(jobId);
      updateJobLastRun(jobId);
      console.log(`[Scheduler] Job #${jobId} completato`);
    } catch (error) {
      console.error(`[Scheduler] Job #${jobId} fallito:`, error);
    }
  });

  activeTasks.set(jobId, task);
}

export function stopJob(jobId: number): void {
  const existing = activeTasks.get(jobId);
  if (existing) {
    existing.stop();
    activeTasks.delete(jobId);
  }
}

export function reloadScheduler(): void {
  // Stop all
  for (const [id, task] of activeTasks) {
    task.stop();
    activeTasks.delete(id);
  }
  // Reload
  initializeScheduler();
}
