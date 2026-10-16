import { NextResponse } from "next/server";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getDeviceLocation, getTopologyModelInput, setDeviceLocation } from "@/lib/db-tenant";
import { buildTopologyModel } from "@/lib/topology/model";
import { getLinkStaleDays } from "@/lib/topology/settings";
import { parseDeviceLocationBody, type DeviceLocationView } from "@/lib/topology/api-input";
import { NO_STORE, actorOf, parseControllerId, readJson } from "@/lib/controllers/route-helpers";

type Ctx = { params: Promise<{ id: string }> };

function notFound(): NextResponse {
  return NextResponse.json({ error: "Apparato non trovato" }, { status: 404 });
}

/** Sede confermata dell'apparato e, se non c'è conferma, quella che propone il modello. */
function view(id: number): DeviceLocationView | null {
  const row = getDeviceLocation(id);
  if (!row) return null;
  const model = buildTopologyModel(getTopologyModelInput(getLinkStaleDays()));
  const node = model.nodes.find((n) => n.id === `dev:${id}`);
  const site = node?.siteProposed && node.siteId !== null ? model.sites.find((s) => s.locationId === node.siteId) : undefined;
  return { ...row, proposed_site: site ? { id: site.locationId, name: site.name } : null };
}

/** GET /api/devices/[id]/location — la sede dell'apparato. */
export async function GET(_req: Request, ctx: Ctx) {
  return withTenantFromSession(async () => {
    const s = await requireAuth();
    if (isAuthError(s)) return s;
    const id = parseControllerId((await ctx.params).id);
    if (id === null) return notFound();
    try {
      const v = view(id);
      return v ? NextResponse.json(v, { headers: NO_STORE }) : notFound();
    } catch (error) {
      console.error("[topology] sede dell'apparato:", error);
      return NextResponse.json({ error: "Errore nella lettura della sede dell'apparato" }, { status: 500 });
    }
  });
}

/** PUT /api/devices/[id]/location — `{ location_id }`: una sede, o null per toglierla. */
export async function PUT(req: Request, ctx: Ctx) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    const id = parseControllerId((await ctx.params).id);
    if (id === null) return notFound();
    const body = parseDeviceLocationBody(await readJson(req));
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
    try {
      if (!getDeviceLocation(id)) return notFound();
      const r = setDeviceLocation(id, body.data.locationId, actorOf(s) ?? "sconosciuto");
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      const v = view(id);
      return v ? NextResponse.json(v, { headers: NO_STORE }) : notFound();
    } catch (error) {
      console.error("[topology] sede dell'apparato, scrittura:", error);
      return NextResponse.json({ error: "Errore nel salvataggio della sede dell'apparato" }, { status: 500 });
    }
  });
}
