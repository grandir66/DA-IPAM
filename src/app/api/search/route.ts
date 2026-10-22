import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";

/**
 * Ricerca generale tolta il 20/10/2026 (Riccardo: via la barra in alto; si cerca nelle
 * tabelle, IP/MAC/hostname in Discovery). La rotta resta, ferma, perché il controllo dei
 * tipi della build nuova legge anche i tipi generati dalla build ancora attiva, che la
 * citano: senza questo file l'aggiornamento di hub e appliance falliva (v0.9.804) e
 * tornava indietro. Da togliere quando tutte le installazioni girano con un `update.sh`
 * che svuota quei tipi prima di costruire (dalla v0.9.805).
 */
export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  return NextResponse.json(
    { error: "La ricerca generale non c'è più: si cerca in Discovery e nelle tabelle." },
    { status: 410 },
  );
}
