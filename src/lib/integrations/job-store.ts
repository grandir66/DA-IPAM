import type { InstallJob } from "./types";

/**
 * Job d'installazione in memoria del processo (un riavvio li perde: il polling
 * lo dice come «esito sconosciuto», vedi `polling-job.ts`).
 *
 * Passo 2 del piano di solidità (2026-10-16): il log cresceva senza limite e i
 * job finiti restavano nella mappa fino al riavvio. Ora si tengono le ultime
 * `MAX_RIGHE_LOG` righe e i job finiti da più di `CONSERVA_FINITI_MS` spariscono
 * alla prima creazione o lettura dell'elenco.
 */
export const MAX_RIGHE_LOG = 500;
export const CONSERVA_FINITI_MS = 60 * 60 * 1000;

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

const SEGNO_OMESSE = /^… (\d+) righe precedenti omesse …$/;

/**
 * Tiene le ultime righe: la prima diventa «… N righe precedenti omesse …», col
 * conto che si somma a ogni taglio. Esportata per le prove.
 */
export function tagliaLog(log: string[]): string[] {
  if (log.length <= MAX_RIGHE_LOG) return log;
  let giaOmesse = 0;
  let righe = log;
  const segno = SEGNO_OMESSE.exec(log[0] ?? "");
  if (segno) {
    giaOmesse = Number(segno[1]);
    righe = log.slice(1);
  }
  const tolte = righe.length - (MAX_RIGHE_LOG - 1);
  return [`… ${giaOmesse + tolte} righe precedenti omesse …`, ...righe.slice(tolte)];
}

/**
 * Toglie i job finiti (`done`/`error`) da più di `CONSERVA_FINITI_MS`.
 * Un job senza `finishedAt` o ancora in corso resta. Torna quanti ne ha tolti.
 */
export function pulisciJobFiniti(adesso: number = Date.now()): number {
  const store = getStore();
  let tolti = 0;
  for (const [id, job] of store) {
    if (job.phase !== "done" && job.phase !== "error") continue;
    if (!job.finishedAt) continue;
    const fine = Date.parse(job.finishedAt);
    if (Number.isNaN(fine)) continue;
    if (adesso - fine > CONSERVA_FINITI_MS) {
      store.delete(id);
      tolti++;
    }
  }
  return tolti;
}

export function createJob(job: InstallJob): void {
  pulisciJobFiniti();
  getStore().set(job.id, { ...job, log: tagliaLog(job.log) });
}

export function getJob(id: string): InstallJob | undefined {
  return getStore().get(id);
}

export function updateJob(id: string, patch: Partial<InstallJob>): void {
  const store = getStore();
  const job = store.get(id);
  if (job) {
    const next = { ...job, ...patch };
    if (patch.log) next.log = tagliaLog(patch.log);
    store.set(id, next);
  }
}

export function appendLog(id: string, line: string): void {
  const store = getStore();
  const job = store.get(id);
  if (job) {
    store.set(id, { ...job, log: tagliaLog([...job.log, line]) });
  }
}

export function listJobs(): InstallJob[] {
  pulisciJobFiniti();
  return Array.from(getStore().values());
}

export function deleteJob(id: string): void {
  getStore().delete(id);
}
