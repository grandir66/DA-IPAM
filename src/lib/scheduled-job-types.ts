/**
 * Tipi di job schedulato (`scheduled_jobs.job_type`): l'UNICO elenco.
 *
 * Da qui derivano il CHECK dello schema tenant (`db-tenant-schema.ts`), quello
 * delle ultime ricostruzioni della tabella (`migrateScheduledJobsV8`…`V11` in
 * `db-tenant.ts`) e il tipo TypeScript (`ScheduledJob["job_type"]` in
 * `@/types`). Prima erano tre elenchi scritti a mano, più uno per ognuna delle
 * ricostruzioni v2…v7: se lo schema e la migrazione divergono, un DB nuovo e
 * uno aggiornato accettano job diversi.
 *
 * Aggiungere un tipo: in coda qui, poi una nuova ricostruzione (v12…) in
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
  // v10 (pulizia degli host assenti, piano 2026-10-20): archivia ogni notte gli
  // host assenti e cancella l'archivio oltre i 90 giorni. Uno per tenant,
  // spento di default: lo accende solo l'interruttore della pagina della pulizia.
  "pulizia_host",
  // v11 (scansione automatica, piano 2026-10-22): job creato da un admin da
  // Discovery; nessuno si crea da solo. Rilegge gli apparati scelti.
  "apparati_scelti",
] as const;

export type ScheduledJobType = (typeof SCHEDULED_JOB_TYPES)[number];

/** Il nome di ogni tipo di job nella pagina dei job e in Opzioni. */
export const ETICHETTE_JOB: Record<string, string> = {
  ping_sweep: "Scoperta rete (ICMP + Nmap quick + DNS + ARP)",
  fast_scan: "Scoperta veloce subnet",
  snmp_scan: "SNMP Scan",
  nmap_scan: "Nmap Scan",
  arp_poll: "ARP Poll",
  dns_resolve: "DNS Resolve",
  known_host_check: "Monitoraggio host registrati (ICMP)",
  cleanup: "Pulizia tabelle MAC",
  anomaly_check: "Rilevamento anomalie",
  librenms_sync: "Sincronizzazione LibreNMS",
  vuln_sync: "Sincronizzazione vulnerability scanner",
  wazuh_sync: "Sincronizzazione Wazuh (agent/sysc/CVE)",
  ad_sync: "Sincronizzazione Active Directory",
  unifi_sync: "Sincronizzazione controller UniFi",
  hypervisor_sync: "Lettura hypervisor (VM e schede)",
  pulizia_host: "Pulizia host assenti (notte)",
  apparati_scelti: "Lettura apparati",
};

/** Il job hypervisor_sync gira una volta al giorno (lo scheduler lo mette alle 03:00). */
export const HYPERVISOR_SYNC_MINUTES = 1440;

/** Il job pulizia_host gira una volta al giorno, alle 04:00 (`oraDelGiroGiornaliero`). */
export const PULIZIA_HOST_MINUTES = 1440;

/**
 * L'ora (del server) a cui lo scheduler fa partire un job di un giorno o più.
 * Tutti alle 03:00, tranne pulizia_host alle 04:00: dopo il backup notturno
 * (`backup/scheduler.ts`, predefinito alle 03:00) e dopo le letture
 * giornaliere: il giro che toglie host trova il DB già salvato e non parte
 * insieme a loro.
 */
export function oraDelGiroGiornaliero(jobType: string | undefined): number {
  return jobType === "pulizia_host" ? 4 : 3;
}

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
  if (job.job_type === "apparati_scelti") return nomeApparatiScelti(job.config) ?? labels[job.job_type] ?? job.job_type;
  return labels[job.job_type] || job.job_type;
}

/** Il nome scelto dall'admin per un job `apparati_scelti` (`config.nome`); null se manca o la config non si legge. */
export function nomeApparatiScelti(configStr: string | null | undefined): string | null {
  try {
    const nome = (JSON.parse(configStr || "{}") as { nome?: unknown }).nome;
    return typeof nome === "string" && nome.trim() ? nome : null;
  } catch {
    return null;
  }
}
