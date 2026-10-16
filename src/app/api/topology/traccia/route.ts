import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getAutoMap, getIngressoCavi } from "@/lib/db-tenant";
import { NO_STORE } from "@/lib/controllers/route-helpers";
import { buildTopologyModel } from "@/lib/topology/model";
import { computeMapView } from "@/lib/topology/map-compute";
import { padriDi } from "@/lib/topology/misura";
import { getLinkStaleDays } from "@/lib/topology/settings";
import { costruisciModelloCavi } from "@/lib/topology/cavi/modello";
import { calcolaTraccia, nomiTraccia } from "@/lib/topology/cavi/traccia";
import { LETTURE, leggiInterruttore, oraUtc } from "@/lib/topology/letture/interruttori";

/**
 * GET /api/topology/traccia — «Cosa cambierebbe con la mappa nuova (una linea per cavo)» (spec topologia §13.11.3). Solo
 * per gli amministratori (dichiarata in ATTESI di src/lib/permessi/rotte.ts: un GET si aspetterebbe `auth`). Calcolata a
 * richiesta, in memoria: non scrive niente e non cambia la mappa.
 */
export async function GET() {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    try {
      const staleDays = getLinkStaleDays();
      const ing = getIngressoCavi(staleDays);
      const t1 = buildTopologyModel(ing.t1);
      const auto = getAutoMap();
      const vista = computeMapView(t1, { auto: true, members: [], roots: [], head: auto?.head_node ?? null, tweaks: [], expanded: new Set(), orientation: "lr" });
      const m = costruisciModelloCavi(ing, t1, { testaScelta: vista.headChosen ? vista.head : null });
      const tr = calcolaTraccia(padriDi(vista.tree), m);
      return NextResponse.json({
        calcolataIl: oraUtc(new Date()), staleDays,
        letture: LETTURE.map((l) => ({ lettura: l, acceso: leggiInterruttore(l).acceso })),
        ...tr, nomi: nomiTraccia(t1, m, tr),
      }, { headers: NO_STORE });
    } catch (error) {
      console.error("[topology] traccia:", error instanceof Error ? error.message : "errore");
      return NextResponse.json({ error: "Errore nel calcolo di «Cosa cambierebbe con la mappa nuova»" }, { status: 500 });
    }
  });
}
