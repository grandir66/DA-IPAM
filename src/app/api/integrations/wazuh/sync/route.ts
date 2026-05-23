/**
 * Sync Wazuh per il tenant corrente.
 *
 *   POST  → esegue full sync (agents + syscollector + software + vulns)
 *   GET   → stato ultimo sync (riassunto agent count + matched)
 */
import { NextResponse } from "next/server";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { syncWazuhForTenant } from "@/lib/integrations/wazuh-sync";
import { listAllWazuhAgents } from "@/lib/integrations/wazuh-db";

export async function POST() {
  return withTenantFromSession(async () => {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    try {
      const result = await syncWazuhForTenant();
      return NextResponse.json(result);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  });
}

export async function GET() {
  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;
    const agents = listAllWazuhAgents();
    const matched = agents.filter((a) => a.host_id !== null).length;
    const active  = agents.filter((a) => a.status === "active").length;
    const lastSynced = agents.reduce<string | null>(
      (acc, a) => (acc && acc > a.synced_at ? acc : a.synced_at),
      null,
    );
    return NextResponse.json({
      totalAgents: agents.length,
      matched,
      active,
      lastSyncedAt: lastSynced,
    });
  });
}
