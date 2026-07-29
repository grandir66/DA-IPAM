import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { getWazuhHealth } from "@/lib/integrations/wazuh-health";

/**
 * GET /api/integrations/wazuh/health — cruscotto salute Wazuh (manager,
 * indexer, ingestione, repliche). Risponde dalla cache (60s per tenant).
 */
export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  return withTenantFromSession(async () => {
    const code = getCurrentTenantCode();
    if (!code) return Response.json({ error: "contesto tenant assente" }, { status: 500 });
    const health = await getWazuhHealth(code);
    return Response.json(health);
  });
}

/**
 * POST /api/integrations/wazuh/health — forza un nuovo probe (bypass cache).
 * requireAdmin: azione attiva con I/O di rete verso manager/indexer/repliche.
 */
export async function POST() {
  const auth = await requireAdmin();
  if (isAuthError(auth)) return auth;
  return withTenantFromSession(async () => {
    const code = getCurrentTenantCode();
    if (!code) return Response.json({ error: "contesto tenant assente" }, { status: 500 });
    const health = await getWazuhHealth(code, { force: true });
    return Response.json(health);
  });
}
