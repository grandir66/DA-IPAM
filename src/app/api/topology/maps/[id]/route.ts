import { NextResponse } from "next/server";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { deleteTopologyMap, getAutoMap, getTopologyMap, getTopologyMapView, setAutoHead, updateTopologyMap } from "@/lib/db-tenant";
import { parseAutoHeadBody, parseMapPatchBody } from "@/lib/topology/api-input";
import { NO_STORE, actorOf, parseControllerId, readJson } from "@/lib/controllers/route-helpers";

type Ctx = { params: Promise<{ id: string }> };

function notFound(): NextResponse {
  return NextResponse.json({ error: "Mappa non trovata" }, { status: 404 });
}

/** GET /api/topology/maps/[id] — la mappa con i suoi nodi e ritocchi. `id = auto`: la mappa automatica (la sua riga può non esserci ancora). */
export async function GET(_req: Request, ctx: Ctx) {
  return withTenantFromSession(async () => {
    const s = await requireAuth();
    if (isAuthError(s)) return s;
    const raw = (await ctx.params).id;
    try {
      if (raw === "auto") return NextResponse.json({ map: getAutoMap(), ...getTopologyMapView("auto") }, { headers: NO_STORE });
      const id = parseControllerId(raw);
      const map = id === null ? null : getTopologyMap(id);
      if (id === null || !map) return notFound();
      return NextResponse.json({ map, ...getTopologyMapView(`mappa:${id}`) }, { headers: NO_STORE });
    } catch (error) {
      console.error("[topology] mappa, lettura:", error);
      return NextResponse.json({ error: "Errore nella lettura della mappa" }, { status: 500 });
    }
  });
}

/** PATCH /api/topology/maps/[id] — rinomina o cambia le radici; con `id = auto` imposta la testa (`{ head_node }`). */
export async function PATCH(req: Request, ctx: Ctx) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    const raw = (await ctx.params).id;
    const json = await readJson(req);
    try {
      if (raw === "auto") {
        const head = parseAutoHeadBody(json);
        if (!head.ok) return NextResponse.json({ error: head.error }, { status: 400 });
        setAutoHead(head.data.headNode, actorOf(s) ?? "sconosciuto");
        return NextResponse.json(getAutoMap());
      }
      const id = parseControllerId(raw);
      if (id === null) return notFound();
      const body = parseMapPatchBody(json);
      if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
      const esito = updateTopologyMap(id, body.data);
      if (!esito.ok) return notFound();
      return NextResponse.json(getTopologyMap(id));
    } catch (error) {
      console.error("[topology] mappa, modifica:", error);
      return NextResponse.json({ error: "Errore nella modifica della mappa" }, { status: 500 });
    }
  });
}

/** PUT /api/topology/maps/auto — come PATCH, per chi imposta la testa. */
export const PUT = PATCH;

/** DELETE /api/topology/maps/[id] — toglie la mappa e i suoi ritocchi (gli apparati restano). */
export async function DELETE(_req: Request, ctx: Ctx) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    const id = parseControllerId((await ctx.params).id);
    if (id === null) return notFound();
    try {
      return deleteTopologyMap(id) ? NextResponse.json({ ok: true }) : notFound();
    } catch (error) {
      console.error("[topology] mappa, cancellazione:", error);
      return NextResponse.json({ error: "Errore nella cancellazione della mappa" }, { status: 500 });
    }
  });
}
