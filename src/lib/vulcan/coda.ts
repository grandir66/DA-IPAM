/**
 * La coda degli invii verso l'hub DA-Vul-can, nel DB del cliente (tabella `vulcan_coda`,
 * migrazione `vulcan_coda_v21`). Modello: `upload_queue.py` della sonda.
 *
 * - `accoda` comprime il JSON (gzip) e ne calcola lo sha256 sul testo non compresso, lo
 *   stesso che calcola l'hub per il doppione. Lo stesso `(tipo, sha256)` già in coda non
 *   si riaccoda. Una fotografia dell'inventario nuova rende `superato` quella ancora in
 *   attesa: si invia solo la più nuova.
 * - `prendiProssimi` prende in carico per 10 minuti (contro i doppi invii di due giri
 *   sovrapposti); `segnaRitento` applica il backoff e dopo 12 tentativi dà `fallito`;
 *   `rimettiFalliti` («Invia ora») li rimette in attesa.
 * - Una riga che esce dalla coda (inviato, scartato, superato) perde il corpo: i dati del
 *   cliente non restano sul disco più del necessario.
 *
 * Date nella forma di SQLite ('YYYY-MM-DD HH:MM:SS', UTC): il confronto con
 * `datetime('now')` è fra stringhe, mai `toISOString()` così com'è (la `T` rende il `>`
 * sempre vero). Gli errori scritti qui sono frasi nostre, mai testo dell'hub.
 */
import crypto from "node:crypto";
import zlib from "node:zlib";
import type Database from "better-sqlite3";
import { schemaVulcanPresente } from "@/lib/db-tenant";
import { SEGNO_VULCAN } from "@/lib/db-tenant-schema";
import { dataSqlite } from "@/lib/dalink/stato";

export const BACKOFF_S: readonly number[] = Object.freeze([1, 5, 30, 120, 600, 1800, 3600, 7200, 14400, 28800, 57600, 86400]);
export const MAX_TENTATIVI = 12;
export const PRESA_MIN = 10;
/** Righe uscite dalla coda (inviate, scartate, superate) tenute per la pagina «Cosa esce». */
export const GIORNI_STORIA = 90;

export type TipoInvio = "ad-health" | "inventario";
export type StatoCoda = "in_attesa" | "inviato" | "scartato" | "fallito" | "superato";

export interface RigaCoda {
  id: number;
  tipo: TipoInvio;
  rif: string | null;
  corpo_gz: Buffer;
  byte_json: number;
  oggetti: number | null;
  sha256: string;
  stato: StatoCoda;
  tentativi: number;
  prossimo_tentativo: string;
  preso_fino: string | null;
  ultimo_esito: string | null;
  ultimo_errore: string | null;
  esito_il: string | null;
  risposta_id: string | null;
  creato_il: string;
  inviato_il: string | null;
}

export interface StatoVulcanRiga {
  battito_il: string | null;
  battito_esito: string | null;
  battito_dettaglio: string | null;
  ping_il: string | null;
  ping_esito: string | null;
  ping_dettaglio: string | null;
  /** improntaGettone per cui il flusso è sospeso (401/403/409, codcli diverso), o null. Mai il gettone. */
  sospeso_gettone: string | null;
  sospeso_motivo: string | null;
  aggiornato_il: string | null;
}

const COLONNE_STATO = [
  "battito_il",
  "battito_esito",
  "battito_dettaglio",
  "ping_il",
  "ping_esito",
  "ping_dettaglio",
  "sospeso_gettone",
  "sospeso_motivo",
] as const;
type ColonnaStato = (typeof COLONNE_STATO)[number];

const piuSecondi = (d: Date, s: number): string => dataSqlite(new Date(d.getTime() + s * 1000));

function richiediSchema(db: Database.Database): void {
  if (!schemaVulcanPresente(db)) {
    throw new Error(`coda verso DA-Vul-can assente in questo database (migrazione ${SEGNO_VULCAN} non riuscita)`);
  }
}

