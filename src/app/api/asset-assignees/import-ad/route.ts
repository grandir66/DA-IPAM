/**
 * «Importa da Active Directory» (piano 2026-10-23-assegnatari-da-ad, passo 5).
 * GET  — anteprima: esito per utente (nuovo, da aggiornare, da controllare, invariato), esclusi col motivo, paginata.
 * POST — importa i selezionati (chiavi «integrazione:guid») in una transazione; non tocca gli asset.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { schemaAssegnatariAdPresente } from "@/lib/db-tenant";
import { dbCliente } from "@/lib/assegnatari/db";
import { anteprimaImport, importaDaAd } from "@/lib/assegnatari/importa";

const SCHEMA_ASSENTE = "Lo schema degli assegnatari da AD non è aggiornato su questo cliente: vedi il journal del servizio";

const Filtri = z.object({
  abilitati: z.enum(["0", "1"]).default("1"),
  nomeCognome: z.enum(["0", "1"]).default("1"),
  giorni: z.enum(["30", "90", "180", "sempre"]).default("90"),
  ou: z.string().max(500).optional(),
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
      return NextResponse.json(anteprimaImport(db, {
        soloAbilitati: f.abilitati === "1",
        conNomeCognome: f.nomeCognome === "1",
        giorniAccesso: f.giorni === "sempre" ? null : Number(f.giorni),
        ou: f.ou?.trim() || null,
      }, f.pagina, f.perPagina));
    } catch (e) {
      console.error("[assegnatari] anteprima importazione AD:", e);
      return NextResponse.json({ error: "Errore nella lettura degli utenti di Active Directory" }, { status: 500 });
    }
  });
}

const Corpo = z.object({ chiavi: z.array(z.string().regex(/^\d+:[0-9a-fA-F-]{8,64}$/)).min(1).max(5000) });

export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;
    const body = await request.json().catch(() => null);
    const p = Corpo.safeParse(body);
    if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "Selezione non valida" }, { status: 400 });
    try {
      const db = dbCliente();
      if (!schemaAssegnatariAdPresente(db)) return NextResponse.json({ error: SCHEMA_ASSENTE }, { status: 503 });
      return NextResponse.json(importaDaAd(db, p.data.chiavi));
    } catch (e) {
      console.error("[assegnatari] importazione AD:", e);
      return NextResponse.json({ error: "Importazione non riuscita: nessun assegnatario è stato scritto" }, { status: 500 });
    }
  });
}
