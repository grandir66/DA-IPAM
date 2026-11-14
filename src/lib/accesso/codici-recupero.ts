/**
 * Codici di recupero della verifica in due passaggi (piano di sicurezza 14/11, P0-2 tappa D; Riccardo: «Sì, falli»).
 * Telefono perso: prima l'unica via era una shell sul server, che ha Domarc e non il cliente. Otto codici monouso,
 * da stampare, valgono al posto del codice dell'app. Nel database sta solo l'impronta SHA-256: i codici hanno
 * 80 bit casuali, quindi un'impronta semplice basta (non sono password scelte da una persona).
 */
import { createHash, randomBytes } from "node:crypto";
import { getHubDb } from "@/lib/db-hub";

export const QUANTI_CODICI_RECUPERO = 8;
/** Senza 0, 1, I, L, O: si leggono male su un foglio stampato. */
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function normalizza(codice: string): string {
  return codice.replace(/[\s-]/g, "").toUpperCase();
}

function impronta(codice: string): string {
  return createHash("sha256").update(`da-ipam:codice-recupero:${normalizza(codice)}`).digest("hex");
}

function nuovoCodice(): string {
  let s = "";
  // 16 caratteri da un alfabeto di 31: si scartano i byte fuori misura, così ogni carattere è equiprobabile.
  while (s.length < 16) {
    for (const b of randomBytes(32)) {
      if (b < 248 && s.length < 16) s += ALFABETO[b % 31];
    }
  }
  return s.match(/.{4}/g)!.join("-");
}

/** Ha la forma di un codice di recupero (e non di un codice a 6 cifre dell'app)? */
export function sembraCodiceRecupero(codice: string): boolean {
  return /^[A-Z2-9]{16}$/.test(normalizza(codice));
}

/** Crea otto codici nuovi e annulla i precedenti. Li rende in chiaro: è l'unica volta che si vedono. */
export function generaCodiciRecupero(userId: number): string[] {
  const db = getHubDb();
  const codici = Array.from({ length: QUANTI_CODICI_RECUPERO }, nuovoCodice);
  db.transaction(() => {
    db.prepare("DELETE FROM codici_recupero WHERE user_id = ?").run(userId);
    const ins = db.prepare("INSERT INTO codici_recupero (user_id, impronta) VALUES (?, ?)");
    for (const c of codici) ins.run(userId, impronta(c));
  })();
  return codici;
}

/** Consuma il codice: vero una volta sola, anche con due richieste insieme (lo decide l'UPDATE). */
export function usaCodiceRecupero(userId: number, codice: string): boolean {
  if (!sembraCodiceRecupero(codice)) return false;
  return (
    getHubDb()
      .prepare("UPDATE codici_recupero SET usato_at = datetime('now') WHERE user_id = ? AND impronta = ? AND usato_at IS NULL")
      .run(userId, impronta(codice)).changes === 1
  );
}

export function codiciRecuperoRimasti(userId: number): number {
  return (getHubDb().prepare("SELECT COUNT(*) AS n FROM codici_recupero WHERE user_id = ? AND usato_at IS NULL").get(userId) as { n: number }).n;
}
