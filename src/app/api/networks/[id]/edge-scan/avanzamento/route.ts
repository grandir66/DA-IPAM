/**
 * Avanzamento per IP della scansione aperta di una rete (06/11/2026): quanti host finiti, quali in
 * analisi e da quanto, quali da fare. Legge solo dalla sonda (`/api/v1/scans/in-corso`), niente
 * Greenbone. Il lavoro e gli stati stanno in `@/lib/vuln/avanzamento-rotta`; qui guardia e contesto tenant.
 */

import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { leggiAvanzamentoRotta } from "@/lib/vuln/avanzamento-rotta";

type Contesto = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Contesto) {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;

  return withTenantFromSession(async () => {
    const { id } = await ctx.params;
    const networkId = Number(id);
    if (!Number.isInteger(networkId) || networkId <= 0) {
      return NextResponse.json({ error: "ID rete non valido" }, { status: 400 });
    }
    const r = await leggiAvanzamentoRotta(networkId);
    return NextResponse.json(r.body, { status: r.status });
  });
}
