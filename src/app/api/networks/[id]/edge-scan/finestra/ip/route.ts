/**
 * Elenco degli indirizzi dell'ultimo passaggio di una finestra (05/11/2026), una pagina alla volta,
 * letto dalla sonda. `?stato=` filtra (da_fare, in_prova, finito, non_risponde, assente, non_finito),
 * `limit` da 1 a 1000, `offset` da 0. Controlli e risposte in `@/lib/vuln/finestra-rotte`.
 *
 * Risponde 200 col suo `stato` («ok», «da_aggiornare», «errore»): il pannello dice quale.
 */

import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { elencoIpRotta } from "@/lib/vuln/finestra-rotte";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;

  return withTenantFromSession(async () => {
    const { id } = await params;
    const networkId = Number(id);
    if (!Number.isInteger(networkId) || networkId <= 0) {
      return NextResponse.json({ error: "ID rete non valido" }, { status: 400 });
    }
    const r = await elencoIpRotta(networkId, new URL(req.url).searchParams);
    return NextResponse.json(r.body, { status: r.status });
  });
}
