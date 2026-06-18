import { NextResponse } from "next/server";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { getModulesHealth, invalidateModulesHealth } from "@/lib/modules/health";
import type { ModuleKey } from "@/lib/modules/registry";

const VALID_KEYS: ModuleKey[] = [
  "edge",
  "librenms",
  "wazuh",
  "graylog",
  "patch_management",
  "network_services",
];

/**
 * GET /api/modules/health — stato di salute dei moduli (cache 60s per tenant).
 * Probe live L7 (reachable + auth + ultimo sync). Per forzare un re-probe usa POST.
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

/**
 * POST /api/modules/health  body opzionale { key?: ModuleKey }
 * Forza un re-probe LIVE (bypass cache). Se `key` è presente verifica solo quel
 * modulo, altrimenti tutti. Usato dall'installer (connect.sh fail-fast) e dal
 * bottone "Verifica" del Launchpad. requireAdmin (azione attiva con I/O di rete).
 */
export async function POST(req: Request) {
  return withTenantFromSession(async () => {
    const authErr = await requireAdmin();
    if (isAuthError(authErr)) return authErr;

    let key: ModuleKey | undefined;
    try {
      const body = (await req.json()) as { key?: string };
      if (body?.key) {
        if (!VALID_KEYS.includes(body.key as ModuleKey)) {
          return NextResponse.json({ ok: false, error: `Modulo sconosciuto: ${body.key}` }, { status: 400 });
        }
        key = body.key as ModuleKey;
      }
    } catch {
      // body vuoto/non-JSON → probe di tutti i moduli
    }

    const tenantCode = getCurrentTenantCode() ?? "DEFAULT";
    invalidateModulesHealth(tenantCode);
    const health = await getModulesHealth(tenantCode, { force: true, only: key });
    return NextResponse.json({ ok: true, health });
  });
}