export function accoda(
  db: Database.Database,
  v: { tipo: TipoInvio; rif: string | null; json: string; oggetti: number | null },
): { id: number; nuovo: boolean } {
  richiediSchema(db);
  const sha256 = crypto.createHash("sha256").update(v.json, "utf8").digest("hex");
  const corpo = zlib.gzipSync(Buffer.from(v.json, "utf8"));
  const byte = Buffer.byteLength(v.json, "utf8");
  return db.transaction(() => {
    const c = db.prepare("SELECT id FROM vulcan_coda WHERE tipo = ? AND sha256 = ?").get(v.tipo, sha256) as { id: number } | undefined;
    if (c) return { id: c.id, nuovo: false };
    if (v.tipo === "inventario") {
      db.prepare(
        `UPDATE vulcan_coda SET stato = 'superato', corpo_gz = zeroblob(0), preso_fino = NULL, esito_il = datetime('now')
         WHERE tipo = 'inventario' AND stato = 'in_attesa'`,
      ).run();
    }
    const r = db
      .prepare("INSERT INTO vulcan_coda (tipo, rif, corpo_gz, byte_json, oggetti, sha256) VALUES (?, ?, ?, ?, ?, ?)")
      .run(v.tipo, v.rif, corpo, byte, v.oggetti, sha256);
    return { id: Number(r.lastInsertRowid), nuovo: true };
  })();
}

/** Le righe in attesa e scadute, non prese da un altro giro; le prende in carico per PRESA_MIN minuti. */
export function prendiProssimi(db: Database.Database, max: number, adesso: Date): RigaCoda[] {
  const ora = dataSqlite(adesso);
  return db.transaction(() => {
    const righe = db
      .prepare(
        `SELECT * FROM vulcan_coda
         WHERE stato = 'in_attesa' AND prossimo_tentativo <= ? AND (preso_fino IS NULL OR preso_fino <= ?)
         ORDER BY prossimo_tentativo, id LIMIT ?`,
      )
      .all(ora, ora, Math.max(0, Math.floor(max))) as RigaCoda[];
    const presa = db.prepare("UPDATE vulcan_coda SET preso_fino = ? WHERE id = ?");
    const fino = piuSecondi(adesso, PRESA_MIN * 60);
    for (const r of righe) {
      presa.run(fino, r.id);
      r.preso_fino = fino;
    }
    return righe;
  })();
}

export function segnaInviato(db: Database.Database, id: number, rispostaId: string | null, adesso: Date): void {
  const ora = dataSqlite(adesso);
  db.prepare(
    `UPDATE vulcan_coda SET stato = 'inviato', corpo_gz = zeroblob(0), preso_fino = NULL, ultimo_esito = 'inviato',
       ultimo_errore = NULL, esito_il = ?, inviato_il = ?, risposta_id = ?
     WHERE id = ?`,
  ).run(ora, ora, rispostaId, id);
}

/** Un tentativo andato male che vale la pena ritentare (503, 5xx, rete, tempo): backoff, al 12° `fallito`. */
export function segnaRitento(db: Database.Database, id: number, esito: string, errore: string, adesso: Date): "in_attesa" | "fallito" {
  return db.transaction(() => {
    const r = db.prepare("SELECT tentativi FROM vulcan_coda WHERE id = ?").get(id) as { tentativi: number } | undefined;
    if (!r) throw new Error(`riga ${id} della coda verso DA-Vul-can inesistente`);
    const tentativi = r.tentativi + 1;
    const stato = tentativi >= MAX_TENTATIVI ? "fallito" : "in_attesa";
    const attesa = BACKOFF_S[Math.min(tentativi, BACKOFF_S.length) - 1];
    db.prepare(
      `UPDATE vulcan_coda SET tentativi = ?, stato = ?, prossimo_tentativo = ?, preso_fino = NULL,
         ultimo_esito = ?, ultimo_errore = ?, esito_il = ?
       WHERE id = ?`,
    ).run(tentativi, stato, piuSecondi(adesso, attesa), esito, errore, dataSqlite(adesso), id);
    return stato;
  })();
}

/** Un rifiuto per cui ritentare non serve (400, 404, 413, 422): la riga esce dalla coda e perde il corpo. */
export function segnaScartato(db: Database.Database, id: number, esito: string, errore: string, adesso: Date): void {
  db.prepare(
    `UPDATE vulcan_coda SET stato = 'scartato', corpo_gz = zeroblob(0), preso_fino = NULL,
       ultimo_esito = ?, ultimo_errore = ?, esito_il = ?
     WHERE id = ?`,
  ).run(esito, errore, dataSqlite(adesso), id);
}

/** Flusso sospeso (401, 403, 409): la riga torna in attesa senza contare un tentativo. */
export function rilascia(db: Database.Database, id: number): void {
  db.prepare("UPDATE vulcan_coda SET preso_fino = NULL WHERE id = ?").run(id);
}

