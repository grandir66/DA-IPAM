import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { indirizzoDaIntestazioni } from "@/lib/accesso/registro-accessi";
import { DURATE_BLOCCO, motivoNonBloccabile } from "@/lib/protezione/blocco";
import { blocca, bloccati, politicaInVigore, sblocca, statoFiltro } from "@/lib/protezione/esecutore";
import { impostaMaiBloccati, maiBloccati } from "@/lib/protezione/mai-bloccati";
import { tipoIndirizzo } from "@/lib/protezione/politica";
import { scriviRegistroProtezione } from "@/lib/protezione/registro-protezione";
import { indirizziNostri } from "@/lib/protezione/tentativi-job";

export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("azione", [
  z.object({ azione: z.literal("blocca"), indirizzo: z.string().max(64), durata: z.string().max(16) }),
  z.object({ azione: z.enum(["sblocca", "mai", "togli_mai"]), indirizzo: z.string().max(64) }),
]);

/** Chi è bloccato adesso e chi non si blocca mai. */
export async function GET() {
  const sessione = await requireAdmin();
  if (isAuthError(sessione)) return sessione;
  try {
    return NextResponse.json({ bloccati: await bloccati(), mai: maiBloccati() });
  } catch (e) {
    console.error("[protezione] bloccati:", e);
    return NextResponse.json({ error: "Elenco dei bloccati non letto" }, { status: 500 });
  }
}

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
  const dati = letto.data;
  const indirizzo = dati.indirizzo.trim();
  const da = indirizzoDaIntestazioni(request.headers);
  const utente = (sessione.user as { name?: string | null }).name ?? "sconosciuto";
  try {
    if (dati.azione === "mai" || dati.azione === "togli_mai") {
      if (tipoIndirizzo(indirizzo) === null) return NextResponse.json({ error: `«${indirizzo}» non è un indirizzo né una rete ammessa` }, { status: 400 });
      const prima = maiBloccati();
      const dopo = dati.azione === "mai" ? [...new Set([...prima, indirizzo])] : prima.filter((x) => x !== indirizzo);
      impostaMaiBloccati(dopo);
      // Chi entra fra i «mai bloccati» esce subito dal blocco, se c'era.
      if (dati.azione === "mai" && !indirizzo.includes("/")) await sblocca(indirizzo);
      scriviRegistroProtezione({ azione: "mai_bloccati", utente, da, esito: "riuscita", prima: prima.join(","), dopo: dopo.join(",") });
      return NextResponse.json({ ok: true, messaggio: dati.azione === "mai" ? `${indirizzo} non verrà mai bloccato.` : `${indirizzo} tolto dai «mai bloccati».` });
    }
    if (tipoIndirizzo(indirizzo) === null || indirizzo.includes("/")) return NextResponse.json({ error: `«${indirizzo}» non è un indirizzo` }, { status: 400 });
    const stato = await statoFiltro();
    if (!stato.disponibile) return NextResponse.json({ error: stato.motivo }, { status: 409 });
    if (dati.azione === "blocca") {
      const secondi = DURATE_BLOCCO[dati.durata];
      if (!secondi) return NextResponse.json({ error: "Durata non ammessa" }, { status: 400 });
      const motivo = motivoNonBloccabile(indirizzo, { sempre: politicaInVigore().sempre, mai: maiBloccati(), nostri: indirizziNostri(), chiamante: da });
      if (motivo) return NextResponse.json({ error: `${indirizzo} non si blocca. ${motivo}` }, { status: 409 });
      const esito = await blocca(indirizzo, secondi);
      scriviRegistroProtezione({ azione: "blocca", utente, da, esito: esito.ok ? "riuscita" : "fallita", dettaglio: `${indirizzo} per ${dati.durata}: ${esito.messaggio}` });
      return NextResponse.json({ ok: esito.ok, messaggio: esito.ok ? `${indirizzo} bloccato per ${dati.durata}.` : esito.messaggio }, { status: esito.ok ? 200 : 409 });
    }
    const esito = await sblocca(indirizzo);
    scriviRegistroProtezione({ azione: "sblocca", utente, da, esito: esito.ok ? "riuscita" : "fallita", dettaglio: `${indirizzo}: ${esito.messaggio}` });
    return NextResponse.json({ ok: esito.ok, messaggio: esito.messaggio }, { status: esito.ok ? 200 : 409 });
  } catch (e) {
    console.error("[protezione] blocco:", e);
    return NextResponse.json({ error: "Azione non riuscita: guarda il registro di sistema" }, { status: 500 });
  }
}
