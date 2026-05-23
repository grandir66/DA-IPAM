/**
 * Lista agent Wazuh visibili nel tenant corrente.
 *
 *   GET — ritorna [{ agent_id, name, ip, hostname, host_id, status, ... }]
 */
import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { listAllWazuhAgents, countsForAgent } from "@/lib/integrations/wazuh-db";

export async function GET() {
  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;
    const agents = listAllWazuhAgents();
    const enriched = agents.map((a) => ({
      ...a,
      counts: countsForAgent(a.agent_id),
    }));
    return NextResponse.json({ agents: enriched });
  });
}
