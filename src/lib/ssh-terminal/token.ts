/**
 * Token effimero firmato (HMAC-SHA256) per autorizzare l'apertura di una
 * sessione SSH interattiva via WebSocket. Emesso da un'API autenticata
 * (requireAdmin + tenant); il WebSocket handler in server.ts lo verifica senza
 * dover decodificare il cookie NextAuth. Host-bound + scadenza breve.
 */
import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * La chiave della firma: derivata dalla chiave delle sessioni, con un'etichetta sua (non è la chiave dei cookie).
 * Senza chiave delle sessioni non c'è firma: prima si ripiegava sulla chiave dei dati e poi sul vuoto, e un
 * gettone firmato col vuoto lo fabbrica chiunque (piano di sicurezza 14/11, P0-2 tappa C).
 */
function secret(): Buffer | null {
  const base = (process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "").trim();
  if (!base) return null;
  return createHmac("sha256", base).update("da-ipam:ssh-terminal:v1").digest();
}

export interface SshTokenPayload {
  hostId: number;
  tenantCode: string;
  userId: number;
  exp: number; // epoch ms
}

/** Firma un token con TTL breve (default 60s, il tempo per aprire il WS). */
export function signSshToken(
  p: Omit<SshTokenPayload, "exp">,
  ttlMs = 60_000,
): string {
  const payload: SshTokenPayload = { ...p, exp: Date.now() + ttlMs };
  // `n`: un numero a caso, così due gettoni chiesti nello stesso istante non hanno la stessa firma (vedi consumaSshToken).
  const body = Buffer.from(JSON.stringify({ ...payload, n: randomBytes(8).toString("base64url") })).toString("base64url");
  const chiave = secret();
  if (!chiave) throw new Error("Terminale SSH: manca la chiave delle sessioni (AUTH_SECRET)");
  const sig = createHmac("sha256", chiave).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySshToken(token: string): SshTokenPayload | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const chiave = secret();
  if (!chiave) return null;
  const expected = createHmac("sha256", chiave).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as SshTokenPayload;
    if (
      typeof p.hostId !== "number" ||
      typeof p.tenantCode !== "string" ||
      typeof p.exp !== "number" ||
      Date.now() > p.exp
    ) {
      return null;
    }
    return { hostId: p.hostId, tenantCode: p.tenantCode, userId: p.userId, exp: p.exp };
  } catch {
    return null;
  }
}

/** Le firme dei gettoni già usati, fino alla loro scadenza (pochi: un gettone dura 60 secondi). */
const usati = new Map<string, number>();

/**
 * Verifica il gettone e lo consuma: vale per UN terminale. Prima lo stesso gettone, che viaggia nell'indirizzo del
 * WebSocket e resta nei registri del proxy, apriva quante shell si voleva per 60 secondi (terzo giro di sicurezza,
 * 16/11/2026).
 */
export function consumaSshToken(token: string, ora: number = Date.now()): SshTokenPayload | null {
  const p = verifySshToken(token);
  if (!p) return null;
  for (const [firma, scade] of usati) if (ora > scade) usati.delete(firma);
  const firma = token.slice(token.indexOf(".") + 1);
  if (usati.has(firma)) return null;
  usati.set(firma, p.exp);
  return p;
}

/**
 * Un terminale aperto resta aperto solo finché chi l'ha aperto è ancora amministratore. `leggiStato` è
 * `statoSessione` contato dall'apertura del terminale: `null` = utente cancellato, uscito («Esci») o con la
 * password cambiata dopo l'apertura. Prima la shell restava aperta finché non si chiudeva la scheda.
 * L'utenza di servizio (id 0) non ha una riga fra gli utenti e non si può revocare: resta ammessa.
 */
export function terminaleAncoraAmmesso(userId: number, leggiStato: () => { role: string } | null): boolean {
  if (userId === 0) return true;
  try {
    const stato = leggiStato();
    return stato !== null && (stato.role === "admin" || stato.role === "superadmin");
  } catch {
    return false;
  }
}
