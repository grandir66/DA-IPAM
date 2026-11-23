import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getTopologyTavolaPorte } from "@/lib/db-tenant";
import { modelloDellaMappa } from "@/lib/topology/mappa-server";
import { getLinkStaleDays } from "@/lib/topology/settings";
import { SENZA_SEDE, parseSitoTavola, ritagliaSito } from "@/lib/topology/tavola/api";
import type { TavolaView } from "@/lib/topology/tavola/tipi";
import { NO_STORE } from "@/lib/controllers/route-helpers";

/**
 * GET /api/topology/tavola?site=<id> (assente: il primo sito) — la «Tavola di cablaggio» di un sito (spec 2026-11-23 §2), sola lettura: i nodi e i
 * collegamenti del modello della mappa che toccano il sito (lo stesso calcolo di /api/topology/model, niente di nuovo) e
 * le porte di tutti i suoi apparati in una query. Un sito senza apparati dà `apparati: []`; un `site` non numerico 400.
 */
export async function GET(req: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAuth();
    if (isAuthError(s)) return s;
    const sito = parseSitoTavola(new URL(req.url).searchParams.get("site"));
    if (!sito.ok) return NextResponse.json({ error: sito.error }, { status: 400 });
    try {
      const staleDays = getLinkStaleDays();
      const { model } = modelloDellaMappa(staleDays);
      const scelto = sito.data ?? ritagliaSito(model, SENZA_SEDE).siti[0]?.id ?? SENZA_SEDE;
      const r = ritagliaSito(model, scelto);
      const view: TavolaView = { site: scelto, siti: r.siti, nodi: r.nodi, collegamenti: r.collegamenti, apparati: getTopologyTavolaPorte(r.deviceIds), staleDays };
      return NextResponse.json(view, { headers: NO_STORE });
    } catch (error) {
      console.error("[topology] tavola:", error);
      return NextResponse.json({ error: "Errore nella lettura della tavola di cablaggio" }, { status: 500 });
    }
  });
}
