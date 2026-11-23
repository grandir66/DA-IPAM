import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { NO_STORE } from "@/lib/controllers/route-helpers";
import { retiViste } from "@/lib/traffico/oggetti";

const PERIODI = [1, 7, 30];

/** GET /api/traffico/reti-viste?giorni= — gli indirizzi interni visti nel traffico e fuori dalle reti censite,
 * raggruppati per rete (/24, o l'oggetto con nome che li contiene). */
export async function GET(req: Request) {
  const s = await requireAuth();
  if (isAuthError(s)) return s;
  return withTenantFromSession(() => {
    const giorni = Number(new URL(req.url).searchParams.get("giorni") ?? 7);
    if (!PERIODI.includes(giorni)) return NextResponse.json({ error: "Periodo non valido" }, { status: 400 });
    try {
      return NextResponse.json(retiViste(giorni), { headers: NO_STORE });
    } catch (e) {
      console.error("[traffico] reti viste:", e instanceof Error ? e.message : e);
      return NextResponse.json({ error: "Errore nel recupero delle reti viste" }, { status: 500 });
    }
  });
}
