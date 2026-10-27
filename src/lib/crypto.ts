import crypto from "crypto";
import { chiaveDatiAttiva, vaultLocaleAcceso } from "@/lib/vault/stato";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

/**
 * Chiavi (da-vault, piano 2026-10-23, passo 10):
 * - **chiave d'installazione**: derivata da `ENCRYPTION_KEY` di `.env.local`, come sempre;
 * - **chiave dei dati**: aperta dagli slot dell'archivio locale (`src/lib/vault/`), solo con `DA_VAULT_LOCALE=1`.
 *
 * Interruttore spento (di serie): tutto come prima, bit per bit. Acceso: `encrypt()` scrive con la chiave dei dati
 * (vault bloccato = errore, mai un ripiego sulla chiave d'installazione) e `decrypt()` prova la chiave dei dati e poi
 * quella d'installazione (i valori non ancora ricifrati). Lo stesso formato `iv:tag:testo`: la chiave giusta la dice
 * il tag di GCM. I segreti dell'accesso (TOTP, `cifraAccesso`) restano sulla chiave d'installazione: col vault
 * bloccato si deve poter entrare per sbloccarlo (ADR 0034).
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error("ENCRYPTION_KEY non configurata in .env.local");
  }
  // Derive a 32-byte key from the provided key
  return crypto.scryptSync(key, "da-ipam-salt", 32);
}

/** La chiave d'installazione derivata (per la ricifra, che la calcola una volta sola). */
export function chiaveInstallazione(): Buffer {
  return getEncryptionKey();
}

export function cifraConChiave(key: Buffer, plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();

  // Format: iv:tag:encrypted
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted}`;
}

export function decifraConChiave(key: Buffer, ciphertext: string): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    throw new Error("Formato crittografia non valido");
  }

  const iv = Buffer.from(parts[0], "hex");
  const tag = Buffer.from(parts[1], "hex");
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

const MESSAGGIO_BLOCCATO = "Vault bloccato: la chiave degli slot non è aperta (Impostazioni › Vault)";

export function encrypt(plaintext: string): string {
  if (!vaultLocaleAcceso()) return cifraConChiave(getEncryptionKey(), plaintext);
  const chiave = chiaveDatiAttiva();
  if (!chiave) throw new Error(MESSAGGIO_BLOCCATO);
  return cifraConChiave(chiave, plaintext);
}

export function decrypt(ciphertext: string): string {
  if (!vaultLocaleAcceso()) return decifraConChiave(getEncryptionKey(), ciphertext);
  const chiave = chiaveDatiAttiva();
  if (chiave) {
    try {
      return decifraConChiave(chiave, ciphertext);
    } catch {
      // Non è della chiave dei dati: un valore non ancora ricifrato, che si legge con la chiave d'installazione.
    }
  }
  try {
    return decifraConChiave(getEncryptionKey(), ciphertext);
  } catch (e) {
    if (!chiave) throw new Error(MESSAGGIO_BLOCCATO);
    throw e;
  }
}

/**
 * Decrypt con protezione: ritorna null su ciphertext corrotto/malformato
 * invece di lanciare eccezione. Da usare nei path non-critici.
 */
export function safeDecrypt(ciphertext: string): string | null {
  try {
    return decrypt(ciphertext);
  } catch (err) {
    console.warn("[crypto] Decifrazione fallita per ciphertext corrotto:", (err as Error).message);
    return null;
  }
}

/** Solo chiave d'installazione, qualunque sia l'interruttore: i segreti dell'accesso (ADR 0023, ADR 0034). */
export function cifraAccesso(plaintext: string): string {
  return cifraConChiave(getEncryptionKey(), plaintext);
}

export function decifraAccesso(ciphertext: string): string {
  return decifraConChiave(getEncryptionKey(), ciphertext);
}

/** Come `safeDecrypt`, sulla sola chiave d'installazione. */
export function safeDecifraAccesso(ciphertext: string): string | null {
  try {
    return decifraAccesso(ciphertext);
  } catch (err) {
    console.warn("[crypto] Decifrazione fallita per ciphertext corrotto:", (err as Error).message);
    return null;
  }
}

/** Un valore con la sola chiave d'installazione (la ricifra lo usa per riconoscere i valori ancora da spostare). */
export function decifraConInstallazione(ciphertext: string): string {
  return decifraConChiave(getEncryptionKey(), ciphertext);
}

export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString("hex");
}
