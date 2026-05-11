import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteTenantAgent,
  getTenantAgentById,
  getTenantAgents,
  updateTenantAgent,
  updateTenantAgentConfig,
  getTenantById,
} from "@/lib/db-hub";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";

const HOSTNAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?)*$/;

const UpdateAgentSchema = z.object({
  label: z.string().trim().min(1).max(64).optional(),
  hostname: z.string().trim().refine((v) => HOSTNAME_RE.test(v), {
    message: "Hostname non valido",
  }).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  subnet_match: z.string().trim().nullable().optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    if (isAuthError(session)) return session;
    const { id } = await params;
    const agent = getTenantAgentById(Number(id));
    if (!agent) return NextResponse.json({ error: "Agente non trovato" }, { status: 404 });
    const tenant = getTenantById(agent.tenant_id);
    return NextResponse.json({
      ...agent,
      token_hash: undefined,
      token_encrypted: undefined,
      has_token: Boolean(agent.token_hash),
      codice_cliente: tenant?.codice_cliente,
      ragione_sociale: tenant?.ragione_sociale,
    });
  } catch (e) {
    console.error("Errore GET tenant-agent:", e);
    return NextResponse.json({ error: "Errore" }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const agentId = Number(id);
    const existing = getTenantAgentById(agentId);
    if (!existing) return NextResponse.json({ error: "Agente non trovato" }, { status: 404 });

    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: "JSON non valido" }, { status: 400 }); }
    const parsed = UpdateAgentSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

    const updated = updateTenantAgent(agentId, parsed.data);
    return NextResponse.json({ ...updated, has_token: Boolean(updated?.token_hash), token_hash: undefined, token_encrypted: undefined });
  } catch (e) {
    if (e instanceof Error && e.message.includes("UNIQUE")) {
      return NextResponse.json({ error: "Label già usata per un altro agente di questo cliente" }, { status: 409 });
    }
    console.error("Errore PUT tenant-agent:", e);
    return NextResponse.json({ error: "Errore" }, { status: 500 });
  }
}

/**
 * DELETE rimuove l'agente. Se è l'ultimo del tenant, riporta il tenant in
 * modalità 'local' (così l'Executor smette di tentare connessioni remote).
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const agentId = Number(id);
    const existing = getTenantAgentById(agentId);
    if (!existing) return NextResponse.json({ error: "Agente non trovato" }, { status: 404 });

    const ok = deleteTenantAgent(agentId);
    if (!ok) return NextResponse.json({ error: "Errore nella cancellazione" }, { status: 500 });

    const remaining = getTenantAgents(existing.tenant_id);
    if (remaining.length === 0) {
      updateTenantAgentConfig(existing.tenant_id, { agent_mode: "local" });
    }
    return NextResponse.json({ deleted: true, remaining: remaining.length });
  } catch (e) {
    console.error("Errore DELETE tenant-agent:", e);
    return NextResponse.json({ error: "Errore" }, { status: 500 });
  }
}
