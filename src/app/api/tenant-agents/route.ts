import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createTenantAgent,
  getTenantAgents,
  getAllTenantAgentsWithInfo,
  getTenantById,
  updateTenantAgentConfig,
} from "@/lib/db-hub";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";

const HOSTNAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?)*$/;

const CreateAgentSchema = z.object({
  tenant_id: z.number().int().positive(),
  label: z.string().trim().min(1).max(64),
  hostname: z.string().trim().refine((v) => HOSTNAME_RE.test(v), {
    message: "Hostname non valido (short MagicDNS o IP, niente schemi).",
  }),
  port: z.number().int().min(1).max(65535).default(8443),
  subnet_match: z.string().trim().nullable().optional(),
});

/**
 * GET /api/tenant-agents
 *   ?tenant_id=N      → agenti del tenant
 *   (senza param)     → tutti gli agenti cross-tenant (admin)
 *
 * POST /api/tenant-agents → crea nuovo agente per tenant. Imposta anche
 * tenant.agent_mode = 'remote' come effetto collaterale (un cliente che
 * ha almeno un agente è per definizione gestito in modalità remote).
 */
export async function GET(request: Request) {
  try {
    const session = await requireAuth();
    if (isAuthError(session)) return session;

    const url = new URL(request.url);
    const tenantIdParam = url.searchParams.get("tenant_id");
    if (tenantIdParam) {
      const tenantId = Number(tenantIdParam);
      if (!Number.isFinite(tenantId)) {
        return NextResponse.json({ error: "tenant_id non valido" }, { status: 400 });
      }
      return NextResponse.json(
        getTenantAgents(tenantId).map((a) => ({ ...a, token_hash: undefined, token_encrypted: undefined, has_token: Boolean(a.token_hash) })),
      );
    }
    return NextResponse.json(
      getAllTenantAgentsWithInfo().map((a) => ({ ...a, token_hash: undefined, token_encrypted: undefined, has_token: Boolean(a.token_hash) })),
    );
  } catch (e) {
    console.error("Errore GET tenant-agents:", e);
    return NextResponse.json({ error: "Errore nel recupero agenti" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: "JSON non valido" }, { status: 400 }); }

    const parsed = CreateAgentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const tenant = getTenantById(parsed.data.tenant_id);
    if (!tenant) {
      return NextResponse.json({ error: "Tenant non trovato" }, { status: 404 });
    }

    let created;
    try {
      created = createTenantAgent({
        tenant_id: parsed.data.tenant_id,
        label: parsed.data.label,
        hostname: parsed.data.hostname,
        port: parsed.data.port,
        subnet_match: parsed.data.subnet_match ?? null,
      });
    } catch (e) {
      if (e instanceof Error && e.message.includes("UNIQUE")) {
        return NextResponse.json({ error: `Esiste già un agente con label '${parsed.data.label}' per questo cliente` }, { status: 409 });
      }
      throw e;
    }

    // Effetto collaterale: il tenant passa a modalità remote se non lo era.
    if (tenant.agent_mode !== "remote") {
      updateTenantAgentConfig(tenant.id, { agent_mode: "remote" });
    }

    return NextResponse.json({ ...created, has_token: Boolean(created.token_hash), token_hash: undefined, token_encrypted: undefined }, { status: 201 });
  } catch (e) {
    console.error("Errore POST tenant-agents:", e);
    return NextResponse.json({ error: "Errore nella creazione agente" }, { status: 500 });
  }
}
