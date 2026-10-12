/**
 * Batch presenza agenti endpoint per N host_id — usato dalla lista /discovery
 * per renderizzare la mini-icona Mesh (e le altre) senza N+1.
 *
 * Input:  POST body { host_ids: number[] }  (cap difensivo ≤1000)
 * Output: { statuses: Record<host_id, EndpointAgentCapabilities | null> }
 *         null = nessun agente noto per quell'host.
 */
import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { meshAttivo } from "@/lib/integrations/meshcentral/feature";
import {
  getEndpointAgentsForHosts,
  type EndpointAgentCapabilities,
} from "@/lib/integrations/meshcentral/presence";

/** Normalizza + filtra (>0, finiti) + cap difensivo 1000. */
export function parseHostIdsCapped(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => (typeof v === "number" ? v : parseInt(String(v), 10)))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, 1000);
}

function hasAny(c: EndpointAgentCapabilities): boolean {
  return c.glpi.present || c.choco.present || c.mesh.present || c.wazuh.present;
}

/**
 * Stati per host. A modulo MeshCentral spento (SEC-18) la presenza Mesh non
 * si mostra: l'icona porterebbe ad azioni che rispondono 409. Gli altri agenti
 * restano.
 */
export function statiPresenza(
  hostIds: number[],
  map: Map<number, EndpointAgentCapabilities>,
  meshOn: boolean,
): Record<string, EndpointAgentCapabilities | null> {
  const statuses: Record<string, EndpointAgentCapabilities | null> = {};
  for (const id of hostIds) {
    const found = map.get(id);
    const caps = found && !meshOn ? { ...found, mesh: { present: false } } : found;
    statuses[id] = caps && hasAny(caps) ? caps : null;
  }
  return statuses;
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

    const hostIds = parseHostIdsCapped((body as { host_ids?: unknown }).host_ids);
    const statuses = statiPresenza(hostIds, getEndpointAgentsForHosts(hostIds), meshAttivo());
    return NextResponse.json({ statuses });
  });
}
