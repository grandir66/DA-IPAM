import { loginLockState } from "@/lib/rate-limit";

/**
 * Stato del backoff di login per uno username, per mostrare il countdown nella UI
 * di login. Sotto `/api/auth/*` → nessuna auth (vedi regola API routes).
 *
 * Rivela solo se uno username è temporaneamente in cooldown e per quanto:
 * informazione che chi innesca il blocco già conosce, e che serve a distinguere
 * "aspetta N secondi" da "credenziali errate" (radice degli incidenti 99.50 e DTS).
 * Nessuna indicazione sull'esistenza dell'utente: qualunque stringa può essere
 * rate-limited.
 */
export async function GET(req: Request): Promise<Response> {
  const username = (new URL(req.url).searchParams.get("u") || "").trim().slice(0, 128);
  if (!username) return Response.json({ locked: false, retryAfterSec: 0 });
  const state = loginLockState(`login:${username}`);
  return Response.json({ locked: state.locked, retryAfterSec: state.retryAfterSec });
}
