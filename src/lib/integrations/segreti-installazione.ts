/**
 * Segreti delle installazioni Docker gestite (LibreNMS, Graylog) — SEC-13.
 *
 * Modulo puro: genera i segreti, ne controlla il formato e li toglie dalle
 * righe di registro. Ogni installazione nuova ha i propri segreti; nessun
 * valore fisso nel sorgente, nessun segreto nel registro dell'installazione.
 * Salvataggio cifrato e lettura stanno in `config.ts`; il recupero dei valori
 * delle installazioni già esistenti in `segreti-migrazione.ts`.
 */
import { randomBytes, randomInt } from "node:crypto";
import { z } from "zod";

/** Segreti di un'installazione LibreNMS: database MariaDB e chiave applicativa. */
export interface SegretiLibreNMS {
  dbPassword: string;
  dbRootPassword: string;
  appKey: string;
}

/** Segreto interno di Graylog (cifratura delle sessioni e dei valori salvati). */
export interface SegretiGraylog {
  passwordSecret: string;
}

const ALFANUMERICI = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Password casuale di soli caratteri alfanumerici: passa intatta in una
 * variabile d'ambiente, in una shell fra virgolette e in un'intestazione
 * Basic, senza bisogno di escape.
 */
export function generaPassword(lunghezza = 24): string {
  if (!Number.isInteger(lunghezza) || lunghezza < 12) {
    throw new Error("Una password generata ha almeno 12 caratteri");
  }
  let out = "";
  for (let i = 0; i < lunghezza; i++) out += ALFANUMERICI[randomInt(ALFANUMERICI.length)];
  return out;
}

/** Forma della chiave applicativa che LibreNMS (Laravel, AES-256-CBC) accetta: 32 byte in base64. */
const APP_KEY_RE = /^base64:[A-Za-z0-9+/]{43}=$/;

export function isAppKeyLibreNMSValida(chiave: string): boolean {
  if (!APP_KEY_RE.test(chiave)) return false;
  return Buffer.from(chiave.slice("base64:".length), "base64").length === 32;
}

export function generaAppKeyLibreNMS(): string {
  return `base64:${randomBytes(32).toString("base64")}`;
}

/** Graylog vuole almeno 16 caratteri e ne consiglia 64: se ne generano 96. */
export const LUNGHEZZA_MINIMA_SEGRETO_GRAYLOG = 64;

export function generaSegretoGraylog(): string {
  return generaPassword(96);
}

export function generaSegretiLibreNMS(): SegretiLibreNMS {
  return {
    dbPassword: generaPassword(32),
    dbRootPassword: generaPassword(32),
    appKey: generaAppKeyLibreNMS(),
  };
}

export function generaSegretiGraylog(): SegretiGraylog {
  return { passwordSecret: generaSegretoGraylog() };
}

/**
 * Toglie da una riga di registro ogni segreto noto. È la seconda difesa: la
 * prima è non scrivere mai un segreto in una riga (invariante nelle prove).
 * I valori più corti di 6 caratteri non si cercano: coprirebbero parole comuni.
 */
export function mascheraSegreti(riga: string, segreti: readonly (string | null | undefined)[]): string {
  let out = riga;
  for (const s of segreti) {
    if (s && s.length >= 6) out = out.split(s).join("***");
  }
  return out;
}

/** Corpo della richiesta d'installazione: tutto facoltativo, i tipi sbagliati si ignorano. */
const CorpoInstallazioneSchema = z.object({
  adminPassword: z.unknown().optional(),
  serverUrl: z.unknown().optional(),
});

export interface ParametriInstallazione {
  adminPassword: string;
  /** true se la password non è arrivata dalla richiesta ed è stata generata qui. */
  passwordGenerata: boolean;
  /** Vuoto se non indicato: lo rileva la rotta. */
  serverUrl: string;
}

/**
 * Legge password admin e URL dalla richiesta d'installazione. Una password
 * assente o più corta di 6 caratteri non diventa un valore predefinito: se ne
 * genera una, che si salva cifrata come le altre e si legge dalla card
 * dell'integrazione (solo admin).
 */
export function parametriInstallazione(corpo: unknown): ParametriInstallazione {
  const parsed = CorpoInstallazioneSchema.safeParse(corpo ?? {});
  const dati = parsed.success ? parsed.data : {};
  const pw = typeof dati.adminPassword === "string" ? dati.adminPassword.trim() : "";
  const url = typeof dati.serverUrl === "string" ? dati.serverUrl.trim().replace(/\/$/, "") : "";
  if (pw.length >= 6) return { adminPassword: pw, passwordGenerata: false, serverUrl: url };
  return { adminPassword: generaPassword(20), passwordGenerata: true, serverUrl: url };
}
