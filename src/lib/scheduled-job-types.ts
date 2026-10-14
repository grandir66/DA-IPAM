/**
 * Tipi di job schedulato (`scheduled_jobs.job_type`): l'UNICO elenco.
 *
 * Da qui derivano il CHECK dello schema tenant (`db-tenant-schema.ts`), quello
 * delle ultime ricostruzioni della tabella (`migrateScheduledJobsV8` e
 * `migrateScheduledJobsV9` in `db-tenant.ts`) e il tipo TypeScript (`ScheduledJob["job_type"]` in
 * `@/types`). Prima erano tre elenchi scritti a mano, più uno per ognuna delle
 * ricostruzioni v2…v7: se lo schema e la migrazione divergono, un DB nuovo e
 * uno aggiornato accettano job diversi.
 *
 * Aggiungere un tipo: in coda qui, poi una nuova ricostruzione (v10…) in
 * `getTenantDb` con la guardia sul nuovo valore. Togliere un tipo no: le righe
 * esistenti non passerebbero il CHECK della copia.
 *
 * Modulo puro (niente DB, niente Node): lo importano anche i tipi condivisi.
 */
export const SCHEDULED_JOB_TYPES = [
  "ping_sweep",
  "snmp_scan",
  "nmap_scan",
  "arp_poll",
  "dns_resolve",
  "fast_scan",
  "cleanup",
  "known_host_check",
  "ad_sync",
  "anomaly_check",
  "librenms_sync",
  "vuln_sync",
  "wazuh_sync",
  "wazuh_alerts_sync",
  "mdm_sync",
  "meshcentral_sync",
  // v8 (tappa 2): sync del controller UniFi nel tenant. Nessun job si crea da
  // solo: lo attiva un amministratore.
  "unifi_sync",
  // v9 (topologia fase 2b): lettura giornaliera degli hypervisor (VM e schede
  // vive). Uno per tenant, spento di default: lo accende un amministratore.
  "hypervisor_sync",
] as const;

export type ScheduledJobType = (typeof SCHEDULED_JOB_TYPES)[number];

/** Il vincolo SQL, così com'è dentro `job_type TEXT NOT NULL CHECK(…)`. */
export const SCHEDULED_JOB_TYPES_CHECK_SQL = `job_type IN (${SCHEDULED_JOB_TYPES.map((t) => `'${t}'`).join(", ")})`;

/**
 * Che cosa legge un job unifi_sync: `config.cosa = "client"` è la lettura dei
 * client collegati (topologia fase 2); senza `cosa` (job nati prima) gli apparati.
 */
export function unifiJobKind(configStr: string | null | undefined): "apparati" | "client" {
  try {
    return (JSON.parse(configStr || "{}") as { cosa?: unknown }).cosa === "client" ? "client" : "apparati";
  } catch {
    return "apparati";
  }
}

/**
 * L'etichetta di un job nella pagina dei job: il tipo, tranne il job dei client
 * UniFi, che altrimenti avrebbe la stessa di quello degli apparati (due righe
 * uguali).
 */
export function scheduledJobLabel(job: { job_type: string; config: string | null }, labels: Record<string, string>): string {
  if (job.job_type === "unifi_sync" && unifiJobKind(job.config) === "client") return "Lettura client UniFi (7–20)";
  return labels[job.job_type] || job.job_type;
}
