/**
 * L'assegnatario proposto per un asset (piano 2026-10-23-assegnatari-da-ad, passo 5; tavola ⑫-⑱).
 * GET  — esito, persona prevalente con i conteggi per fonte, chi è assegnato, la tabella degli accessi. Non scrive.
 * POST — `{ azione: "accetta", account }` assegna la persona proposta; `{ azione: "condiviso", condiviso }` segna il PC
 *        come condiviso (niente proposte) o lo toglie. Scrive solo qui, dopo il clic, con una riga nel diario.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { schemaAssegnatariAdPresente } from "@/lib/db-tenant";
import { dbCliente } from "@/lib/assegnatari/db";
import { ErroreProposta, accettaProposta, propostaPerAsset, segnaCondiviso } from "@/lib/assegnatari/asset";

const SCHEMA_ASSENTE = "Lo schema degli assegnatari da AD non è aggiornato su questo cliente: vedi il journal del servizio";

function idAsset(raw: string): number | null {
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;
    const id = idAsset((await params).id);
    if (id === null) return NextResponse.json({ error: "Asset non valido" }, { status: 400 });
    const g = new URL(request.url).searchParams.get("giorni");
    const giorni = g === null ? undefined : Number(g);
    if (giorni !== undefined && ![30, 90].includes(giorni)) return NextResponse.json({ error: "Periodo non ammesso: 30 o 90 giorni" }, { status: 400 });
    try {
      const db = dbCliente();
      if (!schemaAssegnatariAdPresente(db)) return NextResponse.json({ error: SCHEMA_ASSENTE }, { status: 503 });
      const p = propostaPerAsset(db, id, giorni);
      if (!p) return NextResponse.json({ error: "Asset non trovato" }, { status: 404 });
      return NextResponse.json(p, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      console.error("[assegnatari] proposta per asset:", e);
      return NextResponse.json({ error: "Errore nel calcolo della proposta" }, { status: 500 });
    }
  });
}

const Corpo = z.discriminatedUnion("azione", [
  z.object({ azione: z.literal("accetta"), account: z.string().min(1).max(256) }),
  z.object({ azione: z.literal("condiviso"), condiviso: z.boolean() }),
]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;
    const id = idAsset((await params).id);
    if (id === null) return NextResponse.json({ error: "Asset non valido" }, { status: 400 });
    const p = Corpo.safeParse(await request.json().catch(() => null));
    if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "Richiesta non valida" }, { status: 400 });
    const utente = auth.user?.id ? Number(auth.user.id) : null;
    try {
      const db = dbCliente();
      if (!schemaAssegnatariAdPresente(db)) return NextResponse.json({ error: SCHEMA_ASSENTE }, { status: 503 });
      if (p.data.azione === "accetta") return NextResponse.json(accettaProposta(db, id, p.data.account, utente));
      segnaCondiviso(db, id, p.data.condiviso, utente);
      return NextResponse.json({ ok: true });
    } catch (e) {
      if (e instanceof ErroreProposta) return NextResponse.json({ error: e.message }, { status: e.status });
      console.error("[assegnatari] scrittura proposta:", e);
      return NextResponse.json({ error: "Operazione non riuscita: niente è stato scritto" }, { status: 500 });
    }
  });
}
