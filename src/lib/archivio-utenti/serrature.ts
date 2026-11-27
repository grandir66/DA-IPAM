/**
 * Le serrature dell'archivio degli utenti (ADR 0043): la chiave dell'archivio cifrata una volta per persona, con una
 * chiave derivata dalla sua password principale personale. Solo crittografia, niente file: modulo puro.
 *
 * - Derivazione: Argon2id (64 MiB, 3 passi, 2 corsie), sale casuale di 16 byte per serratura.
 * - Cifratura: AES-256-GCM; l'id dell'utente è dato autenticato, così una serratura copiata sotto un altro utente
 *   non apre nemmeno con la password giusta.
 * - Mai un valore nei messaggi d'errore. Una password sbagliata dà `null`, non un'eccezione.
 */
import crypto from "node:crypto";
import { argon2id } from "hash-wasm";

export const LUNGHEZZA_MINIMA_PASSWORD = 14;
const ARGON2 = { memoriaKiB: 64 * 1024, iterazioni: 3, parallelismo: 2 } as const;

export interface Serratura {
  formato: 1;
  utenteId: number;
  /** Nome dell'utente quando è stata scritta: solo per leggerla, non fa fede. */
  utente: string;
  sale: string;
  iv: string;
  tag: string;
  cifrato: string;
  creata: string;
  /** Scritta da un superadmin con una password provvisoria: alla prima apertura va cambiata. */
  provvisoria: boolean;
  /** Chi l'ha scritta (id dell'utente), per il registro. */
  scrittaDa: number;
}

/** Perché una password non va bene; `null` = va bene. */
export function difettoPassword(password: string): string | null {
  if (password.length < LUNGHEZZA_MINIMA_PASSWORD) return `La password principale deve avere almeno ${LUNGHEZZA_MINIMA_PASSWORD} caratteri`;
  if (password.length > 256) return "La password principale è troppo lunga";
  if (new Set(password).size < 6) return "La password principale è troppo ripetitiva";
  return null;
}

async function deriva(password: string, sale: Buffer): Promise<Buffer> {
  const d = await argon2id({ password, salt: sale, parallelism: ARGON2.parallelismo, iterations: ARGON2.iterazioni, memorySize: ARGON2.memoriaKiB, hashLength: 32, outputType: "binary" });
  return Buffer.from(d);
}

const dato = (utenteId: number): Buffer => Buffer.from(`da-ipam.archivio-utenti.serratura.v1|${utenteId}`);

export async function creaSerratura(chiave: Uint8Array, password: string, op: { utenteId: number; utente: string; scrittaDa: number; provvisoria: boolean; adesso?: Date }): Promise<Serratura> {
  const difetto = difettoPassword(password);
  if (difetto) throw new Error(difetto);
  if (chiave.length < 16) throw new Error("Chiave dell'archivio non valida");
  const sale = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const k = await deriva(password, sale);
  try {
    const c = crypto.createCipheriv("aes-256-gcm", k, iv);
    c.setAAD(dato(op.utenteId));
    const cifrato = Buffer.concat([c.update(Buffer.from(chiave)), c.final()]);
    return {
      formato: 1, utenteId: op.utenteId, utente: op.utente.slice(0, 64), sale: sale.toString("base64"), iv: iv.toString("base64"),
      tag: c.getAuthTag().toString("base64"), cifrato: cifrato.toString("base64"), creata: (op.adesso ?? new Date()).toISOString(), provvisoria: op.provvisoria, scrittaDa: op.scrittaDa,
    };
  } finally {
    k.fill(0);
  }
}

/** La chiave dell'archivio, o `null` se la password non è quella (o la serratura è di un altro utente, o è rotta). */
export async function apriSerratura(s: Serratura, password: string): Promise<Uint8Array | null> {
  if (s.formato !== 1 || !password) return null;
  let k: Buffer | null = null;
  try {
    k = await deriva(password, Buffer.from(s.sale, "base64"));
    const d = crypto.createDecipheriv("aes-256-gcm", k, Buffer.from(s.iv, "base64"));
    d.setAAD(dato(s.utenteId));
    d.setAuthTag(Buffer.from(s.tag, "base64"));
    return new Uint8Array(Buffer.concat([d.update(Buffer.from(s.cifrato, "base64")), d.final()]));
  } catch {
    return null;
  } finally {
    k?.fill(0);
  }
}
