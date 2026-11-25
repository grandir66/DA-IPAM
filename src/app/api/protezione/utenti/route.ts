import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { getUserById } from "@/lib/db-hub";
import { erroriElencoUtente, impostaIndirizziUtente, indirizziDellUtente, puoEntrareDa } from "@/lib/accesso/indirizzi-utente";
import { indirizzoDaIntestazioni } from "@/lib/accesso/registro-accessi";
import { scriviRegistroProtezione } from "@/lib/protezione/registro-protezione";

export const dynamic = "force-dynamic";

const schema = z.object({ utenteId: z.number().int().positive(), indirizzi: z.array(z.string().max(64)).max(64) });

/** Imposta «Solo da questi indirizzi» per un utente; elenco vuoto = entra da ovunque. */
export async function PUT(request: Request) {
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
  const { utenteId } = letto.data;
  const indirizzi = letto.data.indirizzi.map((x) => x.trim()).filter(Boolean);
  const errori = erroriElencoUtente(indirizzi);
  if (errori.length > 0) return NextResponse.json({ error: errori.join("; ") }, { status: 400 });
  try {
    const utente = getUserById(utenteId);
    if (!utente) return NextResponse.json({ error: "Utente non trovato" }, { status: 404 });
    const chi = sessione.user as { id?: string; name?: string | null };
    const da = indirizzoDaIntestazioni(request.headers);
    // Chi cambia il proprio elenco non può togliersi l'indirizzo da cui sta lavorando: si chiuderebbe fuori.
    if (String(chi.id ?? "") === String(utenteId) && !puoEntrareDa(indirizzi, da)) {
      return NextResponse.json({ error: `Ti chiuderesti fuori: il tuo indirizzo (${da ?? "non letto"}) non è nell'elenco.` }, { status: 409 });
    }
    const prima = indirizziDellUtente(utenteId);
    impostaIndirizziUtente(utenteId, indirizzi);
    scriviRegistroProtezione({ azione: "indirizzi_utente", utente: chi.name ?? "sconosciuto", da, esito: "riuscita", dettaglio: `utente ${utente.username}`, prima: prima.join(","), dopo: indirizzi.join(",") });
    return NextResponse.json({ ok: true, indirizzi });
  } catch (e) {
    console.error("[protezione] indirizzi dell'utente:", e);
    return NextResponse.json({ error: "Elenco non salvato" }, { status: 500 });
  }
}
