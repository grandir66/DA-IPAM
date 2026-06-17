import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { getModulesHealth } from "@/lib/modules/health";

/**
 * GET /api/modules/health — stato di salute dei 6 moduli (cache 60s per tenant).
 * Probe HTTP live solo per network_services (bounded a 4s); gli altri derivano
 * dai sync job / config esistenti.
 */
export async function GET() {
  return withTenantFromSession(async () => {
    const authErr = await requireAuth();
    if (isAuthError(authErr)) return authErr;
    const tenantCode = getCurrentTenantCode() ?? "DEFAULT";
    const health = await getModulesHealth(tenantCode);
    return NextResponse.json(
      { ok: true, health },
      {
        headers: {
          "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
        },
      },
    );
  });
}
