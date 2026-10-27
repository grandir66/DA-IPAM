import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { rispostaEsclusione } from "@/lib/integrations/librenms-rotte";

/**
 * POST /api/hosts/[id]/librenms/esclusione — «Non aggiungere a LibreNMS»: l'oggetto esce dai candidati del giro
 * automatico (22/10). DELETE toglie l'esclusione. Un'aggiunta chiesta a mano resta possibile.
 */
async function rispondi(params: Promise<{ id: string }>, escludi: boolean) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    const { id } = await params;
    try {
      const r = rispostaEsclusione(id, escludi);
      return NextResponse.json(r.corpo, { status: r.status });
    } catch (error) {
      console.error("[librenms] esclusione dell'host:", error instanceof Error ? error.message : "errore");
      return NextResponse.json({ error: "Errore nel salvataggio dell'esclusione da LibreNMS" }, { status: 500 });
    }
  });
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return rispondi(params, true);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return rispondi(params, false);
}
