/**
 * POST /api/patch/matcher/run
 *
 * Sync globale CVE→software per il tenant corrente:
 *   - popola `patch_software_meta.choco_id` da dictionary (lookupExact su normalize)
 *   - popola `patch_cve_target` da wazuh_vuln.package_name ↔ software_inventory.name
 *
 * Idempotente. Non sovrascrive righe `match_strategy='manual'`.
 * Auth: requireAdmin (mutation).
 * Trigger: bottone "Calcola matching" in home `/patch-management`.
 */
import { NextResponse } from "next/server";
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { withTenantFromSession } from "@/lib/api-tenant";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { patchModuleGuard } from "@/lib/patch/route-guard";
import { runFullSyncMatch } from "@/lib/patch/matcher";

export async function POST() {
  return withTenantFromSession(async () => {
    const guard = await patchModuleGuard();
    if (isAuthError(guard)) return guard;
    const admin = await requireAdmin();
    if (isAuthError(admin)) return admin;

    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) {
      return NextResponse.json(
        { error: "Tenant context non disponibile" },
        { status: 500 }
      );
    }

    try {
      const db = getTenantDb(tenantCode);
      const result = runFullSyncMatch(db);
      return NextResponse.json(result, { status: 200 });
    } catch (error) {
      console.error("[patch/matcher/run POST] errore:", error);
      return NextResponse.json(
        { error: "Errore durante il matching globale" },
        { status: 500 }
      );
    }
  });
}
