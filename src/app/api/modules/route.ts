import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { resolveModules } from "@/lib/modules/registry";
import { dipendenzeReali } from "@/lib/zabbix-lettura/reale";
import { pannelloNelMenu } from "@/lib/zabbix-lettura/servizio";

/** Pannelli fuori dal catalogo dei moduli (passo 7.4): solo se vanno nel menu. Nessuna rete. */
function pannelli(): { zabbix: boolean } {
  try {
    return { zabbix: pannelloNelMenu(dipendenzeReali()) };
  } catch {
    return { zabbix: false };
  }
}

/**
 * GET /api/modules — registry unico dei 6 moduli base per il tenant corrente.
 * Veloce (solo letture DB/settings); la salute live è in /api/modules/health.
 */
export async function GET() {
  return withTenantFromSession(async () => {
    const session = await requireAuth();
    if (isAuthError(session)) return session;
    const tenantCode = getCurrentTenantCode() ?? "DEFAULT";
    const modules = await resolveModules(tenantCode, session.user.role);
    return NextResponse.json(
      { ok: true, modules, pannelli: pannelli() },
      { headers: { "Cache-Control": "private, max-age=30" } },
    );
  });
}
