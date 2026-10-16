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

/**
 * Tornando sulla pagina — scheda di nuovo visibile o finestra di nuovo a fuoco — si rileggono i dati
 * (difetto 2026-10-15: dopo una modifica fatta in un'altra scheda o finestra, elenco e mappa restavano
 * quelli di prima fino al giro dei 30 s). I due eventi arrivano insieme cambiando scheda: entro
 * `RETURN_DEDUPE_MS` dall'ultima rilettura per ritorno se ne fa una sola. Il giro dei 30 s non conta:
 * può aver letto prima della modifica.
 */
export const RETURN_DEDUPE_MS = 1_000;

export function reloadOnReturn(visible: boolean, lastReturnMs: number | null, nowMs: number): boolean {
  return visible && (lastReturnMs === null || nowMs - lastReturnMs >= RETURN_DEDUPE_MS);
}
