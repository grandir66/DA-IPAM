/**
 * Accesso con nome e password locali, con la verifica in due passaggi per chi l'admin l'ha
 * richiesta (Riccardo, 20/10; ADR 0023). Una funzione sola per i due momenti:
 *
 * - `passo_uno` (pagina d'accesso, `/api/auth/passo-uno`): password giusta → dice se serve il
 *   codice o l'attivazione (e in quel caso propone il QR, valido 10 minuti). Non azzera il
 *   blocco dei tentativi: altrimenti chi ha la password potrebbe provare codici all'infinito.
 * - `accesso` (`authorize` di NextAuth): entra solo con password e, se richiesto, codice giusto.
 *
 * Chi entra da DA-Auth (entra.domarc.it) non passa di qui. L'utenza di servizio Domarc
 * (`DOMARC_USERNAME`/`DOMARC_PASSWORD`) resta senza codice per scelta di Riccardo; il confronto
 * della sua password è a tempo costante. Ogni rifiuto ha lo stesso esito, senza dire perché.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import { encrypt, safeDecrypt } from "@/lib/crypto";
import { clearRateLimit, loginLockState, recordFailedAttempt } from "@/lib/rate-limit";
import {
  attivaTotp,
  getUserByUsername,
  salvaTotpProposto,
  usaPassoTotp,
  type HubUser,
} from "@/lib/db-hub";
import { nuovoSegreto, uriOtpauth, verificaTotp } from "./totp";

export type EsitoAccesso =
  | { esito: "entra"; utente: HubUser }
  | { esito: "servizio"; username: string }
  | { esito: "serve_codice" }
  | { esito: "serve_attivazione"; segreto: string; qr: string }
  | { esito: "rifiuta" }
  | { esito: "bloccato"; secondi: number };

const DURATA_PROPOSTA_MS = 10 * 60_000;

function uguali(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export async function verificaAccessoLocale(
  input: { username: string; password: string; codice?: string },
  opzioni: { fase: "passo_uno" | "accesso"; ora?: number },
): Promise<EsitoAccesso> {
  const ora = opzioni.ora ?? Date.now();
  const username = (input.username ?? "").trim();
  const password = input.password ?? "";
  if (!username || !password) return { esito: "rifiuta" };

  const chiave = `login:${username}`;
  const blocco = loginLockState(chiave);
  if (blocco.locked) return { esito: "bloccato", secondi: blocco.retryAfterSec };
  const rifiuta = (): EsitoAccesso => {
    recordFailedAttempt(chiave);
    return { esito: "rifiuta" };
  };

  // Utenza di servizio Domarc: com'era, senza codice; confronto a tempo costante.
  const servizio = process.env.DOMARC_USERNAME || "domarc";
  const passServizio = process.env.DOMARC_PASSWORD;
  if (passServizio && username === servizio) {
    if (!uguali(password, passServizio)) return rifiuta();
    if (opzioni.fase === "accesso") clearRateLimit(chiave);
    return { esito: "servizio", username: servizio };
  }

  const utente = getUserByUsername(username);
  if (!utente) return rifiuta();
  const bcrypt = await import("bcrypt");
  if (!(await bcrypt.compare(password, utente.password_hash))) return rifiuta();

  const entra = (): EsitoAccesso => {
    clearRateLimit(chiave);
    return { esito: "entra", utente };
  };

  if (utente.totp_richiesta !== 1) {
    return opzioni.fase === "accesso" ? entra() : { esito: "entra", utente };
  }

  // ── 2FA attiva: serve il codice ─────────────────────────────────────────
  if (utente.totp_segreto) {
    if (opzioni.fase === "passo_uno") return { esito: "serve_codice" };
    if (!input.codice) return rifiuta();
    const segreto = safeDecrypt(utente.totp_segreto);
    if (!segreto) {
      console.error(`[Auth] ${username}: segreto della verifica in due passaggi non leggibile (chiave cambiata?)`);
      return rifiuta();
    }
    const passo = verificaTotp(segreto, input.codice, ora, utente.totp_ultimo_passo ?? null);
    if (passo === null || !usaPassoTotp(utente.id, passo)) return rifiuta();
    return entra();
  }

  // ── 2FA richiesta ma non ancora attivata: QR proposto, confermato dal primo codice ─
  const propostoValido =
    utente.totp_proposto && utente.totp_proposto_scade && Date.parse(utente.totp_proposto_scade) > ora
      ? utente.totp_proposto
      : null;

  if (opzioni.fase === "passo_uno") {
    let segreto = propostoValido ? safeDecrypt(propostoValido) : null;
    if (!segreto) {
      segreto = nuovoSegreto();
      salvaTotpProposto(utente.id, encrypt(segreto), new Date(ora + DURATA_PROPOSTA_MS).toISOString());
    }
    const qr = await QRCode.toDataURL(uriOtpauth(segreto, utente.username), { margin: 1, width: 220 });
    return { esito: "serve_attivazione", segreto, qr };
  }

  if (!propostoValido || !input.codice) return rifiuta();
  const segreto = safeDecrypt(propostoValido);
  if (!segreto) return rifiuta();
  const passo = verificaTotp(segreto, input.codice, ora, null);
  if (passo === null || !attivaTotp(utente.id, propostoValido, passo)) return rifiuta();
  console.info(`[Auth] ${username}: verifica in due passaggi attivata`);
  return entra();
}
