import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { actorOf, NO_STORE, readJson } from "@/lib/controllers/route-helpers";
import { rispostaAnteprima, rispostaApplica } from "@/lib/hosts/pulizia-server";

/**
 * Pulizia degli host assenti (piano 2026-10-20, Task 4). Solo amministratori, anche l'anteprima: elenca che cosa
 * verrebbe tolto dal cliente. GET = prova a vuoto, non scrive. POST `{ ids, conferma }` archivia i candidati di
 * adesso fra gli `ids` (400 se `conferma` non è il numero di id). Logica in `src/lib/hosts/pulizia-server.ts`.
 */
export async function GET() {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    try {
      const r = rispostaAnteprima();
      return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
    } catch (error) {
      console.error("[hosts] pulizia, anteprima:", error instanceof Error ? error.message : "errore");
      return NextResponse.json({ error: "Errore nel calcolo dell'anteprima della pulizia" }, { status: 500 });
    }
  });
}

export async function POST(req: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    try {
      const r = rispostaApplica(await readJson(req), actorOf(s) ?? "amministratore");
      if (r.status === 500) console.error("[hosts] pulizia, applica interrotta a metà (dettaglio nel registro della pulizia)");
      return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
    } catch (error) {
      // Qui arrivano solo errori di prima della prima scrittura (lettura dei candidati e dei nomi): quelli di
      // archiviaHost e della cancellazione dell'archivio li trasforma applicaPulizia in ErroreApplica (500 con l'elenco).
      // Senza il messaggio: può contenere nomi e IP degli host del cliente (niente PII nei log).
      console.error("[hosts] pulizia, applica:", error instanceof Error ? error.name : "errore");
      return NextResponse.json({ error: "Errore nell'archiviazione degli host: nessun host archiviato" }, { status: 500 });
    }
  });
}
