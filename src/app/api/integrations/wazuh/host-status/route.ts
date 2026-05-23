/**
 * Batch status Wazuh per N host_id — usato dalle UI list views (discovery, networks,
 * /hosts) per renderizzare l'icona Shield in batch evitando N+1 query.
 *
 * Input:  GET /api/integrations/wazuh/host-status?host_ids=1,2,3,...
 *         oppure POST body {"host_ids":[1,2,3,...]} per liste lunghe (URL limit).
 *
 * Output: { [host_id]: {agent_id, status, last_keep_alive, name} | null }
 *         null = host NON in wazuh_agent (no agent registrato).
 */
import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getWazuhAgentsByHostIds } from "@/lib/integrations/wazuh-db";

interface HostStatusValue {
  agent_id: string;
  status: string | null;
  last_keep_alive: string | null;
  name: string | null;
}

function parseHostIds(raw: string | null | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, 1000); // cap difensivo
}

async function buildResponse(hostIds: number[]) {
  const map = getWazuhAgentsByHostIds(hostIds);
  const result: Record<string, HostStatusValue | null> = {};
  for (const id of hostIds) {
    const agent = map.get(id);
    result[id] = agent
      ? {
          agent_id: agent.agent_id,
          status: agent.status ?? null,
          last_keep_alive: agent.last_keep_alive ?? null,
          name: agent.name ?? null,
        }
      : null;
  }
  return NextResponse.json({ statuses: result });
}

export async function GET(request: Request) {
  return withTenantFromSession(async () => {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;
    const url = new URL(request.url);
    const hostIds = parseHostIds(url.searchParams.get("host_ids"));
    return buildResponse(hostIds);
  });
}

export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const ids = (body as { host_ids?: unknown }).host_ids;
    const hostIds = Array.isArray(ids)
      ? ids.map((v) => (typeof v === "number" ? v : parseInt(String(v), 10))).filter((n) => Number.isFinite(n) && n > 0)
      : [];
    return buildResponse(hostIds);
  });
}
