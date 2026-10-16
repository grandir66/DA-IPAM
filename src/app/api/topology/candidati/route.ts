import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { NO_STORE } from "@/lib/controllers/route-helpers";
import { parseCandidatiQuery } from "@/lib/topology/api-input";
import { candidatiDellaMappa } from "@/lib/topology/mappa-server";
import { getLinkStaleDays } from "@/lib/topology/settings";

/**
 * GET /api/topology/candidati?nodo=dev:N — «Candidati per porta» di un oggetto (spec topologia §13.4.6; piano di T3, «Scelte»
 * 11): una riga per porta con le prove, il collegamento scelto e gli scartati col motivo, al massimo 64 righe e quante restano
 * fuori (e, in ogni riga, al massimo 16 prove e 16 scartati con quanti restano fuori). `{ nodo, righe, altri }`; 400 nodo non
 * valido; 404 un oggetto non più nella mappa; 409 con la mappa nuova spenta (con la mappa di prima non c'è); 500 se il calcolo
 * cade. Calcolata a richiesta: nel modello peserebbe su ogni apertura della pagina. Non scrive niente.
 */
export async function GET(req: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAuth();
    if (isAuthError(s)) return s;
    const nodo = parseCandidatiQuery(new URL(req.url).searchParams);
    if (!nodo.ok) return NextResponse.json({ error: nodo.error }, { status: 400 });
    try {
      const e = candidatiDellaMappa(getLinkStaleDays(), nodo.data);
      if (!e.ok) return NextResponse.json({ error: e.error }, { status: e.status });
      return NextResponse.json({ nodo: nodo.data, righe: e.righe, altri: e.altri }, { headers: NO_STORE });
    } catch (error) {
      console.error("[topology] candidati per porta:", error instanceof Error ? error.message : "errore");
      return NextResponse.json({ error: "Errore nel calcolo dei candidati per porta" }, { status: 500 });
    }
  });
}
