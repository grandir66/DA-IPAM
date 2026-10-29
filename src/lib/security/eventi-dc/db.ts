/**
 * Archivio degli eventi letti dai domain controller e stato della lettura per DC.
 *
 * Due tabelle, nel DB del cliente:
 * - `dc_evento`: un evento per riga, 31 giorni (la finestra più lunga della pagina è 30). Serve ai
 *   grafici e alle classifiche: la coda della pagina deduplica e perde la distribuzione, come con
 *   Wazuh, dove la distribuzione la dà l'indexer.
 * - `dc_lettura`: per ogni DC l'ultimo EventRecordID letto, l'esito e gli eventi persi.
 *
 * Lo schema vive qui come quello della coda della pagina (`wazuh-alerts-db.ts`): `ensureEventiDcSchema`
 * è idempotente, la chiamano giro e rotte, e il modulo si prova su `:memory:`.
 */

import type { Database } from "better-sqlite3";
import type { EventoDc, RegistroDc } from "./eventi";

/** Cursori dei registri oltre a Sicurezza (arricchimento del 29/10): una colonna per registro. */
const COLONNE_CURSORE: Record<Exclude<RegistroDc, "Security">, string> = {
  System: "cursore_system",
  Defender: "cursore_defender",
};
export type CursoriAltri = Partial<Record<Exclude<RegistroDc, "Security">, number | null>>;

export const GIORNI_CONSERVAZIONE_DC = 31;

export function ensureEventiDcSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dc_evento (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dc TEXT NOT NULL,
      record_id INTEGER NOT NULL,
      quando TEXT NOT NULL,
      event_id INTEGER NOT NULL,
      categoria TEXT NOT NULL,
      livello INTEGER NOT NULL,
      descrizione TEXT NOT NULL,
      account TEXT,
      dominio TEXT,
      ip TEXT,
      postazione TEXT,
      motivo TEXT,
      autore TEXT,
      UNIQUE (dc, record_id)
    );
    CREATE INDEX IF NOT EXISTS idx_dc_evento_quando ON dc_evento(quando);

    CREATE TABLE IF NOT EXISTS dc_lettura (
      dc TEXT PRIMARY KEY,
      ultimo_record INTEGER,
      letto_il TEXT,
      esito TEXT,
      errore TEXT,
      eventi_ultimo_giro INTEGER NOT NULL DEFAULT 0,
      persi_il TEXT,
      persi INTEGER NOT NULL DEFAULT 0
    );
  `);
  const colonne = new Set((db.prepare("SELECT name FROM pragma_table_info('dc_lettura')").all() as Array<{ name: string }>).map((c) => c.name));
  for (const c of Object.values(COLONNE_CURSORE)) {
    if (!colonne.has(c)) db.exec(`ALTER TABLE dc_lettura ADD COLUMN ${c} INTEGER`);
  }
}

/** Scrive gli eventi; un record già visto (stesso DC e record) non si duplica. Ritorna i nuovi. */
export function salvaEventiDc(db: Database, eventi: readonly EventoDc[]): number {
  const ins = db.prepare(
    `INSERT OR IGNORE INTO dc_evento
       (dc, record_id, quando, event_id, categoria, livello, descrizione, account, dominio, ip, postazione, motivo, autore)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let nuovi = 0;
  for (const e of eventi) {
    const r = ins.run(e.dc, e.record, e.quando, e.eventId, e.categoria, e.livello, e.descrizione, e.account, e.dominio, e.ip, e.postazione, e.motivo, e.autore);
    nuovi += r.changes;
  }
  return nuovi;
}

export function eliminaEventiDcVecchi(db: Database, giorni = GIORNI_CONSERVAZIONE_DC): number {
  const limite = new Date(Date.now() - giorni * 86_400_000).toISOString();
  return db.prepare("DELETE FROM dc_evento WHERE quando < ?").run(limite).changes;
}

