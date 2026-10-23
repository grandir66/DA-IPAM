/**
 * Abbinamenti PC → persona → asset e assegnatario (piano 2026-10-23-abbinamenti, tavola ⑲-㉔).
 * GET  — i gruppi con i contatori, una pagina di voci e il riepilogo di tutti i proposti. Non scrive.
 * POST — conferma le voci scelte in una transazione: assegnatario da AD e asset se mancano, assegnazione, diario.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { schemaAssegnatariAdPresente } from "@/lib/db-tenant";
import { dbCliente } from "@/lib/assegnatari/db";
import { CATEGORIE_NUOVO_ASSET, confermaAbbinamenti, elencoAbbinamenti } from "@/lib/assegnatari/abbinamenti";

const SCHEMA_ASSENTE = "Lo schema degli assegnatari da AD non è aggiornato su questa istanza: vedi il journal del servizio";

const Filtri = z.object({
  gruppo: z.enum(["proposto", "da_rivedere", "abbinato", "pochi_dati", "escluso", "tutti"]).default("proposto"),
  senzaAsset: z.enum(["0", "1"]).default("0"),
  q: z.string().max(200).optional(),
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
      if (!schemaAssegnatariAdPresente(db)) return NextResponse.json({ error: SCHEMA_ASSENTE }, { status: 503 });
      const f = q.data;
      return NextResponse.json(
        elencoAbbinamenti(db, { gruppo: f.gruppo, soloSenzaAsset: f.senzaAsset === "1", cerca: f.q ?? null, pagina: f.pagina, perPagina: f.perPagina }),
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (e) {
      console.error("[assegnatari] abbinamenti:", e);
      return NextResponse.json({ error: "Errore nel calcolo degli abbinamenti" }, { status: 500 });
    }
  });
}

const Corpo = z.object({
  voci: z.array(z.object({
    hostId: z.number().int().positive(),
    account: z.string().min(1).max(256),
    categoria: z.enum(CATEGORIE_NUOVO_ASSET as [string, ...string[]]).optional(),
  })).min(1).max(2000),
});

export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;
    const p = Corpo.safeParse(await request.json().catch(() => null));
    if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "Selezione non valida" }, { status: 400 });
    try {
      const db = dbCliente();
      if (!schemaAssegnatariAdPresente(db)) return NextResponse.json({ error: SCHEMA_ASSENTE }, { status: 503 });
      const utente = auth.user?.id ? Number(auth.user.id) : null;
      return NextResponse.json(confermaAbbinamenti(db, p.data.voci as Parameters<typeof confermaAbbinamenti>[1], utente));
    } catch (e) {
      console.error("[assegnatari] conferma abbinamenti:", e);
      return NextResponse.json({ error: "Conferma non riuscita: niente è stato scritto" }, { status: 500 });
    }
  });
}
