import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { NO_STORE } from "@/lib/controllers/route-helpers";
import { cosaNonVa } from "@/lib/traffico/connessioni";

const PERIODI = [1, 7, 30];

/** GET /api/traffico/connessioni?giorni= — cosa non va: chi bussa a vuoto, i servizi che rifiutano o non
 * rispondono, i servizi lenti. Indizi presi dall'apertura delle connessioni, non misure esatte. */
export async function GET(req: Request) {
  const s = await requireAuth();
  if (isAuthError(s)) return s;
  return withTenantFromSession(() => {
    const giorni = Number(new URL(req.url).searchParams.get("giorni") ?? 1);
    if (!PERIODI.includes(giorni)) return NextResponse.json({ error: "Periodo non valido" }, { status: 400 });
    try {
      return NextResponse.json(cosaNonVa(giorni), { headers: NO_STORE });
    } catch (e) {
      console.error("[traffico] cosa non va:", e instanceof Error ? e.message : e);
      return NextResponse.json({ error: "Errore nel recupero delle connessioni" }, { status: 500 });
    }
  });
}
