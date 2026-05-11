import { NextResponse } from "next/server";
import { getAllTenantAgentsWithInfo } from "@/lib/db-hub";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

interface AgentListEntry {
  agent_id: number;
  tenant_id: number;
  codice_cliente: string;
  ragione_sociale: string;
  label: string;
  hostname: string;
  port: number;
  version: string | null;
  last_seen_at: string | null;
  subnet_match: string | null;
  has_token: boolean;
}

/**
 * Lista cross-tenant di TUTTI gli agenti (multi-agent per tenant supportato).
 * Una riga per agent. Usata dalla pagina /agents per overview e per il dialog
 * "Nuovo agente".
 */
export async function GET() {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    const agents = getAllTenantAgentsWithInfo();
    const out: AgentListEntry[] = agents.map((a) => ({
      agent_id: a.id,
      tenant_id: a.tenant_id,
      codice_cliente: a.codice_cliente,
      ragione_sociale: a.ragione_sociale,
      label: a.label,
      hostname: a.hostname,
      port: a.port,
      version: a.version,
      last_seen_at: a.last_seen_at,
      subnet_match: a.subnet_match,
      has_token: Boolean(a.token_hash),
    }));
    return NextResponse.json(out);
  } catch (e) {
    console.error("Errore GET /api/agents:", e);
    return NextResponse.json({ error: "Errore" }, { status: 500 });
  }
}
