/**
 * Il secondo fattore vero per l'archivio degli utenti: il codice a sei cifre dell'utente collegato (ADR 0023), lo
 * stesso dell'accesso. Un codice già usato non vale (`usaPassoTotp`). Chi non ha la verifica in due passaggi attiva
 * non passa: per usare l'archivio va accesa (Impostazioni › Utenti).
 */
import { getUserById, usaPassoTotp } from "@/lib/db-hub";
import { safeDecifraAccesso } from "@/lib/crypto";
import { verificaTotp } from "@/lib/accesso/totp";

export function verificaCodiceUtente(utenteId: number, codice: string, ora: number): boolean {
  if (!Number.isInteger(utenteId) || utenteId <= 0 || !/^\d{6}$/.test(codice.trim())) return false;
  const u = getUserById(utenteId);
  if (!u || !u.totp_segreto) return false;
  const segreto = safeDecifraAccesso(u.totp_segreto);
  if (!segreto) return false;
  const passo = verificaTotp(segreto, codice.trim(), ora, u.totp_ultimo_passo ?? null);
  return passo !== null && usaPassoTotp(utenteId, passo);
}

/** L'utente ha la verifica in due passaggi attiva? Serve per dirlo a schermo prima che provi. */
export function haSecondoFattore(utenteId: number): boolean {
  const u = Number.isInteger(utenteId) && utenteId > 0 ? getUserById(utenteId) : undefined;
  return Boolean(u?.totp_segreto);
}
