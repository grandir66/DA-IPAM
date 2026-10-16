import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { NO_STORE } from "@/lib/controllers/route-helpers";
import { rispostaCandidati } from "@/lib/topology/unioni-server";

/**
 * «Unisci con…», la ricerca (piano 2026-10-16, Task 3, «Scelte» 12). GET `?da=host:N|dev:N&q=…`: gli oggetti della mappa con
 * quel testo nel nome, negli alias, negli IP o nei MAC, escluso quello di partenza; da 2 caratteri, 20 risultati e quanti altri
 * (`altri`); due apparati sono `bloccato` col motivo. Non scrive niente.
 */
export async function GET(req: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAuth();
    if (isAuthError(s)) return s;
    try {
      const p = new URL(req.url).searchParams;
      const r = rispostaCandidati(p.get("da"), p.get("q"));
      return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
    } catch (error) {
      console.error("[topology] unioni:", error instanceof Error ? error.message : "errore");
      return NextResponse.json({ error: "Errore nella ricerca degli oggetti da unire" }, { status: 500 });
    }
  });
}
