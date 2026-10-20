import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { NO_STORE } from "@/lib/controllers/route-helpers";
import { rispostaArchivio } from "@/lib/hosts/pulizia-server";

/**
 * Archivio degli host tolti dalla pulizia (piano 2026-10-20, Task 4): righe non recuperate, più recenti prima, al
 * massimo 500, e il totale. Solo amministratori: è l'elenco degli host del cliente tolti, con chi li ha tolti.
 */
export async function GET() {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    try {
      const r = rispostaArchivio();
      return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
    } catch (error) {
      console.error("[hosts] archivio, lettura:", error instanceof Error ? error.message : "errore");
      return NextResponse.json({ error: "Errore nella lettura dell'archivio degli host" }, { status: 500 });
    }
  });
}
