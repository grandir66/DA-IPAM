import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getTopologyData } from "@/lib/db-tenant";
import { modelloDellaMappa } from "@/lib/topology/mappa-server";
import { getLinkStaleDays } from "@/lib/topology/settings";
import { computeStatusByNode, statusForModel } from "@/lib/topology/status-map";
import { NO_STORE } from "@/lib/controllers/route-helpers";

/**
 * GET /api/topology/model — il modello della mappa, con la soglia «non visto» usata e lo stato di ogni nodo. Con l'interruttore
 * della mappa nuova spento è il modello di T1 com'era (`mappa: "oggi"`); acceso, la mappa per cavo (`mappa: "cavi"`, con `cavi`).
 * Se la mappa nuova non si calcola, quella di prima con `mappaErrore` (spec topologia §13.11.4, T3.7; Caso 3 del piano di T3).
 */
export async function GET() {
  return withTenantFromSession(async () => {
    const s = await requireAuth();
    if (isAuthError(s)) return s;
    try {
      const staleDays = getLinkStaleDays();
      const { model, mappa, errore, nowMs } = modelloDellaMappa(staleDays);
      // Un segmento è un nodo calcolato: non ha uno stato suo (nessun apparato da interrogare).
      const status = statusForModel(model.nodes.filter((n) => n.kind !== "segmento"), computeStatusByNode(getTopologyData(), nowMs));
      return NextResponse.json({ ...model, staleDays, status, mappa, ...(errore ? { mappaErrore: errore } : {}) }, { headers: NO_STORE });
    } catch (error) {
      console.error("[topology] modello:", error);
      return NextResponse.json({ error: "Errore nel calcolo del modello della mappa" }, { status: 500 });
    }
  });
}
