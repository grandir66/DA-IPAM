/**
 * Verifica in due passaggi per TUTTI gli amministratori (piano di sicurezza 14/11, P0-2 tappa B).
 * Un'opzione dell'installazione, spenta di serie: un automatismo nuovo nasce spento, e accenderla cambia
 * l'accesso di ogni admin (al prossimo ingresso vede il QR). Chi è in sola lettura resta com'era; la richiesta
 * utente per utente (`users.totp_richiesta`, ADR 0023) continua a valere.
 */
import { getSetting, setSetting } from "@/lib/db-hub";

export const CHIAVE_DUE_PASSAGGI_ADMIN = "accesso_due_passaggi_admin";

export function duePassaggiAdminAccesi(): boolean {
  return (getSetting(CHIAVE_DUE_PASSAGGI_ADMIN) ?? "").trim() === "1";
}

export function impostaDuePassaggiAdmin(acceso: boolean): void {
  setSetting(CHIAVE_DUE_PASSAGGI_ADMIN, acceso ? "1" : "0");
}

/** A questo utente serve il codice? Richiesto a lui, oppure è amministratore e l'opzione è accesa. */
export function serveSecondaVerifica(utente: { role: string; totp_richiesta?: number | null }): boolean {
  if (utente.totp_richiesta === 1) return true;
  return (utente.role === "admin" || utente.role === "superadmin") && duePassaggiAdminAccesi();
}
