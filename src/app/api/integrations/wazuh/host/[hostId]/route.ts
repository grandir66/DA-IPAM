/**
 * Dati Wazuh per uno specifico host (lookup via host_id).
 *
 *   GET  → { agent, hw, os, counts, software?, vulns? }  (include=software,vulns opzionale)
 *   POST → forza refresh dei dati Wazuh per l'agent associato a questo host
 *
 * Risponde 404 se l'host non ha un agent Wazuh matchato.
 */
import { NextResponse } from "next/server";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import {
  getWazuhAgentByHostId,
  getWazuhHw,
  getWazuhOs,
  listWazuhSoftware,
  listWazuhVulns,
  listWazuhPorts,
  listWazuhHotfixes,
  countsForAgent,
} from "@/lib/integrations/wazuh-db";
import { syncSingleAgent } from "@/lib/integrations/wazuh-sync";

function parseHostId(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export async function GET(req: Request, ctx: { params: Promise<{ hostId: string }> }) {
  const { hostId: hostIdRaw } = await ctx.params;
  const hostId = parseHostId(hostIdRaw);
  if (hostId === null) return NextResponse.json({ error: "hostId non valido" }, { status: 400 });

  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;

    const agent = getWazuhAgentByHostId(hostId);
    if (!agent) return NextResponse.json({ hasAgent: false }, { status: 200 });

    const url = new URL(req.url);
    const include = (url.searchParams.get("include") ?? "")
      .split(",").map((s) => s.trim()).filter(Boolean);

    const payload: Record<string, unknown> = {
      hasAgent: true,
      agent,
      hw: getWazuhHw(agent.agent_id),
      os: getWazuhOs(agent.agent_id),
      counts: countsForAgent(agent.agent_id),
    };
    if (include.includes("software")) payload.software = listWazuhSoftware(agent.agent_id);
    if (include.includes("vulns")) payload.vulns = listWazuhVulns(agent.agent_id);
    if (include.includes("ports")) payload.ports = listWazuhPorts(agent.agent_id);
    if (include.includes("hotfixes")) payload.hotfixes = listWazuhHotfixes(agent.agent_id);
    return NextResponse.json(payload);
  });
}

export async function POST(_req: Request, ctx: { params: Promise<{ hostId: string }> }) {
  const { hostId: hostIdRaw } = await ctx.params;
  const hostId = parseHostId(hostIdRaw);
  if (hostId === null) return NextResponse.json({ error: "hostId non valido" }, { status: 400 });

  return withTenantFromSession(async () => {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    const agent = getWazuhAgentByHostId(hostId);
    if (!agent) return NextResponse.json({ error: "Nessun agent Wazuh associato all'host" }, { status: 404 });

    try {
      await syncSingleAgent(agent.agent_id);
      const refreshed = getWazuhAgentByHostId(hostId);
      return NextResponse.json({ ok: true, agent: refreshed, counts: countsForAgent(agent.agent_id) });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  });
}
