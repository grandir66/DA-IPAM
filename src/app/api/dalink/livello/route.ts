import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { impostaLivello, livelloAttuale } from "@/lib/dalink/stato";
import { inviaAdesso } from "@/lib/dalink/segnale-job";

/**
 * Livello di cosa esce verso DA-Link (tappa C1, spec NetBird §5.3, decisione 13).
 * Lo cambia solo un amministratore dell'istanza; ogni cambio è una riga nuova del
 * registro, con chi e quando. Non esiste un'altra strada: niente API da DA-Link o dal
 * CRM, e la rotta generica delle impostazioni non lo tocca (tabella propria).
 * Dopo il cambio parte subito un segnale, così la conferma di DA-Link arriva presto.
 */
const Corpo = z.object({ livello: z.enum(["solo_stato", "stato_inventario"]) });

export async function PUT(request: Request) {
  const sessione = await requireAdmin();
  if (isAuthError(sessione)) return sessione;
  const body = await request.json().catch(() => null);
  const parsed = Corpo.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Livello non ammesso: solo_stato oppure stato_inventario" }, { status: 400 });
  }
  const u = sessione.user;
  const chi = (u.name || u.email || (u.id ? `utente ${u.id}` : "")).trim() || "amministratore";
  try {
    impostaLivello(parsed.data.livello, chi);
  } catch (error) {
    console.error("[dalink] livello non salvato:", error instanceof Error ? error.message : "errore");
    return NextResponse.json({ error: "Livello non salvato" }, { status: 500 });
  }
  inviaAdesso().catch(() => {
    // L'esito del giro finisce nello stato del segnale, che la pagina rilegge.
  });
  return NextResponse.json({ livello: livelloAttuale() });
}
