/**
 * GET /api/asset-assignees/elenco — l'elenco paginato della pagina Assegnatari, con reparto, ruolo, origine, stato in AD
 * e numero di asset, e l'avviso degli assegnatari usciti da AD che hanno ancora asset (piano 2026-10-23, tavola ①-④).
 * `GET /api/asset-assignees` resta com'era: l'elenco intero per le tendine delle schede.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { schemaAssegnatariAdPresente } from "@/lib/db-tenant";
import { dbCliente, elencoAssegnatari } from "@/lib/assegnatari/db";

const Filtri = z.object({
  origine: z.enum(["tutte", "ad", "manuale"]).default("tutte"),
  q: z.string().max(200).optional(),
  usciti: z.enum(["0", "1"]).default("0"),
  pagina: z.coerce.number().int().min(1).max(10_000).default(1),
  perPagina: z.coerce.number().int().min(10).max(200).default(50),
});

export async function GET(request: Request) {
  return withTenantFromSession(async () => {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;
    const q = Filtri.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!q.success) return NextResponse.json({ error: q.error.issues[0]?.message ?? "Filtri non validi" }, { status: 400 });
    try {
      const db = dbCliente();
      if (!schemaAssegnatariAdPresente(db)) {
        return NextResponse.json({ error: "Lo schema degli assegnatari non è aggiornato su questo cliente: vedi il journal del servizio" }, { status: 503 });
      }
      const f = q.data;
      return NextResponse.json(elencoAssegnatari(db, {
        origine: f.origine === "tutte" ? null : f.origine,
        cerca: f.q ?? null,
        soloUsciti: f.usciti === "1",
        pagina: f.pagina,
        perPagina: f.perPagina,
      }));
    } catch (e) {
      console.error("[assegnatari] elenco:", e);
      return NextResponse.json({ error: "Errore nel recupero degli assegnatari" }, { status: 500 });
    }
  });
}