/** «Invia ora»: i falliti tornano in attesa da subito, con i tentativi a zero. */
export function rimettiFalliti(db: Database.Database): number {
  return db
    .prepare(
      `UPDATE vulcan_coda SET stato = 'in_attesa', tentativi = 0, prossimo_tentativo = datetime('now'), preso_fino = NULL
       WHERE stato = 'fallito'`,
    )
    .run().changes;
}

export function conteggiCoda(db: Database.Database, adesso: Date = new Date()): { in_attesa: number; falliti: number; scartati_7g: number } {
  const r = db
    .prepare(
      `SELECT
         COALESCE(SUM(stato = 'in_attesa'), 0) AS in_attesa,
         COALESCE(SUM(stato = 'fallito'), 0) AS falliti,
         COALESCE(SUM(stato = 'scartato' AND esito_il >= ?), 0) AS scartati_7g
       FROM vulcan_coda`,
    )
    .get(piuSecondi(adesso, -7 * 86400)) as { in_attesa: number; falliti: number; scartati_7g: number };
  return { in_attesa: r.in_attesa, falliti: r.falliti, scartati_7g: r.scartati_7g };
}

export function ultimoInviato(
  db: Database.Database,
  tipo: TipoInvio,
): { inviato_il: string; oggetti: number | null; risposta_id: string | null } | null {
  const r = db
    .prepare(
      `SELECT inviato_il, oggetti, risposta_id FROM vulcan_coda
       WHERE tipo = ? AND stato = 'inviato' AND inviato_il IS NOT NULL
       ORDER BY inviato_il DESC, id DESC LIMIT 1`,
    )
    .get(tipo) as { inviato_il: string; oggetti: number | null; risposta_id: string | null } | undefined;
  return r ?? null;
}

/** L'ultimo errore ancora aperto (in attesa, fallito, scartato); un invio riuscito lo cancella dalla sua riga. */
export function ultimoErrore(db: Database.Database): { quando: string; tipo: TipoInvio; esito: string; errore: string } | null {
  const r = db
    .prepare(
      `SELECT esito_il AS quando, tipo, ultimo_esito AS esito, ultimo_errore AS errore FROM vulcan_coda
       WHERE stato IN ('in_attesa', 'fallito', 'scartato') AND ultimo_errore IS NOT NULL AND esito_il IS NOT NULL
       ORDER BY esito_il DESC, id DESC LIMIT 1`,
    )
    .get() as { quando: string; tipo: TipoInvio; esito: string | null; errore: string } | undefined;
  return r ? { quando: r.quando, tipo: r.tipo, esito: r.esito ?? "", errore: r.errore } : null;
}

/** Via le righe uscite dalla coda da più di 90 giorni; quelle in attesa o fallite restano, per vecchie che siano. */
export function puliziaCoda(db: Database.Database, adesso: Date): number {
  return db
    .prepare(
      `DELETE FROM vulcan_coda
       WHERE stato IN ('inviato', 'scartato', 'superato') AND COALESCE(esito_il, creato_il) < ?`,
    )
    .run(piuSecondi(adesso, -GIORNI_STORIA * 86400)).changes;
}

export function leggiStatoVulcan(db: Database.Database): StatoVulcanRiga {
  const r = db.prepare(`SELECT ${COLONNE_STATO.join(", ")}, aggiornato_il FROM vulcan_stato WHERE id = 1`).get() as
    | StatoVulcanRiga
    | undefined;
  if (r) return r;
  const vuoto = Object.fromEntries(COLONNE_STATO.map((c) => [c, null])) as Record<ColonnaStato, null>;
  return { ...vuoto, aggiornato_il: null };
}

/** Scrittura parziale della riga unica: le chiavi sono nomi di colonna fissi, mai composti da fuori. */
export function scriviStatoVulcan(db: Database.Database, parz: Partial<Omit<StatoVulcanRiga, "aggiornato_il">>): void {
  const chiavi = Object.keys(parz);
  for (const k of chiavi) {
    if (!(COLONNE_STATO as readonly string[]).includes(k)) throw new Error(`stato DA-Vul-can: «${k}» non è una colonna`);
  }
  const valori = chiavi.map((k) => parz[k as ColonnaStato] ?? null);
  db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO vulcan_stato (id) VALUES (1)").run();
    const set = [...chiavi.map((k) => `${k} = ?`), "aggiornato_il = datetime('now')"].join(", ");
    db.prepare(`UPDATE vulcan_stato SET ${set} WHERE id = 1`).run(...valori);
  })();
}
