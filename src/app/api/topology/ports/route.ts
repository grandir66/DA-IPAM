import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getTopologyKnownPorts } from "@/lib/db-tenant";
import { parsePortsQuery, type PortsView } from "@/lib/topology/api-input";
import { NO_STORE } from "@/lib/controllers/route-helpers";

/**
 * GET /api/topology/ports?node=dev:N — le porte note di un oggetto per «Collega a…»
 * (spec §11.3): porte dello switch con velocità e PoE, oppure schede dell'hypervisor
 * dalla scansione. `{ node, ports }`; `ports: []` se non se ne conosce nessuna (host e
 * VM compresi); 404 se l'apparato non esiste.
 */
export async function GET(req: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAuth();
    if (isAuthError(s)) return s;
    const node = parsePortsQuery(new URL(req.url).searchParams.get("node"));
    if (!node.ok) return NextResponse.json({ error: node.error }, { status: 400 });
    try {
      const ports = getTopologyKnownPorts(node.data);
      if (ports === null) return NextResponse.json({ error: "Apparato non trovato" }, { status: 404 });
      const view: PortsView = { node: node.data, ports };
      return NextResponse.json(view, { headers: NO_STORE });
    } catch (error) {
      console.error("[topology] porte note:", error);
      return NextResponse.json({ error: "Errore nella lettura delle porte" }, { status: 500 });
    }
  });
}
