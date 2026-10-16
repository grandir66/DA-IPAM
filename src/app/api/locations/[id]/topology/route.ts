import { NextResponse } from "next/server";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getSiteTopology, getTopologyModelInput, setSiteTopology } from "@/lib/db-tenant";
import { buildTopologyModel } from "@/lib/topology/model";
import { getLinkStaleDays } from "@/lib/topology/settings";
import { parseSiteTopologyBody, type SiteTopologyView } from "@/lib/topology/api-input";
import { NO_STORE, actorOf, parseControllerId, readJson } from "@/lib/controllers/route-helpers";

type Ctx = { params: Promise<{ id: string }> };

const HEAD_TYPES = ["router", "firewall"];

function notFound(): NextResponse {
  return NextResponse.json({ error: "Ubicazione non trovata" }, { status: 404 });
}

/**
 * Testa e subnet della sede, con la testa proposta dal modello e gli elenchi
 * fra cui scegliere. Una sola lettura del modello: apparati, ubicazioni e
 * subnet vengono dallo stesso input (niente password degli apparati in memoria).
 */
function view(id: number): SiteTopologyView | null {
  const row = getSiteTopology(id);
  if (!row) return null;
  const input = getTopologyModelInput(getLinkStaleDays());
  const model = buildTopologyModel(input);
  const site = model.sites.find((s) => s.locationId === id);
  const head =
    site?.headProposed && site.headNodeId ? model.nodes.find((n) => n.id === site.headNodeId && n.kind === "device") : undefined;
  const locName = new Map(input.locations.map((l) => [l.id, l.name]));
  const devices = input.devices
    .map((d) => ({ id: d.id, name: d.name, device_type: d.device_type, host: d.host }))
    .sort(
      (a, b) =>
        Number(!HEAD_TYPES.includes(a.device_type)) - Number(!HEAD_TYPES.includes(b.device_type)) ||
        a.name.localeCompare(b.name, "it"),
    );
  const networks = input.networks.map((n) => ({
    id: n.id,
    cidr: n.cidr,
    name: n.name,
    location_id: n.location_id,
    location_name: n.location_id !== null ? (locName.get(n.location_id) ?? null) : null,
  }));
  return { ...row, proposed_head: head ? { device_id: head.refId, name: head.name } : null, devices, networks };
}

/** GET /api/locations/[id]/topology — testa e subnet della sede. */
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
      console.error("[topology] sede:", error);
      return NextResponse.json({ error: "Errore nella lettura della sede" }, { status: 500 });
    }
  });
}

/**
 * PUT /api/locations/[id]/topology — `{ head_device_id?, network_ids? }`: un
 * campo assente non cambia; `network_ids` sostituisce l'elenco delle subnet.
 */
export async function PUT(req: Request, ctx: Ctx) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    const id = parseControllerId((await ctx.params).id);
    if (id === null) return notFound();
    const body = parseSiteTopologyBody(await readJson(req));
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
    try {
      if (!getSiteTopology(id)) return notFound();
      const r = setSiteTopology(id, body.data, actorOf(s) ?? "sconosciuto");
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      const v = view(id);
      return v ? NextResponse.json(v, { headers: NO_STORE }) : notFound();
    } catch (error) {
      console.error("[topology] sede, scrittura:", error);
      return NextResponse.json({ error: "Errore nel salvataggio della sede" }, { status: 500 });
    }
  });
}
