import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode, getServiziRetePaginati, getConteggiServiziRete } from "@/lib/db-tenant";
import { statoGiro } from "@/lib/servizi-rete/giro";

/** Elenco paginato dei servizi di rete del tenant, con i conteggi e lo stato del giro delle sonde. */
export async function GET(request: Request) {
  const sessione = await requireAuth();
  if (isAuthError(sessione)) return sessione;
  return withTenantFromSession(() => {
    const sp = new URL(request.url).searchParams;
    const intero = (k: string) => {
      const n = Number(sp.get(k));
      return Number.isInteger(n) && n > 0 ? n : undefined;
    };
    const limit = Math.min(intero("limit") ?? 100, 500);
    const pagina = intero("page") ?? 1;
    const networkId = intero("network_id");
    try {
      const { righe, totale } = getServiziRetePaginati({
        q: sp.get("q") ?? undefined,
        networkId,
        hostId: intero("host_id"),
        porta: intero("porta"),
        tipo: sp.get("tipo") ?? undefined,
        limit,
        offset: (pagina - 1) * limit,
      });
      const tenant = getCurrentTenantCode();
      return NextResponse.json({
        righe,
        totale,
        conteggi: getConteggiServiziRete(networkId),
        giro: tenant ? statoGiro(tenant) : null,
      });
    } catch (e) {
      console.error("[servizi-rete] elenco:", e);
      return NextResponse.json({ error: "Errore nel recupero dei servizi di rete" }, { status: 500 });
    }
  });
}
