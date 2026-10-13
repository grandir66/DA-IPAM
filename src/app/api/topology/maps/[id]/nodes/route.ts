import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getTopologyMapView, setTopologyMapNodes } from "@/lib/db-tenant";
import { parseMapNodesBody } from "@/lib/topology/api-input";
import { NO_STORE, parseControllerId, readJson } from "@/lib/controllers/route-helpers";

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/topology/maps/[id]/nodes — `{ add, remove }`: si aggiunge e si toglie per nodo, mai si riscrive l'elenco (due persone non si pestano i piedi). */
export async function PUT(req: Request, ctx: Ctx) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    const id = parseControllerId((await ctx.params).id);
    if (id === null) return NextResponse.json({ error: "Mappa non trovata" }, { status: 404 });
    const body = parseMapNodesBody(await readJson(req));
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
    try {
      const esito = setTopologyMapNodes(id, body.data.add, body.data.remove);
      if (!esito.ok) return NextResponse.json({ error: esito.error }, { status: 404 });
      return NextResponse.json({ nodes: getTopologyMapView(`mappa:${id}`).nodes }, { headers: NO_STORE });
    } catch (error) {
      console.error("[topology] mappa, nodi:", error);
      return NextResponse.json({ error: "Errore nel salvataggio dei nodi della mappa" }, { status: 500 });
    }
  });
}
