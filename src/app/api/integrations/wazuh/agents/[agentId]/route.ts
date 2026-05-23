/**
 * Dettaglio agent Wazuh: meta + hardware + os + counts + (opzionale) software/vulns.
 *
 *   GET  ?include=software,vulns
 *   POST ?refresh=1  → forza un re-sync del singolo agent
 */
import { NextResponse } from "next/server";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import {
  getWazuhAgentByAgentId,
  getWazuhHw,
  getWazuhOs,
  listWazuhSoftware,
  listWazuhVulns,
  countsForAgent,
} from "@/lib/integrations/wazuh-db";
import { syncSingleAgent } from "@/lib/integrations/wazuh-sync";

export async function GET(req: Request, ctx: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await ctx.params;
  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;

    const agent = getWazuhAgentByAgentId(agentId);
    if (!agent) return NextResponse.json({ error: "Agent non trovato" }, { status: 404 });

    const url = new URL(req.url);
    const include = (url.searchParams.get("include") ?? "")
      .split(",").map((s) => s.trim()).filter(Boolean);

    const payload: Record<string, unknown> = {
      agent,
      hw: getWazuhHw(agentId),
      os: getWazuhOs(agentId),
      counts: countsForAgent(agentId),
    };
    if (include.includes("software")) payload.software = listWazuhSoftware(agentId);
    if (include.includes("vulns")) payload.vulns = listWazuhVulns(agentId);

    return NextResponse.json(payload);
  });
}

export async function POST(_req: Request, ctx: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await ctx.params;
  return withTenantFromSession(async () => {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    try {
      await syncSingleAgent(agentId);
      const agent = getWazuhAgentByAgentId(agentId);
      return NextResponse.json({ ok: true, agent, counts: countsForAgent(agentId) });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  });
}
