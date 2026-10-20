/**
 * Codice TOTP della verifica in due passaggi (Riccardo, 20/10). RFC 6238 con HMAC-SHA-1, 6 cifre,
 * passo di 30 secondi: quello che leggono tutte le app Authenticator. Scritto con `node:crypto`
 * per non portare una libreria in più dentro l'accesso.
 *
 * `verificaTotp` accetta un passo prima e uno dopo (orologi sfasati di qualche secondo) e mai un
 * passo già usato: chi ha visto un codice non lo può riusare. Un segreto o un codice malformato
 * è un rifiuto (`null`), mai un'eccezione.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PASSO_S = 30;
const CIFRE = 6;
const FINESTRA = 1;

export function base32Codifica(dati: Buffer): string {
  let bit = 0;
  let valore = 0;
  let uscita = "";
  for (const byte of dati) {
    valore = (valore << 8) | byte;
    bit += 8;
    while (bit >= 5) {
      uscita += ALFABETO[(valore >>> (bit - 5)) & 31];
      bit -= 5;
    }
  }
  if (bit > 0) uscita += ALFABETO[(valore << (5 - bit)) & 31];
  return uscita;
}

/** Legge anche minuscole, spazi e «=» finali (come lo copia una persona). Lancia su caratteri estranei. */
export function base32Decodifica(testo: string): Buffer {
  const pulito = testo.toUpperCase().replace(/[\s=]/g, "");
  let bit = 0;
  let valore = 0;
  const uscita: number[] = [];
  for (const c of pulito) {
    const i = ALFABETO.indexOf(c);
    if (i < 0) throw new Error("carattere non base32");
    valore = (valore << 5) | i;
    bit += 5;
    if (bit >= 8) {
      uscita.push((valore >>> (bit - 8)) & 255);
      bit -= 8;
    }
  }
  return Buffer.from(uscita);
}

/** 20 byte casuali (160 bit, la misura dell'RFC 4226 per SHA-1), in base32. */
export function nuovoSegreto(): string {
  return base32Codifica(randomBytes(20));
}

export function codiceTotp(segreto: string, passo: number): string {
  const chiave = base32Decodifica(segreto);
  const contatore = Buffer.alloc(8);
  contatore.writeBigUInt64BE(BigInt(passo));
  const h = createHmac("sha1", chiave).update(contatore).digest();
  const o = h[h.length - 1] & 0x0f;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** CIFRE).padStart(CIFRE, "0");
}

/**
 * Il passo accettato, oppure `null`. `ultimoPasso`: l'ultimo passo già usato da quell'utente
 * (null se mai): un passo uguale o precedente non vale.
 */
export function verificaTotp(segreto: string, codice: string, oraMs: number, ultimoPasso: number | null): number | null {
  const c = codice.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  if (!segreto) return null;
  const adesso = Math.floor(oraMs / 1000 / PASSO_S);
  for (let d = -FINESTRA; d <= FINESTRA; d++) {
    const passo = adesso + d;
    if (ultimoPasso !== null && passo <= ultimoPasso) continue;
    let atteso: string;
    try {
      atteso = codiceTotp(segreto, passo);
    } catch {
      return null;
    }
    if (timingSafeEqual(Buffer.from(atteso), Buffer.from(c))) return passo;
  }
  return null;
}

/** L'indirizzo che il QR contiene: le app Authenticator lo leggono così. */
export function uriOtpauth(segreto: string, utente: string, emittente = "DA-IPAM"): string {
  const etichetta = `${encodeURIComponent(emittente)}:${encodeURIComponent(utente)}`;
  return `otpauth://totp/${etichetta}?secret=${segreto}&issuer=${encodeURIComponent(emittente)}&algorithm=SHA1&digits=${CIFRE}&period=${PASSO_S}`;
}
