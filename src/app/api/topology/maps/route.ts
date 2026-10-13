import { NextResponse } from "next/server";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { createTopologyMap, getAutoMap, listTopologyMaps } from "@/lib/db-tenant";
import { parseMapCreateBody } from "@/lib/topology/api-input";
import { NO_STORE, actorOf, readJson } from "@/lib/controllers/route-helpers";

/** GET /api/topology/maps — le mappe passo passo salvate e la testa della mappa automatica. */
export async function GET() {
  return withTenantFromSession(async () => {
    const s = await requireAuth();
    if (isAuthError(s)) return s;
    try {
      return NextResponse.json({ maps: listTopologyMaps(), auto: getAutoMap() }, { headers: NO_STORE });
    } catch (error) {
      console.error("[topology] mappe, lettura:", error);
      return NextResponse.json({ error: "Errore nella lettura delle mappe" }, { status: 500 });
    }
  });
}

/** POST /api/topology/maps — salva una mappa passo passo. */
export async function POST(req: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    const body = parseMapCreateBody(await readJson(req));
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
    try {
      return NextResponse.json(createTopologyMap(body.data, actorOf(s) ?? "sconosciuto"), { status: 201 });
    } catch (error) {
      console.error("[topology] mappe, creazione:", error);
      return NextResponse.json({ error: "Errore nel salvataggio della mappa" }, { status: 500 });
    }
  });
}
