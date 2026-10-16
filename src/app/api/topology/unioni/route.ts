import { NextResponse } from "next/server";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { actorOf, NO_STORE, readJson } from "@/lib/controllers/route-helpers";
import { rispostaStato, rispostaUnione } from "@/lib/topology/unioni-server";

/**
 * Unioni a mano (piano 2026-10-16, Task 3; ADR 0021). GET `?oggetto=host:N|dev:N`: lo stato sulla mappa di quell'oggetto (il
 * nodo, i membri col perché, se si separano, chi e quando li ha uniti; `disponibile: false` senza le tabelle). POST `{ membri,
 * applica }`, solo un amministratore anche per l'anteprima: `applica: false` dice che cosa succederebbe e non scrive, `applica:
 * true` scrive (409 se nel frattempo le unioni sono cambiate). Chi e quando stanno nelle righe: nessun registro in più.
 */
export async function GET(req: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAuth();
    if (isAuthError(s)) return s;
    try {
      const r = rispostaStato(new URL(req.url).searchParams.get("oggetto"));
      return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
    } catch (error) {
      console.error("[topology] unioni:", error instanceof Error ? error.message : "errore");
      return NextResponse.json({ error: "Errore nella lettura dell'oggetto sulla mappa" }, { status: 500 });
    }
  });
}

export async function POST(req: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    try {
      const r = rispostaUnione(await readJson(req), actorOf(s) ?? "amministratore");
      return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
    } catch (error) {
      console.error("[topology] unioni:", error instanceof Error ? error.message : "errore");
      return NextResponse.json({ error: "Errore nel salvataggio dell'unione" }, { status: 500 });
    }
  });
}