export interface LetturaDc {
  dc: string;
  ultimoRecord: number | null;
  lettoIl: string | null;
  esito: "ok" | "errore" | null;
  errore: string | null;
  eventiUltimoGiro: number;
  persiIl: string | null;
  persi: number;
  /** Dove ripartono System e Defender. */
  cursoriAltri: CursoriAltri;
}

export function letturaDc(db: Database, dc: string): LetturaDc | null {
  const r = db.prepare("SELECT * FROM dc_lettura WHERE dc = ?").get(dc) as
    | { dc: string; ultimo_record: number | null; letto_il: string | null; esito: string | null; errore: string | null; eventi_ultimo_giro: number; persi_il: string | null; persi: number; cursore_system: number | null; cursore_defender: number | null }
    | undefined;
  if (!r) return null;
  return {
    dc: r.dc,
    ultimoRecord: r.ultimo_record,
    lettoIl: r.letto_il,
    esito: r.esito === "ok" || r.esito === "errore" ? r.esito : null,
    errore: r.errore,
    eventiUltimoGiro: r.eventi_ultimo_giro,
    persiIl: r.persi_il,
    persi: r.persi,
    cursoriAltri: { System: r.cursore_system ?? null, Defender: r.cursore_defender ?? null },
  };
}

export function lettureDc(db: Database): LetturaDc[] {
  const nomi = db.prepare("SELECT dc FROM dc_lettura ORDER BY dc").all() as Array<{ dc: string }>;
  return nomi.map((n) => letturaDc(db, n.dc)).filter((l): l is LetturaDc => l !== null);
}

export function scriviLetturaRiuscita(db: Database, dc: string, v: { record: number | null; eventi: number; persi: number; altri?: CursoriAltri }): void {
  const ora = new Date().toISOString();
  db.prepare(
    `INSERT INTO dc_lettura (dc, ultimo_record, letto_il, esito, errore, eventi_ultimo_giro, persi_il, persi)
     VALUES (?, ?, ?, 'ok', NULL, ?, ?, ?)
     ON CONFLICT(dc) DO UPDATE SET
       ultimo_record = excluded.ultimo_record,
       letto_il = excluded.letto_il,
       esito = 'ok',
       errore = NULL,
       eventi_ultimo_giro = excluded.eventi_ultimo_giro,
       persi_il = CASE WHEN excluded.persi > 0 THEN excluded.persi_il ELSE dc_lettura.persi_il END,
       persi = CASE WHEN excluded.persi > 0 THEN excluded.persi ELSE dc_lettura.persi END`,
  ).run(dc, v.record, ora, v.eventi, v.persi > 0 ? ora : null, v.persi);
  // Un registro non letto (assente o in errore) non è nell'elenco: il suo cursore resta dov'è.
  for (const [registro, record] of Object.entries(v.altri ?? {}) as Array<[keyof typeof COLONNE_CURSORE, number | null]>) {
    db.prepare(`UPDATE dc_lettura SET ${COLONNE_CURSORE[registro]} = ? WHERE dc = ?`).run(record, dc);
  }
}

/** Un errore lascia il cursore dov'è: il giro dopo rilegge lo stesso tratto. */
export function scriviLetturaFallita(db: Database, dc: string, errore: string): void {
  db.prepare(
    `INSERT INTO dc_lettura (dc, letto_il, esito, errore) VALUES (?, ?, 'errore', ?)
     ON CONFLICT(dc) DO UPDATE SET letto_il = excluded.letto_il, esito = 'errore', errore = excluded.errore, eventi_ultimo_giro = 0`,
  ).run(dc, new Date().toISOString(), errore.slice(0, 500));
}

/** Ci sono eventi dei DC: la pagina li usa per i grafici quando Wazuh non c'è. */
export function ciSonoEventiDc(db: Database): boolean {
  const t = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'dc_lettura'").get();
  if (!t) return false;
  return db.prepare("SELECT 1 FROM dc_lettura LIMIT 1").get() !== undefined;
}

