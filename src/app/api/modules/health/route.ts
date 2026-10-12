import { NextResponse } from "next/server";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { riepilogoRipieghi } from "@/lib/db-maintenance/ripieghi";
import { getModulesHealth, invalidateModulesHealth, PROBED_MODULE_KEYS } from "@/lib/modules/health";
import type { ModuleKey } from "@/lib/modules/registry";

// I moduli con una sonda: un elenco solo, quello di health.ts (prima era
// ricopiato qui e un modulo nuovo restava «sconosciuto» alla Verifica).
const VALID_KEYS: readonly ModuleKey[] = PROBED_MODULE_KEYS;

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
    // Ripieghi del facade del DB (NUC-1): chi accede senza contesto tenant,
    // dal processo corrente. Lo storico persistente è in data/logs/ripieghi/.
    return NextResponse.json(
      { ok: true, health, ripieghi: riepilogoRipieghi() },
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
