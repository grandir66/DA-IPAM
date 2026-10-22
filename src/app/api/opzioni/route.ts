import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { NO_STORE } from "@/lib/controllers/route-helpers";
import { elencoOpzioni } from "@/lib/opzioni/cambio";

/**
 * GET /api/opzioni — ogni funzione che si accende o si spegne, con lo stato letto dal sistema vivo (spec pagina Opzioni
 * §3.3). Chi non è admin vede tutto (`puoCambiare: false`).
 */
export async function GET() {
  return withTenantFromSession(async () => {
    const s = await requireAuth();
    if (isAuthError(s)) return s;
    try {
      return NextResponse.json(await elencoOpzioni(s.user.role), { headers: NO_STORE });
    } catch (error) {
      console.error("[opzioni] elenco:", error instanceof Error ? error.name : "errore");
      return NextResponse.json({ error: "Errore nella lettura delle opzioni" }, { status: 500 });
    }
  });
}
