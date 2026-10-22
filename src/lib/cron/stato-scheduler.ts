import type cron from "node-cron";

type ScheduledTask = ReturnType<typeof cron.schedule>;

/**
 * Cron attivi e job in esecuzione: UNO stato per processo, non per istanza del
 * modulo. Sotto tsx (e nei bundle delle rotte) lo scheduler può essere caricato
 * due volte nello stesso processo: con lo stato nel modulo, una rotta che
 * chiamava `reloadTenantScheduler` non vedeva i cron registrati da server.ts,
 * non li fermava e ne aggiungeva altri — sul cliente A il controllo host è partito due
 * volte alle 15:04 del 2026-10-12 (NUC-5). Stessa classe dell'incidente
 * db-tenant del 2026-09-02 (ADR 0002).
 *
 * In un file a sé perché lo usa anche «Esegui ora» di jobs.ts (scheduler.ts importa jobs.ts): il job `apparati_scelti`
 * lanciato a mano prende la stessa guardia del cron, così non si accavalla al giro programmato (revisione finale 22/10).
 */
export interface SchedulerState {
  activeTasks: Map<string, ScheduledTask>;
  /** Guard: job keys currently running (prevents overlapping execution) */
  runningJobs: Set<string>;
}

const STATE_KEY = Symbol.for("da-ipam.cron.scheduler.state");
const processGlobals = globalThis as unknown as Record<symbol, SchedulerState | undefined>;

export function statoScheduler(): SchedulerState {
  return processGlobals[STATE_KEY] ?? (processGlobals[STATE_KEY] = { activeTasks: new Map(), runningJobs: new Set() });
}

/** La chiave di un job nella guardia: `<tenant>:<id>`, la stessa del cron. */
export const chiaveJob = (tenantCode: string, jobId: number): string => `${tenantCode}:${jobId}`;
