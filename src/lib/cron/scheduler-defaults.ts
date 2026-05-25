/**
 * Boot-time scheduler migration multi-tenant.
 *
 * Policy (post-incident 2026-05-25 DTS):
 * - Nessun fast_scan/ping_sweep schedulato auto su network ≥ /22.
 * - Default per network = known_host_check (ping solo host registrati).
 * - Idempotente: la migration rileva lo stato corrente e non duplica.
 *
 * Eseguita all'avvio del server PRIMA dello scheduler. La logica per-tenant è
 * dentro db-tenant.ts (applyTenantSchedulerDefaults) per evitare cicli import.
 */

import { withTenant, applyTenantSchedulerDefaults } from "@/lib/db-tenant";
import { getActiveTenants } from "@/lib/db-hub";

export function applySchedulerBootMigration(): { tenantsProcessed: number; jobsDisabled: number; jobsSeeded: number } {
  const summary = { tenantsProcessed: 0, jobsDisabled: 0, jobsSeeded: 0 };
  const tenants = getActiveTenants();

  for (const tenant of tenants) {
    try {
      withTenant(tenant.codice_cliente, () => {
        const r = applyTenantSchedulerDefaults();
        summary.jobsDisabled += r.jobsDisabled;
        summary.jobsSeeded += r.jobsSeeded;
        summary.tenantsProcessed++;
      });
    } catch (err) {
      console.error(
        `[scheduler-defaults] tenant ${tenant.codice_cliente} migration failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.info(
    `[scheduler-defaults] boot migration: ${summary.tenantsProcessed} tenant, ` +
      `${summary.jobsDisabled} fast_scan/ping_sweep disabilitati, ` +
      `${summary.jobsSeeded} known_host_check seedati`,
  );
  return summary;
}
