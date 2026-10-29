import { getTenantDb } from "@/lib/db-tenant";
import { reloadTenantScheduler } from "@/lib/cron/scheduler";

/** Intervallo di default per il job ad_sync (minuti). 6h: l'AD cambia lentamente
 *  e la dashboard-health considera "stale" oltre 2× questo intervallo. */
export const AD_SYNC_INTERVAL_MIN = 360;

/**
 * Garantisce un job ricorrente `ad_sync` (network_id NULL = tutte le integrazioni
 * AD abilitate del tenant) e ricarica lo scheduler in-memory.
 *
 * Storicamente il job NON veniva mai auto-creato all'attivazione di un'integrazione
 * AD (a differenza di wazuh_sync/vuln_sync): l'AD restava non sincronizzato finché
 * qualcuno non creava il job a mano da Settings → Job schedulati. Va chiamata sia alla
 * creazione sia quando un'integrazione viene abilitata da «Modifica»: su un'appliance
 * (29/10/2026) l'integrazione era stata salvata spenta e accesa dopo, e il job non c'era.
 */
export function ensureAdSyncJob(tenantCode: string): void {
  const db = getTenantDb(tenantCode);
  const existing = db
    .prepare("SELECT id FROM scheduled_jobs WHERE job_type = 'ad_sync' AND network_id IS NULL")
    .get() as { id: number } | undefined;
  if (existing) {
    db.prepare(
      "UPDATE scheduled_jobs SET enabled = 1, updated_at = datetime('now') WHERE id = ?",
    ).run(existing.id);
  } else {
    db.prepare(
      `INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled, config)
       VALUES (NULL, 'ad_sync', ?, 1, '{}')`,
    ).run(AD_SYNC_INTERVAL_MIN);
  }
  reloadTenantScheduler(tenantCode);
}
