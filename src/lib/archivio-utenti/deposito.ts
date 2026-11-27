/**
 * Dove sta l'archivio degli utenti e il suo registro (ADR 0043). Modulo a parte, senza dipendenze dagli altri
 * dell'archivio, così motore, voci e copia lo importano tutti senza girarsi intorno.
 */
import fs from "node:fs";
import { resolveDataDir } from "../data-dir";
import { elencaCartella, unisci } from "../percorsi";

export function cartellaArchivio(): string {
  return unisci(resolveDataDir(), "archivio-utenti");
}

// ── Registro ─────────────────────────────────────────────────────────────────

export interface RigaRegistroArchivio {
  azione: "creato" | "aperto" | "chiuso" | "richiuso_da_solo" | "tentativo_fallito" | "bloccato" | "accesso_dato" | "accesso_tolto" | "password_cambiata" | "codice_amministratore_rifiutato" | "codice_amministratore_sostituito"
    | "voce_letta" | "voce_creata" | "voce_cambiata" | "voce_cancellata" | "voce_spostata" | "voce_ripristinata" | "voci_importate"
    | "copia_fatta" | "copia_scaricata" | "chiave_recupero_sostituita";
  utente: string;
  utenteId: number;
  da: string | null;
  /** Su chi, quando l'azione riguarda un'altra persona. */
  su?: string;
  dettaglio?: string;
}

/** Lancia se non scrive: un'apertura dell'archivio non passa senza traccia. */
export function scriviRegistroArchivio(riga: RigaRegistroArchivio, adesso: Date = new Date()): void {
  const dir = unisci(resolveDataDir(), "audit");
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(unisci(dir, `archivio-${adesso.toISOString().slice(0, 10)}.jsonl`), `${JSON.stringify({ il: adesso.toISOString(), ...riga })}\n`);
}


/** Le ultime righe del registro dell'archivio, dalla più recente. Sola lettura: mai un valore segreto, per costruzione. */
export function leggiRegistroArchivio(giorni = 60, massimo = 300, adesso: Date = new Date()): Array<RigaRegistroArchivio & { il: string }> {
  const dir = unisci(resolveDataDir(), "audit");
  const soglia = new Date(adesso.getTime() - giorni * 86_400_000).toISOString().slice(0, 10);
  let file: string[];
  try {
    file = elencaCartella(dir).filter((f) => /^archivio-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(9, 19) >= soglia).sort().reverse();
  } catch {
    return [];
  }
  const righe: Array<RigaRegistroArchivio & { il: string }> = [];
  for (const f of file) {
    const testo = fs.readFileSync(unisci(dir, f), "utf8").split("\n").filter(Boolean).reverse();
    for (const r of testo) {
      try {
        righe.push(JSON.parse(r) as RigaRegistroArchivio & { il: string });
      } catch {
        // una riga rotta non ferma le altre
      }
      if (righe.length >= massimo) return righe;
    }
  }
  return righe;
}
