import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getTenantById,
  getFirstTenantAgent,
  getTenantAgents,
  updateTenantAgent,
  updateTenantAgentConfig,
  createTenantAgent,
} from "@/lib/db-hub";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";

const HOSTNAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?)*$/;

const AgentConfigSchema = z.object({
  agent_mode: z.enum(["local", "remote"]).optional(),
  agent_hostname: z.string().trim().nullable().optional().refine(
    (v) => v === null || v === undefined || v === "" || HOSTNAME_RE.test(v),
    { message: "Hostname non valido (short MagicDNS o IP, niente 'http://' o path)" },
  ),
  agent_port: z.number().int().min(1).max(65535).optional(),
});

/**
 * Back-compat: legge/scrive il PRIMO agente del tenant tramite la vecchia
 * shape API. Per nuove integrazioni usare /api/tenant-agents/* con supporto
 * multi-agent. Le scritture su questo endpoint creano l'agente se manca.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAuth();
    if (isAuthError(session)) return session;
    const { id } = await params;
    const tenant = getTenantById(Number(id));
    if (!tenant) return NextResponse.json({ error: "Cliente non trovato" }, { status: 404 });
    const agent = getFirstTenantAgent(tenant.id);

    return NextResponse.json({
      agent_mode: tenant.agent_mode,
      agent_hostname: agent?.hostname ?? null,
      agent_port: agent?.port ?? 8443,
      agent_version: agent?.version ?? null,
      agent_last_seen_at: agent?.last_seen_at ?? null,
      has_token: Boolean(agent?.token_hash),
      agent_count: getTenantAgents(tenant.id).length,
    });
  } catch (e) {
    console.error("Errore GET back-compat agent:", e);
    return NextResponse.json({ error: "Errore" }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const tenant = getTenantById(Number(id));
    if (!tenant) return NextResponse.json({ error: "Cliente non trovato" }, { status: 404 });

    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: "JSON non valido" }, { status: 400 }); }
    const parsed = AgentConfigSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

    const data = parsed.data;
    if (data.agent_mode !== undefined) {
      updateTenantAgentConfig(tenant.id, { agent_mode: data.agent_mode });
    }

    let agent = getFirstTenantAgent(tenant.id);
    const newHostname = data.agent_hostname === undefined ? agent?.hostname : (data.agent_hostname ?? null);
    const newPort = data.agent_port ?? agent?.port ?? 8443;

    if (data.agent_mode === "remote" && !agent && newHostname) {
      // crea un nuovo agente "Sede principale" se non esiste
      agent = createTenantAgent({
        tenant_id: tenant.id,
        label: "Sede principale",
        hostname: newHostname,
        port: newPort,
      });
    } else if (agent && (data.agent_hostname !== undefined || data.agent_port !== undefined)) {
      const upd: { hostname?: string; port?: number } = {};
      if (newHostname) upd.hostname = newHostname;
      if (data.agent_port !== undefined) upd.port = newPort;
      if (Object.keys(upd).length) updateTenantAgent(agent.id, upd);
    }

    const fresh = getTenantAgentsRefreshed(tenant.id);
    return NextResponse.json(fresh);
  } catch (e) {
    console.error("Errore PUT back-compat agent:", e);
    return NextResponse.json({ error: "Errore" }, { status: 500 });
  }
}

function getTenantAgentsRefreshed(tenantId: number) {
  const tenant = getTenantById(tenantId);
  const agent = getFirstTenantAgent(tenantId);
  return {
    agent_mode: tenant?.agent_mode ?? "local",
    agent_hostname: agent?.hostname ?? null,
    agent_port: agent?.port ?? 8443,
    agent_version: agent?.version ?? null,
    agent_last_seen_at: agent?.last_seen_at ?? null,
    has_token: Boolean(agent?.token_hash),
    agent_count: getTenantAgents(tenantId).length,
  };
}
