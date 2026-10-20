import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { actorOf, NO_STORE } from "@/lib/controllers/route-helpers";
import { rispostaRecupera } from "@/lib/hosts/pulizia-server";

/**
 * Rimette fra gli host una riga dell'archivio (piano 2026-10-20, Task 4): id nuovo, offline. 409 col `motivo` se si
 * rifiuta (IP di nuovo occupato, rete cancellata, IP escluso, già recuperato): in quel caso non scrive niente.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    const { id } = await params;
    try {
      const r = rispostaRecupera(id, actorOf(s) ?? "amministratore");
      return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
    } catch (error) {
      console.error("[hosts] archivio, recupero:", error instanceof Error ? error.name : "errore");
      return NextResponse.json({ error: "Errore nel recupero dell'host dall'archivio: niente è cambiato" }, { status: 500 });
    }
  });
}
