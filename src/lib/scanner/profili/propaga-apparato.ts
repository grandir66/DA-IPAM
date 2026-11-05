/**
 * Dai campi letti dal profilo alle colonne vuote dell'apparato (Riccardo, 05/11/2026:
 * «popolare quanto e' vuoto»), con il segno «da rivedere» che si guarda da Discovery.
 *
 * Due cautele, e sono quelle del livello completo su questo solo passo:
 *
 * 1. **Si riempie, non si sovrascrive**: si scrive solo dove la colonna dell'apparato e'
 *    NULL o vuota, e `classification_manual` o un dato messo a mano non si toccano mai.
 * 2. **Il seriale e' una chiave**, non un campo: `identity-resolver.ts` identifica
 *    l'apparato fisico da lui, quindi un valore sbagliato non sporca una colonna, fonde
 *    due apparati. Passa da `eSerialeFinto` (stringhe IEEE 1284, nomi di serie) e dalla
 *    forma minima; nel dubbio non si scrive.
 *
 * `soloProva: true` non scrive niente e restituisce quello che avrebbe scritto: e' la
 * prova a vuoto da fare prima di lasciarlo correre su un archivio vero.
 */
import type Database from "better-sqlite3";
import { eSerialeFinto } from "@/lib/devices/seriale-valido";
import type { FattiProfilo } from "./tipi";

/** Le tre colonne dell'apparato che un profilo puo' riempire, e da quale campo. */
export const COLONNE_APPARATO: ReadonlyArray<readonly [colonna: string, campo: keyof FattiProfilo]> = [
  ["model", "modello"],
  ["serial_number", "seriale"],
  ["firmware", "firmware"],
];

export interface EsitoPropagazione {
  apparatoId: number | null;
  /** Colonne scritte (o che si scriverebbero, con `soloProva`). */
  scritte: string[];
  /** Colonne lasciate stare, col perche': «piena», «senza valore», «seriale non valido». */
  saltate: Array<{ colonna: string; motivo: string }>;
}

/** Un seriale si scrive solo se e' plausibile: niente 1284, niente nomi di serie, almeno 4 caratteri utili. */
export function serialePropagabile(valore: string | undefined): boolean {
  const t = (valore ?? "").trim();
  if (t.length < 4) return false;
  if (eSerialeFinto(t)) return false;
  // Un valore fatto solo di zeri, trattini o spazi non identifica niente.
  if (/^[0\s\-_.]+$/.test(t)) return false;
  return true;
}

/** Aggiunge dei campi all'elenco «da rivedere» di una riga, senza doppioni e in ordine. */
export function segnaDaRivedere(
  db: Database.Database,
  tabella: "hosts" | "network_devices",
  id: number,
  campi: readonly string[],
): void {
  if (campi.length === 0) return;
  const riga = db.prepare(`SELECT campi_da_rivedere FROM ${tabella} WHERE id = ?`).get(id) as
    | { campi_da_rivedere: string | null }
    | undefined;
  if (!riga) return;
  const presenti = (riga.campi_da_rivedere ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const insieme = [...new Set([...presenti, ...campi])].sort();
  db.prepare(`UPDATE ${tabella} SET campi_da_rivedere = ? WHERE id = ?`).run(insieme.join(","), id);
}

/**
 * Porta all'apparato dell'host (se c'e') i campi che il profilo ha letto, solo dove e' vuoto.
 * Non tocca l'host: quello lo fa `salvaEsitoProfilo`.
 */
export function propagaAllApparato(
  db: Database.Database,
  hostId: number,
  fatti: FattiProfilo,
  opzioni: { soloProva?: boolean } = {},
): EsitoPropagazione {
  const soloProva = opzioni.soloProva === true;
  const apparato = db
    .prepare("SELECT id, model, serial_number, firmware FROM network_devices WHERE host_id = ? LIMIT 1")
    .get(hostId) as
    | { id: number; model: string | null; serial_number: string | null; firmware: string | null }
    | undefined;
  if (!apparato) return { apparatoId: null, scritte: [], saltate: [] };

  const esito: EsitoPropagazione = { apparatoId: apparato.id, scritte: [], saltate: [] };
  const attuale: Record<string, string | null> = {
    model: apparato.model,
    serial_number: apparato.serial_number,
    firmware: apparato.firmware,
  };

  for (const [colonna, campo] of COLONNE_APPARATO) {
    const valore = (fatti[campo] as string | undefined)?.trim();
    if (!valore) {
      esito.saltate.push({ colonna, motivo: "senza valore" });
      continue;
    }
    if ((attuale[colonna] ?? "").trim() !== "") {
      esito.saltate.push({ colonna, motivo: "piena" });
      continue;
    }
    if (colonna === "serial_number" && !serialePropagabile(valore)) {
      esito.saltate.push({ colonna, motivo: "seriale non valido" });
      continue;
    }
    if (!soloProva) {
      /* Il `WHERE` ripete la condizione del vuoto: fra la lettura e la scrittura
       * un collector puo' aver riempito la colonna, e vince lui. */
      db.prepare(
        `UPDATE network_devices SET ${colonna} = ?, updated_at = datetime('now')
          WHERE id = ? AND (${colonna} IS NULL OR TRIM(${colonna}) = '')`,
      ).run(valore, apparato.id);
    }
    esito.scritte.push(colonna);
  }

  if (!soloProva && esito.scritte.length > 0) segnaDaRivedere(db, "network_devices", apparato.id, esito.scritte);
  return esito;
}

/**
 * Toglie il segno «da rivedere» dagli host indicati e dai loro apparati. Con `campi`
 * si conferma solo quelli, togliendoli dall'elenco; senza, si conferma tutto.
 * Non tocca i valori: conferma vuol dire «guardato», non «cambiato».
 */
export function togliDaRivedere(
  db: Database.Database,
  hostIds: readonly number[],
  campi?: readonly string[],
): { host: number; apparati: number } {
  if (hostIds.length === 0) return { host: 0, apparati: 0 };
  const daTogliere = new Set((campi ?? []).map((c) => c.trim()).filter(Boolean));

  const resto = (valore: string | null): string | null => {
    const presenti = (valore ?? "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    if (presenti.length === 0) return null;
    const rimasti = daTogliere.size === 0 ? [] : presenti.filter((c) => !daTogliere.has(c));
    return rimasti.length > 0 ? rimasti.sort().join(",") : null;
  };

  let host = 0;
  let apparati = 0;
  const segna = db.transaction(() => {
    for (const id of hostIds) {
      const h = db.prepare("SELECT campi_da_rivedere FROM hosts WHERE id = ?").get(id) as
        | { campi_da_rivedere: string | null }
        | undefined;
      if (h && (h.campi_da_rivedere ?? "").trim() !== "") {
        db.prepare("UPDATE hosts SET campi_da_rivedere = ? WHERE id = ?").run(resto(h.campi_da_rivedere), id);
        host++;
      }
      const d = db.prepare("SELECT id, campi_da_rivedere FROM network_devices WHERE host_id = ?").all(id) as Array<{
        id: number;
        campi_da_rivedere: string | null;
      }>;
      for (const riga of d) {
        if ((riga.campi_da_rivedere ?? "").trim() === "") continue;
        db.prepare("UPDATE network_devices SET campi_da_rivedere = ? WHERE id = ?").run(
          resto(riga.campi_da_rivedere),
          riga.id,
        );
        apparati++;
      }
    }
  });
  segna();
  return { host, apparati };
}
