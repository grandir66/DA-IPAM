/**
 * Tipi di job schedulato (`scheduled_jobs.job_type`): l'UNICO elenco.
 *
 * Da qui derivano il CHECK dello schema tenant (`db-tenant-schema.ts`), quello
 * dell'ultima ricostruzione della tabella (`migrateScheduledJobsV8` in
 * `db-tenant.ts`) e il tipo TypeScript (`ScheduledJob["job_type"]` in
 * `@/types`). Prima erano tre elenchi scritti a mano, più uno per ognuna delle
 * ricostruzioni v2…v7: se lo schema e la migrazione divergono, un DB nuovo e
 * uno aggiornato accettano job diversi.
 *
 * Aggiungere un tipo: in coda qui, poi una nuova ricostruzione (v9…) in
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
] as const;

export type ScheduledJobType = (typeof SCHEDULED_JOB_TYPES)[number];

/** Il vincolo SQL, così com'è dentro `job_type TEXT NOT NULL CHECK(…)`. */
export const SCHEDULED_JOB_TYPES_CHECK_SQL = `job_type IN (${SCHEDULED_JOB_TYPES.map((t) => `'${t}'`).join(", ")})`;
