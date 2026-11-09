import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode, getCelleMatrice, getConteggiSegmentazione, getVistaServizioMatrice } from "@/lib/db-tenant";
import { statoGiroSeg } from "@/lib/segmentazione/giro";

/** Matrice di segmentazione dell'ultimo giro riuscito, con i conteggi e lo stato del giro. */
export async function GET() {
  const sessione = await requireAuth();
  if (isAuthError(sessione)) return sessione;
  return withTenantFromSession(() => {
    try {
      const tenant = getCurrentTenantCode();
      return NextResponse.json({
        celle: getCelleMatrice(),
        conteggi: getConteggiSegmentazione(),
        servizi: getVistaServizioMatrice(),
        giro: tenant ? statoGiroSeg(tenant) : null,
      });
    } catch (e) {
      console.error("[segmentazione] elenco:", e);
      return NextResponse.json({ error: "Errore nel recupero della matrice di segmentazione" }, { status: 500 });
    }
  });
}
