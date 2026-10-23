import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { NO_STORE } from "@/lib/controllers/route-helpers";
import { elenco } from "@/lib/schedulazioni/cambio";

/**
 * GET /api/schedulazioni — tutto ciò che parte da solo per il cliente, con prossimo giro e ultimo esito (tavola del 22/10,
 * oggetti 21-30). Chi non è admin vede tutto (`puoCambiare: false`).
 */
export async function GET() {
  return withTenantFromSession(async () => {
    const s = await requireAuth();
    if (isAuthError(s)) return s;
    try {
      return NextResponse.json(await elenco(s.user.role), { headers: NO_STORE });
    } catch (error) {
      console.error("[schedulazioni] elenco:", error instanceof Error ? error.name : "errore");
      return NextResponse.json({ error: "Errore nella lettura delle schedulazioni" }, { status: 500 });
    }
  });
}
