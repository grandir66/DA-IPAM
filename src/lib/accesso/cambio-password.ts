/**
 * La password corrente, quando l'utente cambia la sua (secondo giro di sicurezza, 16/11/2026).
 *
 * La conferma d'identità sugli utenti (`users/conferma.ts`) ferma dopo 5 password sbagliate in 15 minuti; il cambio
 * password provava la stessa password senza limite, e chi aveva una sessione aperta la indovinava da lì. Stesso
 * freno, stesso conto per utente: i tentativi fatti da una parte valgono anche dall'altra.
 */
import bcrypt from "bcrypt";
import { clearRateLimit, isRateLimited, recordFailedAttempt } from "@/lib/rate-limit";

const TENTATIVI = 5;

export type EsitoPasswordCorrente = "giusta" | "sbagliata" | "fermo";

export async function provaPasswordCorrente(userId: number, hash: string, password: string): Promise<EsitoPasswordCorrente> {
  // La stessa chiave di `confermaIdentita`.
  const chiave = `conferma-utenti:${userId}`;
  if (isRateLimited(chiave, TENTATIVI)) return "fermo";
  if (await bcrypt.compare(password, hash)) {
    clearRateLimit(chiave);
    return "giusta";
  }
  recordFailedAttempt(chiave);
  return "sbagliata";
}
