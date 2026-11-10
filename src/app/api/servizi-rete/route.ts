import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { elencoServiziRete } from "@/lib/servizi-rete/elenco";
import { statoGiro } from "@/lib/servizi-rete/giro";

/**
 * I servizi di rete del tenant: una pagina di righe coi rilievi della porta, oppure i gruppi
 * (`raggruppa=porta|prodotto|host|rete`), più indicatori, conteggi e stato del giro delle sonde.
 */
export async function GET(request: Request) {
  const sessione = await requireAuth();
  if (isAuthError(sessione)) return sessione;
  return withTenantFromSession(() => {
    const sp = new URL(request.url).searchParams;
    const intero = (k: string) => {
      const n = Number(sp.get(k));
      return Number.isInteger(n) && n > 0 ? n : undefined;
    };
    try {
      const tenant = getCurrentTenantCode();
      return NextResponse.json({
        ...elencoServiziRete({
          q: sp.get("q") ?? undefined,
          networkId: intero("network_id"),
          hostId: intero("host_id"),
          porta: intero("porta"),
          prodotto: sp.get("prodotto") ?? undefined,
          tipo: sp.get("tipo") ?? undefined,
          segnale: sp.get("segnale") ?? undefined,
          raggruppa: sp.get("raggruppa") ?? undefined,
          conRilievi: sp.get("rilievi") === "1",
          limit: Math.min(intero("limit") ?? 100, 500),
          pagina: intero("page") ?? 1,
        }),
        giro: tenant ? statoGiro(tenant) : null,
      });
    } catch (e) {
      console.error("[servizi-rete] elenco:", e);
      return NextResponse.json({ error: "Errore nel recupero dei servizi di rete" }, { status: 500 });
    }
  });
}
