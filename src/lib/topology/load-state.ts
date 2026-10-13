/**
 * Cosa fa la pagina Topologia quando un caricamento non riesce (Task 12,
 * 2026-10-13). Il primo caricamento fallito non ha niente da mostrare: errore
 * pieno con «Riprova». Un aggiornamento automatico (ogni 30 s) fallito con la
 * mappa già a schermo la tiene e lo dice in una riga con l'ora: una rete che
 * balbetta non deve far sparire la mappa, e i dati vecchi non devono sembrare
 * freschi senza che lo si dica.
 */
import { FUSO_UTENTI } from "@/lib/db-date";

export type LoadFailure =
  | { kind: "error"; message: string }
  | { kind: "refresh"; message: string; at: number };

export function afterLoadFailure(hasData: boolean, message: string, nowMs: number): LoadFailure {
  return hasData ? { kind: "refresh", message, at: nowMs } : { kind: "error", message };
}

const FMT = new Intl.DateTimeFormat("it-IT", { timeZone: FUSO_UTENTI, hour: "2-digit", minute: "2-digit", hour12: false });

/** «HH:MM» in ora italiana, qualunque sia il fuso della macchina. */
export function oraItaliana(ms: number): string {
  return FMT.format(new Date(ms));
}
