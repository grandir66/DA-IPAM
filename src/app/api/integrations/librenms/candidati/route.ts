import { NextResponse } from "next/server";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { rispostaAggiungiCandidato, rispostaCandidati } from "@/lib/integrations/librenms-rotte";

/**
 * GET /api/integrations/librenms/candidati — apparati in LibreNMS mai interrogati, aggiunte rifiutate col motivo, vicini da
 * aggiungere, stato della lettura per parte (piano 2026-10-22 LibreNMS, task 5). POST `{ host_id }` (admin) aggiunge un
 * candidato a LibreNMS, senza `force_add`: un rifiuto è 422 col motivo.
 */
export async function GET() {
  return withTenantFromSession(async () => {
    const s = await requireAuth();
    if (isAuthError(s)) return s;
    try {
      const r = rispostaCandidati();
      return NextResponse.json(r.corpo, { status: r.status });
    } catch (error) {
      console.error("[librenms] candidati:", error instanceof Error ? error.message : "errore");
      return NextResponse.json({ error: "Errore nella lettura dei candidati di LibreNMS" }, { status: 500 });
    }
  });
}

export async function POST(req: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    const corpo: unknown = await req.json().catch(() => null);
    try {
      const r = await rispostaAggiungiCandidato(corpo);
      return NextResponse.json(r.corpo, { status: r.status });
    } catch (error) {
      console.error("[librenms] aggiunta di un candidato:", error instanceof Error ? error.message : "errore");
      return NextResponse.json({ error: "Errore nell'aggiunta a LibreNMS" }, { status: 500 });
    }
  });
}
