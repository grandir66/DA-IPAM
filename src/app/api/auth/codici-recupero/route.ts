import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getUserByUsername, usaPassoTotp } from "@/lib/db-hub";
import { safeDecifraAccesso } from "@/lib/crypto";
import { verificaTotp } from "@/lib/accesso/totp";
import { codiciRecuperoRimasti, generaCodiciRecupero } from "@/lib/accesso/codici-recupero";
import { scriviRegistroAccessi } from "@/lib/accesso/registro-accessi";

const NO_STORE = { "Cache-Control": "no-store" };
const Corpo = z.object({ codice: z.string().min(6).max(7) });

/** Quanti codici di recupero restano all'utente collegato, e se può averne (verifica in due passaggi attiva). */
export async function GET() {
  const s = await requireAuth();
  if (isAuthError(s)) return s;
  const u = s.user.name ? getUserByUsername(s.user.name) : undefined;
  if (!u) return NextResponse.json({ attiva: false, rimasti: 0 }, { headers: NO_STORE });
  return NextResponse.json({ attiva: Boolean(u.totp_segreto), rimasti: codiciRecuperoRimasti(u.id) }, { headers: NO_STORE });
}

/**
 * Genera otto codici nuovi per l'utente collegato e annulla i precedenti. Chiede il codice dell'app: chi trova
 * una sessione aperta non si fabbrica una via d'ingresso. I codici tornano in chiaro questa volta sola.
 */
export async function POST(request: Request) {
  const s = await requireAuth();
  if (isAuthError(s)) return s;
  const parsed = Corpo.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Manca il codice dell'app" }, { status: 400 });
  const u = s.user.name ? getUserByUsername(s.user.name) : undefined;
  if (!u?.totp_segreto) {
    return NextResponse.json(
      { error: "I codici di recupero servono a chi ha la verifica in due passaggi attiva" },
      { status: 403, headers: NO_STORE },
    );
  }
  const segreto = safeDecifraAccesso(u.totp_segreto);
  const passo = segreto ? verificaTotp(segreto, parsed.data.codice.replace(/\s/g, ""), Date.now(), u.totp_ultimo_passo ?? null) : null;
  if (passo === null || !usaPassoTotp(u.id, passo)) {
    return NextResponse.json({ error: "Codice non valido" }, { status: 403, headers: NO_STORE });
  }
  // Prima la traccia: codici nuovi non nascono senza riga nel registro.
  scriviRegistroAccessi({ azione: "codici_recupero_generati", utente: u.username, utenteId: u.id, da: u.username });
  return NextResponse.json({ codici: generaCodiciRecupero(u.id) }, { headers: NO_STORE });
}
