/**
 * Accesso d'emergenza del cliente (piano di sicurezza 14/11, P0-2 tappa D, oggetto 3).
 * Se l'unico amministratore perde password, telefono e codici, prima serviva una shell sul server: l'ha Domarc,
 * non il cliente. Qui un amministratore prepara una frase lunga da chiudere in busta. Con quella frase si entra
 * come amministratore **una volta sola**, per **60 minuti**, senza codice dell'app; ogni creazione e ogni uso
 * lasciano una riga nel registro degli accessi.
 *
 * È un utente vero (`users.emergenza = 1`, nome `emergenza`): si vede nell'elenco, si toglie come gli altri, e la
 * revoca vale alla richiesta dopo (tappa A). È l'unico ingresso senza secondo fattore: per questo è monouso, a
 * tempo, e nasce solo se qualcuno lo crea.
 */
import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { createUser, getHubDb, getUserByUsername, setUserTenantAccess } from "@/lib/db-hub";
import { scriviRegistroAccessi } from "./registro-accessi";

export const NOME_EMERGENZA = "emergenza";
export const DURATA_EMERGENZA_MS = 60 * 60_000;
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function nuovaFrase(): string {
  let s = "";
  while (s.length < 24) {
    for (const b of randomBytes(48)) {
      if (b < 248 && s.length < 24) s += ALFABETO[b % 31];
    }
  }
  return s.match(/.{4}/g)!.join("-");
}

/** Un hash che nessuna frase apre: quello della frase consumata. */
async function hashChiuso(): Promise<string> {
  return bcrypt.hash(randomBytes(32).toString("hex"), 12);
}

/**
 * Prepara (o rigenera) l'accesso d'emergenza e rende la frase in chiaro: è l'unica volta che si vede.
 * Rigenerare annulla la frase di prima e chiude un'eventuale sessione d'emergenza aperta.
 */
export async function creaAccessoEmergenza(tenantIds: readonly number[], da: string): Promise<string> {
  const esistente = getUserByUsername(NOME_EMERGENZA);
  if (esistente && esistente.emergenza !== 1) {
    throw new Error(`Un utente «${NOME_EMERGENZA}» esiste già e non è l'accesso d'emergenza: rinominalo o toglilo prima`);
  }
  const frase = nuovaFrase();
  const hash = await bcrypt.hash(frase, 12);
  const db = getHubDb();
  db.transaction(() => {
    if (esistente) db.prepare("DELETE FROM users WHERE id = ? AND emergenza = 1").run(esistente.id);
    const u = createUser(NOME_EMERGENZA, hash, "admin", tenantIds[0] ?? null);
    db.prepare("UPDATE users SET emergenza = 1 WHERE id = ?").run(u.id);
    for (const t of tenantIds) setUserTenantAccess(u.id, t, "admin");
    scriviRegistroAccessi({ azione: "emergenza_creata", utente: NOME_EMERGENZA, utenteId: u.id, da });
  })();
  return frase;
}

/** Toglie l'accesso d'emergenza: una sessione aperta con quello cade alla richiesta dopo. */
export function togliAccessoEmergenza(): boolean {
  return getHubDb().prepare("DELETE FROM users WHERE username = ? AND emergenza = 1").run(NOME_EMERGENZA).changes > 0;
}

export function statoAccessoEmergenza(): { stato: "assente" | "pronto" | "usato"; usatoIl: string | null } {
  const u = getHubDb().prepare("SELECT last_login FROM users WHERE username = ? AND emergenza = 1").get(NOME_EMERGENZA) as
    | { last_login: string | null }
    | undefined;
  if (!u) return { stato: "assente", usatoIl: null };
  return u.last_login ? { stato: "usato", usatoIl: u.last_login } : { stato: "pronto", usatoIl: null };
}

/**
 * La frase è stata usata: non vale più. Non tocca `sessioni_valide_da`, altrimenti chiuderebbe la sessione che
 * sta nascendo. Non lancia sul registro: chi è in emergenza deve entrare; l'uso resta comunque nel journal.
 */
export async function consumaAccessoEmergenza(userId: number): Promise<void> {
  getHubDb()
    .prepare("UPDATE users SET password_hash = ?, last_login = datetime('now') WHERE id = ? AND emergenza = 1")
    .run(await hashChiuso(), userId);
  console.warn("[Auth] ACCESSO D'EMERGENZA usato: vale 60 minuti, la frase non vale più");
  try {
    scriviRegistroAccessi({ azione: "emergenza_usata", utente: NOME_EMERGENZA, utenteId: userId, da: NOME_EMERGENZA });
  } catch (e) {
    console.error("[Auth] registro degli accessi non scritto per l'accesso d'emergenza:", e);
  }
}