/** Filtri della pagina «Sicurezza del dominio»: per categoria, non per ID (4768 è login o fallimento a seconda dell'esito). */
export const TIPI_EVENTO_DC = {
  accessi: { etichetta: "Login", sql: "categoria = 'accesso'" },
  uscite: { etichetta: "Logout", sql: "categoria = 'uscita'" },
  falliti: { etichetta: "Accessi falliti", sql: "categoria = 'auth_failure' AND event_id <> 4740" },
  bloccati: { etichetta: "Account bloccati", sql: "event_id = 4740" },
  modifiche: { etichetta: "Account, gruppi e diritti", sql: "categoria = 'privileged_change' AND event_id NOT IN (5136, 5137, 5141, 4697, 7045)" },
  gpo: { etichetta: "GPO create, modificate, eliminate", sql: "event_id IN (5136, 5137, 5141)" },
  servizi: { etichetta: "Servizi installati sui DC", sql: "event_id IN (4697, 7045)" },
  attacchi: { etichetta: "Attacchi al dominio (DCSync, Kerberoasting)", sql: "categoria = 'domain_attack'" },
  malware: { etichetta: "Malware sui DC (Defender)", sql: "categoria = 'malware'" },
  registro: { etichetta: "Registro cancellato", sql: "categoria = 'log_tampering'" },
} as const;
export type TipoEventoDc = keyof typeof TIPI_EVENTO_DC;

export interface RigaEventoDc {
  id: number;
  dc: string;
  quando: string;
  event_id: number;
  categoria: string;
  livello: number;
  descrizione: string;
  account: string | null;
  dominio: string | null;
  ip: string | null;
  postazione: string | null;
  motivo: string | null;
  autore: string | null;
}

function filtroEventi(f: { since: string; tipo?: TipoEventoDc; cerca?: string; ancheNostre?: boolean }): { where: string; params: unknown[] } {
  const where = ["quando >= ?"];
  const params: unknown[] = [f.since];
  if (f.tipo) where.push(`(${TIPI_EVENTO_DC[f.tipo].sql})`);
  if (!f.ancheNostre) where.push("categoria <> 'self_probe'");
  const q = (f.cerca ?? "").trim();
  if (q) {
    const campi = ["account", "ip", "postazione", "dc", "autore", "descrizione"];
    where.push(`(${campi.map((c) => `${c} LIKE ? ESCAPE '!'`).join(" OR ")})`);
    const like = `%${q.replace(/[!%_]/g, (c) => `!${c}`)}%`;
    params.push(...campi.map(() => like));
  }
  return { where: where.join(" AND "), params };
}

export function listaEventiDc(
  db: Database,
  f: { since: string; tipo?: TipoEventoDc; cerca?: string; ancheNostre?: boolean; limit: number; offset: number },
): { righe: RigaEventoDc[]; totale: number } {
  const { where, params } = filtroEventi(f);
  const totale = (db.prepare(`SELECT COUNT(*) AS n FROM dc_evento WHERE ${where}`).get(...params) as { n: number }).n;
  const righe = db
    .prepare(
      `SELECT id, dc, quando, event_id, categoria, livello, descrizione, account, dominio, ip, postazione, motivo, autore
         FROM dc_evento WHERE ${where} ORDER BY quando DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, f.limit, f.offset) as RigaEventoDc[];
  return { righe, totale };
}

/** I numeri in testa alla pagina, nella finestra, per tipo; le nostre sonde a parte. */
export function numeriEventiDc(db: Database, since: string): Record<TipoEventoDc, number> & { nostre: number } {
  const conta = (sql: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM dc_evento WHERE quando >= ? AND categoria <> 'self_probe' AND (${sql})`).get(since) as { n: number }).n;
  const out = Object.fromEntries(Object.entries(TIPI_EVENTO_DC).map(([k, t]) => [k, conta(t.sql)])) as Record<TipoEventoDc, number>;
  const nostre = (db.prepare("SELECT COUNT(*) AS n FROM dc_evento WHERE quando >= ? AND categoria = 'self_probe'").get(since) as { n: number }).n;
  return { ...out, nostre };
}
