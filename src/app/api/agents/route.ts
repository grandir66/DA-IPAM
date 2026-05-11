import { NextResponse } from "next/server";
import { getTenants } from "@/lib/db-hub";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

interface AgentListEntry {
  tenant_id: number;
  codice_cliente: string;
  ragione_sociale: string;
  agent_mode: "local" | "remote";
  agent_hostname: string | null;
  agent_port: number;
  agent_version: string | null;
  agent_last_seen_at: string | null;
  has_token: boolean;
}

/**
 * Lista compatta dei tenant con configurazione agente — usata dalla pagina
 * di overview /agents. NON include hash/encrypted del token.
 *
 * Filtro: di default solo tenant con agent_mode='remote'. Query param
 * `include_local=true` restituisce anche i tenant in modalità local
 * (utile per debug del fallback).
 */
export async function GET(request: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    const url = new URL(request.url);
    const includeLocal = url.searchParams.get("include_local") === "true";

    const tenants = getTenants();
    const filtered = includeLocal
      ? tenants
      : tenants.filter((t) => t.agent_mode === "remote");

    const out: AgentListEntry[] = filtered.map((t) => ({
      tenant_id: t.id,
      codice_cliente: t.codice_cliente,
      ragione_sociale: t.ragione_sociale,
      agent_mode: t.agent_mode,
      agent_hostname: t.agent_hostname,
      agent_port: t.agent_port,
      agent_version: t.agent_version,
      agent_last_seen_at: t.agent_last_seen_at,
      has_token: Boolean(t.agent_token_hash),
    }));

    return NextResponse.json(out);
  } catch (error) {
    console.error("Errore nel recupero lista agenti:", error);
    return NextResponse.json({ error: "Errore nel recupero della lista agenti" }, { status: 500 });
  }
}
