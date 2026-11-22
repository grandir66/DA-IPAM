/**
 * Utente abituale degli host (colonna di Apparati, 23/11/2026).
 * GET — gli utenti di AD fra cui scegliere e se il giro degli accessi è acceso. Non scrive.
 * PUT — la scelta a mano su uno o più host: un utente di AD, «condiviso», o di nuovo il calcolo automatico.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { schemaAssegnatariAdPresente } from "@/lib/db-tenant";
import { dbCliente, giroAccessiAcceso, soglieDelCliente } from "@/lib/assegnatari/db";
import { ErroreScelta, impostaUtenteAbituale, utentiSceglibili } from "@/lib/assegnatari/abituale";

const SCHEMA_ASSENTE = "Lo schema degli assegnatari da AD non è aggiornato su questa istanza: vedi il journal del servizio";

export async function GET() {
  return withTenantFromSession(async () => {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;
    try {
      const db = dbCliente();
      if (!schemaAssegnatariAdPresente(db)) return NextResponse.json({ error: SCHEMA_ASSENTE }, { status: 503 });
      return NextResponse.json(
        { giroAcceso: giroAccessiAcceso(db), giorni: soglieDelCliente(db).giorni, utenti: utentiSceglibili(db) },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (e) {
      console.error("[assegnatari] utenti per l'utente abituale:", e);
      return NextResponse.json({ error: "Errore nella lettura degli utenti di AD" }, { status: 500 });
    }
  });
}

const Corpo = z.object({
  hostIds: z.array(z.number().int().positive()).min(1).max(5000),
  scelta: z.discriminatedUnion("modo", [
    z.object({ modo: z.literal("manuale"), account: z.string().min(1).max(256) }),
    z.object({ modo: z.literal("condiviso") }),
    z.object({ modo: z.literal("auto") }),
  ]),
});

export async function PUT(request: Request) {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;
    const p = Corpo.safeParse(await request.json().catch(() => null));
    if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "Scelta non valida" }, { status: 400 });
    try {
      const db = dbCliente();
      if (!schemaAssegnatariAdPresente(db)) return NextResponse.json({ error: SCHEMA_ASSENTE }, { status: 503 });
      const utente = auth.user?.id ? Number(auth.user.id) : null;
      return NextResponse.json(impostaUtenteAbituale(db, p.data.hostIds, p.data.scelta, utente));
    } catch (e) {
      if (e instanceof ErroreScelta) return NextResponse.json({ error: e.message }, { status: 400 });
      console.error("[assegnatari] scelta dell'utente abituale:", e);
      return NextResponse.json({ error: "Scelta non salvata: niente è stato scritto" }, { status: 500 });
    }
  });
}
