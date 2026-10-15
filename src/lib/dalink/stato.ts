/**
 * Livello di privacy e stato del segnale verso DA-Link, nell'hub (tappa C1).
 *
 * - Il livello lo sceglie solo l'amministratore dell'istanza (spec NetBird §5.3,
 *   decisione 13). Ogni cambio è una riga nuova in `dalink_livello_registro`, con chi
 *   e quando: la tabella è il registro d'audit locale. Nessuna riga = nessuna scelta
 *   dichiarata = esce solo lo stato.
 * - Lo stato del segnale tiene l'ultimo tentativo e l'ultimo invio riuscito. Dalla
 *   risposta di DA-Link entrano solo due date; nessuna risposta cambia il livello.
 * - La conferma di un abbassamento vale solo se un segnale «solo stato» partito
 *   DOPO l'abbassamento ha avuto risposta con la data di cancellazione: prima di
 *   allora la pagina dice «in attesa di conferma», non «fatto».
 */
import { getHubDb } from "@/lib/db-hub";

export type Livello = "solo_stato" | "stato_inventario";
export const LIVELLI: readonly Livello[] = ["solo_stato", "stato_inventario"];

export function eLivello(v: unknown): v is Livello {
  return v === "solo_stato" || v === "stato_inventario";
}

export interface RigaRegistro {
  livello: Livello;
  scelto_da: string;
  scelto_il: string;
}

export type EsitoSegnale = "ok" | "rifiutato" | "errore" | "configurazione_non_valida";

export interface StatoSegnale {
  tentato_il: string | null;
  esito: EsitoSegnale | null;
  dettaglio: string | null;
  ok_il: string | null;
  ok_livello: Livello | null;
  ricevuto_il: string | null;
  inventario_cancellato_il: string | null;
}

export interface EsitoDaSalvare {
  tentato_il: Date;
  esito: EsitoSegnale;
  dettaglio: string;
  /** Livello dichiarato nel segnale tentato (null = nessuna scelta, vale solo stato). */
  livello: Livello | null;
  /** Solo per un esito "ok": le due date lette dalla risposta. */
  risposta?: { ricevuto_il: string | null; inventario_cancellato_il: string | null };
}

export type StatoConferma =
  | { stato: "nessuna_richiesta" }
  | { stato: "in_attesa"; dal: string }
  | { stato: "confermata"; cancellato_il: string; risposta_il: string };

/** Data nella forma di SQLite `datetime('now')`: UTC, «AAAA-MM-GG HH:MM:SS». */
export function dataSqlite(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

export function livelloAttuale(): RigaRegistro | null {
  const r = getHubDb()
    .prepare("SELECT livello, scelto_da, scelto_il FROM dalink_livello_registro ORDER BY id DESC LIMIT 1")
    .get() as RigaRegistro | undefined;
  return r ?? null;
}

export function impostaLivello(livello: Livello, chi: string, ora: Date = new Date()): void {
  if (!eLivello(livello)) throw new Error("livello non ammesso");
  const nome = chi.trim();
  if (!nome) throw new Error("manca chi sceglie il livello");
  getHubDb()
    .prepare("INSERT INTO dalink_livello_registro (livello, scelto_da, scelto_il) VALUES (?, ?, ?)")
    .run(livello, nome.slice(0, 200), dataSqlite(ora));
}

export function registroLivello(limite = 20): RigaRegistro[] {
  return getHubDb()
    .prepare("SELECT livello, scelto_da, scelto_il FROM dalink_livello_registro ORDER BY id DESC LIMIT ?")
    .all(Math.max(1, Math.min(200, Math.floor(limite)))) as RigaRegistro[];
}

export function statoSegnale(): StatoSegnale | null {
  const r = getHubDb()
    .prepare(
      `SELECT tentato_il, esito, dettaglio, ok_il, ok_livello, ricevuto_il, inventario_cancellato_il
       FROM dalink_segnale_stato WHERE id = 1`,
    )
    .get() as StatoSegnale | undefined;
  return r ?? null;
}

export function salvaEsitoSegnale(e: EsitoDaSalvare): void {
  const db = getHubDb();
  const tentato = dataSqlite(e.tentato_il);
  db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO dalink_segnale_stato (id) VALUES (1)").run();
    db.prepare("UPDATE dalink_segnale_stato SET tentato_il = ?, esito = ?, dettaglio = ? WHERE id = 1").run(
      tentato,
      e.esito,
      e.dettaglio.slice(0, 500),
    );
    if (e.esito === "ok") {
      db.prepare(
        `UPDATE dalink_segnale_stato
         SET ok_il = ?, ok_livello = ?, ricevuto_il = ?, inventario_cancellato_il = ?
         WHERE id = 1`,
      ).run(
        tentato,
        e.livello ?? "solo_stato",
        e.risposta?.ricevuto_il ?? null,
        e.risposta?.inventario_cancellato_il ?? null,
      );
    }
  })();
}

/**
 * L'ultimo abbassamento: l'inizio della serie più recente di righe «solo stato», se
 * prima di quella serie c'era «stato + inventario».
 */
function ultimoAbbassamento(): string | null {
  const righe = getHubDb()
    .prepare("SELECT livello, scelto_il FROM dalink_livello_registro ORDER BY id DESC")
    .iterate() as IterableIterator<{ livello: Livello; scelto_il: string }>;
  let inizio: string | null = null;
  for (const r of righe) {
    if (r.livello === "solo_stato") {
      inizio = r.scelto_il;
      continue;
    }
    return inizio;
  }
  return null;
}

export function statoConferma(): StatoConferma {
  const dal = ultimoAbbassamento();
  if (!dal) return { stato: "nessuna_richiesta" };
  const s = statoSegnale();
  if (
    s?.ok_il &&
    s.ok_livello === "solo_stato" &&
    s.ok_il >= dal &&
    s.inventario_cancellato_il &&
    s.ricevuto_il
  ) {
    return { stato: "confermata", cancellato_il: s.inventario_cancellato_il, risposta_il: s.ricevuto_il };
  }
  return { stato: "in_attesa", dal };
}
