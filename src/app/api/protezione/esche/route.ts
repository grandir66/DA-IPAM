import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { indirizzoDaIntestazioni } from "@/lib/accesso/registro-accessi";
import { applicaEsche, escheInVigore, servizioEscheAttivo, statoFiltro } from "@/lib/protezione/esecutore";
import { NOMI_ESCHE } from "@/lib/protezione/esche-elenco";
import { scriviRegistroProtezione } from "@/lib/protezione/registro-protezione";

export const dynamic = "force-dynamic";

const schema = z.object({ accese: z.array(z.enum(NOMI_ESCHE)).max(NOMI_ESCHE.length), lente: z.boolean() });

/** Quali esche sono accese e se il servizio gira. */
export async function GET() {
  const sessione = await requireAdmin();
  if (isAuthError(sessione)) return sessione;
  try {
    const [stato, attivo] = await Promise.all([statoFiltro(), servizioEscheAttivo()]);
    return NextResponse.json({ conf: escheInVigore(), attivo, disponibile: stato.disponibile, motivo: stato.motivo });
  } catch (e) {
    console.error("[protezione] stato delle esche:", e);
    return NextResponse.json({ error: "Stato delle esche non letto" }, { status: 500 });
  }
}

/** Accende e spegne le esche. Un elenco vuoto le spegne tutte e ferma il servizio. */
export async function POST(request: Request) {
  const sessione = await requireAdmin();
  if (isAuthError(sessione)) return sessione;
  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });
  }
  const letto = schema.safeParse(corpo);
  if (!letto.success) return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });
  try {
    const stato = await statoFiltro();
    if (!stato.disponibile) return NextResponse.json({ error: stato.motivo }, { status: 409 });
    const esito = await applicaEsche({ accese: [...new Set(letto.data.accese)], lente: letto.data.lente });
    scriviRegistroProtezione({ azione: "esche", utente: (sessione.user as { name?: string | null }).name ?? "sconosciuto", da: indirizzoDaIntestazioni(request.headers), esito: esito.ok ? "riuscita" : "fallita", dettaglio: esito.messaggio, prima: esito.prima, dopo: esito.dopo });
    return NextResponse.json({ ok: esito.ok, messaggio: esito.messaggio.replace(/^da-ipam-accessi: /, ""), conf: escheInVigore(), attivo: await servizioEscheAttivo() }, { status: esito.ok ? 200 : 409 });
  } catch (e) {
    console.error("[protezione] esche:", e);
    return NextResponse.json({ error: "Esche non applicate: guarda il registro di sistema" }, { status: 500 });
  }
}
