import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { resolveModules } from "@/lib/modules/registry";

/**
 * GET /api/modules — registry unico dei 6 moduli base per il tenant corrente.
 * Veloce (solo letture DB/settings); la salute live è in /api/modules/health.
 */
export async function GET() {
  return withTenantFromSession(async () => {
    const authErr = await requireAuth();
    if (isAuthError(authErr)) return authErr;
    const tenantCode = getCurrentTenantCode() ?? "DEFAULT";
    const modules = await resolveModules(tenantCode);
    return NextResponse.json(
      { ok: true, modules },
      { headers: { "Cache-Control": "private, max-age=30" } },
    );
  });
}
