import { NextResponse } from "next/server";
import { getTenantById, updateTenantAgentConfig } from "@/lib/db-hub";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { z } from "zod";

/**
 * Hostname Tailscale: short name MagicDNS (es. "agent-cliente001") oppure
 * FQDN (es. "agent-cliente001.tailnet.ts.net") oppure IP CGNAT (100.x).
 * Vietati: schemi URL (http://), path (/), query string.
 */
const HOSTNAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?)*$/;

const AgentConfigSchema = z.object({
  agent_mode: z.enum(["local", "remote"]).optional(),
  agent_hostname: z
    .string()
    .trim()
    .nullable()
    .optional()
    .refine(
      (v) => v === null || v === undefined || v === "" || HOSTNAME_RE.test(v),
      {
        message:
          "Hostname non valido. Usa il short name Tailscale (es. 'agent-cliente001') o l'IP CGNAT (100.x.x.x). Niente 'http://' o path.",
      },
    ),
  agent_port: z.number().int().min(1).max(65535).optional(),
});

/**
 * Restituisce la configurazione corrente dell'agente per il tenant.
 * NON espone mai `agent_token_hash` né `agent_token_encrypted`.
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
    if (!tenant) {
      return NextResponse.json({ error: "Cliente non trovato" }, { status: 404 });
    }

    return NextResponse.json({
      agent_mode: tenant.agent_mode,
      agent_hostname: tenant.agent_hostname,
      agent_port: tenant.agent_port,
      agent_version: tenant.agent_version,
      agent_last_seen_at: tenant.agent_last_seen_at,
      has_token: Boolean(tenant.agent_token_hash),
    });
  } catch (error) {
    console.error("Errore nel recupero config agente:", error);
    return NextResponse.json({ error: "Errore nel recupero della configurazione agente" }, { status: 500 });
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
    if (!tenant) {
      return NextResponse.json({ error: "Cliente non trovato" }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
    }

    const parsed = AgentConfigSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const data = parsed.data;
    if (data.agent_mode === "remote" && !data.agent_hostname && !tenant.agent_hostname) {
      return NextResponse.json(
        { error: "Per la modalità 'remote' è obbligatorio specificare l'hostname Tailscale dell'agente." },
        { status: 400 },
      );
    }

    const normalized = {
      ...data,
      agent_hostname: data.agent_hostname === undefined
        ? undefined
        : (data.agent_hostname?.trim() || null),
    };

    const updated = updateTenantAgentConfig(Number(id), normalized);
    if (!updated) {
      return NextResponse.json({ error: "Cliente non trovato" }, { status: 404 });
    }

    return NextResponse.json({
      agent_mode: updated.agent_mode,
      agent_hostname: updated.agent_hostname,
      agent_port: updated.agent_port,
      agent_version: updated.agent_version,
      agent_last_seen_at: updated.agent_last_seen_at,
      has_token: Boolean(updated.agent_token_hash),
    });
  } catch (error) {
    console.error("Errore nell'aggiornamento config agente:", error);
    return NextResponse.json({ error: "Errore nell'aggiornamento della configurazione agente" }, { status: 500 });
  }
}
