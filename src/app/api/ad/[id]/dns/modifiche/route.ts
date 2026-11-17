import { NextResponse } from "next/server";
import { withTenantFromSession } from "@/lib/api-tenant";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getModificheDnsAd } from "@/lib/db-tenant";
import { integrazioneDa } from "@/lib/ad/dns/rotte";

type Params = { params: Promise<{ id: string }> };

/** Registro delle correzioni fatte sul DNS di questo dominio, le più recenti prima. */
export async function GET(request: Request, { params }: Params) {
  return withTenantFromSession(async () => {
    const sessione = await requireAuth();
    if (isAuthError(sessione)) return sessione;
    const integrazione = await integrazioneDa(params);
    if (integrazione instanceof NextResponse) return integrazione;
    const q = new URL(request.url).searchParams;
    const pagina = Math.max(1, Number.parseInt(q.get("page") ?? "1", 10) || 1);
    const perPagina = Math.min(100, Math.max(1, Number.parseInt(q.get("pageSize") ?? "25", 10) || 25));
    return NextResponse.json(getModificheDnsAd(integrazione.id, pagina, perPagina));
  });
}
