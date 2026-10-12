import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";
import type { Database } from "better-sqlite3";
import type { VulnScannerRow } from "@/lib/vuln/scanner-edge-client";

/** Singleton scanner-edge abilitato per il tenant corrente. */
export function getActiveEdgeScanner(): VulnScannerRow | null {
  const code = getCurrentTenantCode() ?? "DEFAULT";
  const db = getTenantDb(code);
  const row = db
    .prepare(
      "SELECT id, name, base_url, token_encrypted, enabled, cert_pin FROM vuln_scanners WHERE enabled = 1 ORDER BY id LIMIT 1",
    )
    .get() as VulnScannerRow | undefined;
  return row ?? null;
}

/**
 * Rimuove lo scanner-edge del tenant (DELETE /api/integrations/scanner-edge).
 *
 * ATTENZIONE: vuln_scan_runs e vuln_findings hanno ON DELETE CASCADE su
 * vuln_scanners e il DB del cliente apre con foreign_keys=ON, quindi la
 * rimozione cancella anche tutti i findings importati e lo storico delle
 * scansioni. La conferma in UI lo dice (edgeRemovalConfirmText, MOD-19);
 * presidiata da src/lib/vuln/__tests__/edge-removal.test.ts. Chi chiama
 * ricarica lo scheduler del tenant.
 */
export function removeEdgeScanner(db: Database): void {
  db.prepare("DELETE FROM vuln_scanners").run();
  db.prepare(
    "DELETE FROM scheduled_jobs WHERE job_type = 'vuln_sync' AND network_id IS NULL",
  ).run();
}
