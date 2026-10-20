/**
 * Risposta comune delle rotte dell'agente Python remoto, tolto il 20/10/2026 (decisione
 * 26 della spec NetBird: nessuno lo usava, una sola riga sull'hub mai collegata).
 *
 * Le rotte restano, ferme (410), per un giro: il controllo dei tipi della build nuova
 * legge anche i tipi generati dalla build ancora attiva, che le citano; senza i file
 * l'aggiornamento di chi ha un `update.sh` più vecchio della v0.9.805 fallisce e torna
 * indietro (come `/api/search`, v0.9.804). Da togliere, insieme alle rotte, quando
 * tutte le installazioni hanno lo script nuovo.
 */
import { NextResponse } from "next/server";

export const MESSAGGIO_AGENTE_TOLTO =
  "L'agente Python remoto non esiste più (tolto il 20/10/2026): le scansioni girano su questa istanza.";

export function rispostaAgenteTolto(): NextResponse {
  return NextResponse.json({ error: MESSAGGIO_AGENTE_TOLTO }, { status: 410 });
}
