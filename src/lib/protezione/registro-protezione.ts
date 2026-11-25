/**
 * Registro dei cambi alla protezione (piano §4.3): chi ha fatto cosa, quando, da dove, e la politica prima e dopo.
 * Una riga JSONL per azione in `<DATA_DIR>/audit/protezione-YYYY-MM-DD.jsonl`, conservato come il registro degli
 * accessi. Solo indirizzi e nomi: nessun segreto.
 */
import fs from "node:fs";
import { resolveDataDir } from "../data-dir";
import { unisci } from "../percorsi";

export interface RigaRegistroProtezione {
  azione: "osserva" | "prova" | "conferma" | "annulla" | "spegni" | "indirizzi_utente";
  utente: string;
  /** Indirizzo di chi ha chiesto l'azione, come lo vede l'applicazione. */
  da: string | null;
  esito: "riuscita" | "fallita";
  dettaglio?: string;
  /** Il testo della politica prima e dopo, quando l'azione la cambia. */
  prima?: string;
  dopo?: string;
}

/** Scrive una riga; lancia se non ci riesce: un cambio alla protezione non passa senza traccia. */
export function scriviRegistroProtezione(riga: RigaRegistroProtezione, adesso = new Date()): void {
  const dir = unisci(resolveDataDir(), "audit");
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(unisci(dir, `protezione-${adesso.toISOString().slice(0, 10)}.jsonl`), `${JSON.stringify({ il: adesso.toISOString(), ...riga })}\n`);
}
