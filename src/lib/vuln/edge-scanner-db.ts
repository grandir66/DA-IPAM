import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";
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
