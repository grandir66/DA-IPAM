import type { InstallJob } from "./types";

declare global {
  // eslint-disable-next-line no-var
  var __daipam_integration_jobs__: Map<string, InstallJob> | undefined;
}

function getStore(): Map<string, InstallJob> {
  if (!globalThis.__daipam_integration_jobs__) {
    globalThis.__daipam_integration_jobs__ = new Map();
  }
  return globalThis.__daipam_integration_jobs__;
}

export function createJob(job: InstallJob): void {
  getStore().set(job.id, job);
}

export function getJob(id: string): InstallJob | undefined {
  return getStore().get(id);
}

export function updateJob(id: string, patch: Partial<InstallJob>): void {
  const store = getStore();
  const job = store.get(id);
  if (job) {
    store.set(id, { ...job, ...patch });
  }
}

export function appendLog(id: string, line: string): void {
  const store = getStore();
  const job = store.get(id);
  if (job) {
    store.set(id, { ...job, log: [...job.log, line] });
  }
}

export function listJobs(): InstallJob[] {
  return Array.from(getStore().values());
}

export function deleteJob(id: string): void {
  getStore().delete(id);
}
