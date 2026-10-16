import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { actorOf, NO_STORE, readJson } from "@/lib/controllers/route-helpers";
import { rispostaSeparazione } from "@/lib/topology/unioni-server";

/**
 * «Separa…» (piano 2026-10-16, Task 3; ADR 0021). POST `{ nodo, membro, applica }`, solo un amministratore anche per
 * l'anteprima: l'indirizzo `membro` («host:N») esce dall'oggetto `nodo` della mappa. `applica: false` dice dove finiscono il
 * membro e chi c'era per lui, e non scrive; `applica: true` toglie le righe (mai cancellate: `tolto_da`/`tolto_il`) e scrive le
 * coppie che non si fondono più da sole (409 se nel frattempo le unioni sono cambiate).
 */
export async function POST(req: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    try {
      const r = rispostaSeparazione(await readJson(req), actorOf(s) ?? "amministratore");
      return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
    } catch (error) {
      console.error("[topology] unioni:", error instanceof Error ? error.message : "errore");
      return NextResponse.json({ error: "Errore nel salvataggio della separazione" }, { status: 500 });
    }
  });
}
