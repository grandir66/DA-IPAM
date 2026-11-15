/**
 * Conferma di chi sta agendo, prima delle operazioni che creano potere (analisi del 15/11/2026).
 *
 * Creare un amministratore, promuovere a amministratore, reimpostare una password, azzerare o togliere la verifica
 * in due passaggi chiedevano solo una sessione admin: con una sessione lasciata aperta o presa si creava un admin
 * nuovo e con quello si passava ogni altra conferma (scarico del database, accesso d'emergenza, KeePass).
 *
 * Riccardo, 15/11: chi ha la verifica in due passaggi attiva dà il **codice dell'app** (la stessa conferma di 5
 * minuti dello scarico del database); chi non l'ha ridà la **propria password**. Nessuno resta bloccato.
 * - Sessione nata dall'accesso d'emergenza: niente conferma. La frase è già consumata e quell'utente serve proprio a
 *   reimpostare l'amministratore vero; dura 60 minuti ed è nel registro.
 * - Utenza di servizio nel file (id 0): la password del file.
 * - Chi entra solo dall'account Domarc non ha una password sua: deve attivare la verifica in due passaggi.
 * Cinque password sbagliate in 15 minuti fermano (429). Mai password o codici nei registri.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import bcrypt from "bcrypt";
import { getUserById } from "@/lib/db-hub";
import { clearRateLimit, isRateLimited, recordFailedAttempt } from "@/lib/rate-limit";
import { confermaConSecondaVerifica, confermaValida } from "@/lib/vault/mostra";
import type { SessionLike, UsersResult } from "./service";

export type OperazioneUtenti = "crea" | "modifica" | "seconda_verifica" | "reimposta_password";

const RUOLI_FORTI = new Set(["admin", "superadmin"]);
const TENTATIVI = 5;

/** Questa richiesta crea potere? `ruoloAttuale`: il ruolo dell'utente toccato, per la modifica. */
export function serveConferma(op: OperazioneUtenti, corpo: Record<string, unknown>, ruoloAttuale?: string | null): boolean {
  switch (op) {
    case "crea":
      return typeof corpo.role === "string" && RUOLI_FORTI.has(corpo.role);
    case "modifica":
      // Solo la promozione: da sola lettura ad amministratore, o da admin a superadmin.
      return typeof corpo.role === "string" && RUOLI_FORTI.has(corpo.role) && corpo.role !== ruoloAttuale;
    case "seconda_verifica":
      return corpo.azione === "azzera" || corpo.azione === "togli";
    case "reimposta_password":
      return true;
  }
}

function uguali(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

const chiedi = (cosa: "codice" | "password"): UsersResult => ({
  status: 403,
  body: {
    error: cosa === "codice" ? "Conferma col codice della verifica in due passaggi" : "Conferma con la tua password",
    serveConferma: cosa,
  },
});
const rifiuta = (status: number, error: string, cosa?: "codice" | "password"): UsersResult => ({
  status,
  body: cosa ? { error, serveConferma: cosa } : { error },
});

/** `null` = confermato, si procede. Altrimenti la risposta da dare (403 con `serveConferma`, 429). */
export async function confermaIdentita(session: SessionLike, corpo: Record<string, unknown>): Promise<UsersResult | null> {
  const codice = typeof corpo.conferma_codice === "string" ? corpo.conferma_codice.trim() : "";
  const password = typeof corpo.conferma_password === "string" ? corpo.conferma_password : "";
  const idTesto = String(session.user?.id ?? "0");
  const id = Number(idTesto);
  const chiave = `conferma-utenti:${idTesto}`;
  if (isRateLimited(chiave, TENTATIVI)) return rifiuta(429, "Troppe conferme sbagliate: riprova fra qualche minuto");

  const conPassword = (giusta: boolean): UsersResult | null => {
    if (giusta) {
      clearRateLimit(chiave);
      return null;
    }
    recordFailedAttempt(chiave);
    return rifiuta(403, "Password non corretta", "password");
  };

  // Utenza di servizio nel file: non ha una riga né un codice.
  if (!Number.isInteger(id) || id <= 0) {
    const attesa = process.env.DOMARC_PASSWORD;
    if (!attesa) return rifiuta(403, "Questa utenza non può confermare: entra col tuo utente");
    if (!password) return chiedi("password");
    return conPassword(uguali(password, attesa));
  }

  const u = getUserById(id);
  if (!u) return rifiuta(403, "Il tuo account non risulta più: esci e rientra");
  if (u.emergenza === 1) return null;

  if (u.totp_richiesta === 1 && u.totp_segreto) {
    if (confermaValida(idTesto) !== null) return null;
    if (!codice) return chiedi("codice");
    const e = confermaConSecondaVerifica({
      utente: { id: idTesto, nome: u.username, ruolo: u.role },
      codice,
      scopo: "backup",
    });
    return e.ok ? null : rifiuta(e.stato, e.errore, e.stato === 429 ? undefined : "codice");
  }

  if (!password) return chiedi("password");
  return conPassword(await bcrypt.compare(password, u.password_hash));
}

/**
 * Per le rotte `/api/users*`: legge il corpo da una copia della richiesta (il servizio legge l'originale) e, se
 * l'operazione crea potere, chiede la conferma. `null` = si procede col servizio.
 */
export async function confermaPerOperazione(
  session: SessionLike,
  request: Request,
  op: OperazioneUtenti,
  rawId?: string,
): Promise<UsersResult | null> {
  let corpo: unknown;
  try {
    corpo = await request.clone().json();
  } catch {
    return null; // JSON non valido: lo dice il servizio, come prima
  }
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return null;
  const c = corpo as Record<string, unknown>;
  const idBersaglio = Number(rawId);
  const ruoloAttuale = op === "modifica" && Number.isInteger(idBersaglio) && idBersaglio > 0 ? getUserById(idBersaglio)?.role ?? null : null;
  if (!serveConferma(op, c, ruoloAttuale)) return null;
  return confermaIdentita(session, c);
}
