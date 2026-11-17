import { NextResponse } from "next/server";
import { withTenantFromSession } from "@/lib/api-tenant";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getAdIntegrationById, getRecordDnsAdPaginati } from "@/lib/db-tenant";
import { vistaDnsAd } from "@/lib/ad/dns/vista";
import type { TipoRecordDns } from "@/lib/ad/dns/record";

type Params = { params: Promise<{ id: string }> };
const TIPI: readonly TipoRecordDns[] = ["A", "AAAA", "CNAME", "PTR"];

/** DNS di Active Directory in sola lettura: `vista=anomalie` (di serie) oppure `vista=record` (elenco paginato). */
export async function GET(request: Request, { params }: Params) {
  return withTenantFromSession(async () => {
    const sessione = await requireAuth();
    if (isAuthError(sessione)) return sessione;
    const id = Number.parseInt((await params).id, 10);
    if (!Number.isInteger(id) || !getAdIntegrationById(id)) {
      return NextResponse.json({ error: "Integrazione non trovata" }, { status: 404 });
    }
    try {
      const q = new URL(request.url).searchParams;
      if (q.get("vista") === "record") {
        const pagina = Math.max(1, Number.parseInt(q.get("page") ?? "1", 10) || 1);
        const perPagina = Math.min(100, Math.max(1, Number.parseInt(q.get("pageSize") ?? "25", 10) || 25));
        const tipo = TIPI.find((t) => t === q.get("tipo"));
        return NextResponse.json(getRecordDnsAdPaginati(id, pagina, perPagina, { tipo, zona: q.get("zona") || undefined, cerca: q.get("cerca") || undefined }));
      }
      return NextResponse.json(vistaDnsAd(id));
    } catch (errore) {
      console.error("DNS di AD, lettura dell'archivio:", errore instanceof Error ? errore.message : errore);
      return NextResponse.json({ error: "Errore nella lettura del DNS in archivio" }, { status: 500 });
    }
  });
}
