import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getTopologyModelInput } from "@/lib/db-tenant";
import { buildTopologyModel } from "@/lib/topology/model";
import { getLinkStaleDays } from "@/lib/topology/settings";
import { NO_STORE } from "@/lib/controllers/route-helpers";

/** GET /api/topology/model — il modello della mappa, con la soglia «non visto» usata. */
export async function GET() {
  return withTenantFromSession(async () => {
    const s = await requireAuth();
    if (isAuthError(s)) return s;
    try {
      const staleDays = getLinkStaleDays();
      const model = buildTopologyModel(getTopologyModelInput(staleDays));
      return NextResponse.json({ ...model, staleDays }, { headers: NO_STORE });
    } catch (error) {
      console.error("[topology] modello:", error);
      return NextResponse.json({ error: "Errore nel calcolo del modello della mappa" }, { status: 500 });
    }
  });
}
