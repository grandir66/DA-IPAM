/**
 * Tappa 2c credenziali (T11): `credentials` senza CHECK su `credential_type`.
 *
 * Il CHECK ammetteva 5 tipi e SQLite non lo cambia senza ricostruire la
 * tabella. Dalla 2c la validazione sta solo in `tipi.ts` e nel CRUD (ADR 0017,
 * come per `network_controllers`, ADR 0007): un tipo futuro non richiede
 * un'altra ricostruzione della tabella più referenziata del tenant (10 chiavi
 * esterne, 5 in CASCADE; 12 dopo la 2f).
 *
 * Parte dalla **definizione attuale** in `sqlite_master` (modello
 * `migra-apple-macos.ts`): DEFAULT e i DB nati dal vecchio `ipam.db` hanno
 * definizioni diverse (3 o 5 tipi, nome con o senza virgolette, colonne
 * aggiunte in fondo), e ognuna deve restare com'è tranne il CHECK. In più:
 * 1. dopo `PRAGMA foreign_keys = OFF` si rilegge il valore: dentro una
 *    transazione aperta il PRAGMA non ha effetto, e il DROP cancellerebbe a
 *    cascata le righe figlie (154 in H1, 62 in A il 15/10). Lì si rifiuta
 *    senza toccare niente;
 * 2. il contatore AUTOINCREMENT (`sqlite_sequence`) si conserva;
 * 3. righe di `credentials` e valori non NULL di ogni colonna figlia, prima e
 *    dopo: le figlie si ricavano da `PRAGMA foreign_key_list`, non da un elenco
 *    fisso;
 * 4. `foreign_key_check` dopo non peggiore di prima (gli orfani che ci sono già
 *    restano: in H1 sono 2);
 * 5. indici, trigger e viste si ricreano;
 * 6. se qualcosa non torna, ROLLBACK.
 *
 * Modulo puro: riceve l'handle, non importa né `db.ts` né `db-tenant.ts`.
 */
import type Database from "better-sqlite3";

export interface EsitoMigraCredenziali {
  /** true se la tabella è stata ricostruita in questa chiamata. */
  eseguita: boolean;
  /** Righe di `credentials`: uguali prima e dopo, altrimenti ROLLBACK. */
  righe: number;
  /**
   * Valori non NULL di ogni colonna figlia («tabella.colonna»), uguali prima e
   * dopo. Vuoto se la tabella non è stata ricostruita (niente da misurare).
   */
  figli: Record<string, number>;
  /** Righe di `PRAGMA foreign_key_check`. 0 e 0 se non ricostruita (non misurate). */
  violazioniPrima: number;
  violazioniDopo: number;
  /** Contatore AUTOINCREMENT di `credentials`, conservato; null se non c'è. */
  seq: number | null;
}

/** Fotografia di `credentials` e delle sue figlie, per il prima/dopo del journal e della prova a vuoto. */
export interface StatoCredenziali {
  righe: number;
  figli: Record<string, number>;
  seq: number | null;
  /** null se non misurate (il controllo legge tutte le tabelle con chiavi esterne). */
  violazioni: number | null;
}

const NUOVA = "credentials__t2_nuova";
const RE_TABELLA = /^CREATE TABLE\s+("?)credentials\1\s*\(/i;
const RE_CHECK_TIPO = /(credential_type\s+TEXT\s+NOT\s+NULL)\s+CHECK\s*\(\s*credential_type\s+IN\s*\([^)]*\)\s*\)/i;
const RE_CHECK_SUL_TIPO = /CHECK\s*\(\s*"?credential_type\b/i;

function citato(nome: string): string {
  return `"${nome.replace(/"/g, '""')}"`;
}

/**
 * Le colonne che puntano a `credentials`, da `PRAGMA foreign_key_list` di ogni
 * tabella. Ordinate per «tabella.colonna».
 */
export function colonneFiglie(db: Database.Database): Array<{ tabella: string; colonna: string }> {
  const tabelle = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;
  const out: Array<{ tabella: string; colonna: string }> = [];
  for (const { name } of tabelle) {
    if (name === "credentials" || name === NUOVA) continue;
    const fk = db.pragma(`foreign_key_list(${citato(name)})`) as Array<{ table: string; from: string }>;
    for (const f of fk) {
      if (f.table.replace(/"/g, "").toLowerCase() === "credentials") out.push({ tabella: name, colonna: f.from });
    }
  }
  return out.sort((a, b) => `${a.tabella}.${a.colonna}`.localeCompare(`${b.tabella}.${b.colonna}`));
}

/** Valori non NULL di ogni colonna figlia. */
export function contaFigli(db: Database.Database): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { tabella, colonna } of colonneFiglie(db)) {
    out[`${tabella}.${colonna}`] = (
      db.prepare(`SELECT COUNT(*) AS n FROM ${citato(tabella)} WHERE ${citato(colonna)} IS NOT NULL`).get() as { n: number }
    ).n;
  }
  return out;
}

export function contaViolazioni(db: Database.Database): number {
  return (db.prepare("PRAGMA foreign_key_check").all() as unknown[]).length;
}

/** Contatore AUTOINCREMENT di `credentials`; null se la tabella non ne ha ancora uno. */
export function seqCredenziali(db: Database.Database): number | null {
  const c = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'").get();
  if (!c) return null;
  const r = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'credentials'").get() as { seq: number } | undefined;
  return r?.seq ?? null;
}

export function statoCredenziali(db: Database.Database, opz: { violazioni?: boolean } = {}): StatoCredenziali {
  return {
    righe: (db.prepare("SELECT COUNT(*) AS n FROM credentials").get() as { n: number }).n,
    figli: contaFigli(db),
    seq: seqCredenziali(db),
    violazioni: opz.violazioni ? contaViolazioni(db) : null,
  };
}

/** Una riga per il journal: righe, figli per colonna, seq, violazioni. */
export function descriviStato(s: StatoCredenziali): string {
  const figli = Object.entries(s.figli)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  const violazioni = s.violazioni == null ? "" : `, violazioni ${s.violazioni}`;
  return `righe ${s.righe}, figli {${figli}}, seq ${s.seq ?? "-"}${violazioni}`;
}

export function descriviRicostruzione(e: EsitoMigraCredenziali): string {
  if (!e.eseguita) return "credentials già senza CHECK sui tipi";
  return (
    `credentials ricostruita senza CHECK: righe ${e.righe} → ${e.righe}, figli uguali prima e dopo, ` +
    `violazioni ${e.violazioniPrima} → ${e.violazioniDopo}, seq ${e.seq ?? "-"} → ${e.seq ?? "-"}`
  );
}

/**
 * Definizione nuova dalla attuale: senza il CHECK sul tipo e col nome della
 * tabella temporanea. Null se il CHECK non c'è (niente da fare). Un CHECK sul
 * tipo scritto in un'altra forma è un errore: non si ricostruisce alla cieca.
 */
export function definizioneSenzaCheckTipo(sqlAttuale: string, nomeNuovo: string): string | null {
  if (!RE_CHECK_SUL_TIPO.test(sqlAttuale)) return null;
  if (!RE_TABELLA.test(sqlAttuale)) throw new Error("credentials: definizione non riconosciuta, ricostruzione non eseguita");
  if (!RE_CHECK_TIPO.test(sqlAttuale)) throw new Error("credentials: CHECK di credential_type non riconosciuto, ricostruzione non eseguita");
  const sql = sqlAttuale.replace(RE_CHECK_TIPO, "$1");
  if (RE_CHECK_SUL_TIPO.test(sql)) throw new Error("credentials: più di un CHECK su credential_type, ricostruzione non eseguita");
  return sql.replace(RE_TABELLA, `CREATE TABLE ${nomeNuovo} (`);
}

export function migraCredenzialiTipi(db: Database.Database): EsitoMigraCredenziali {
  const riga = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'credentials'").get() as
    | { sql: string }
    | undefined;
  if (!riga?.sql) throw new Error("credentials: tabella assente, ricostruzione non eseguita");
  const sqlNuova = definizioneSenzaCheckTipo(riga.sql, NUOVA);
  if (sqlNuova === null) {
    return {
      eseguita: false,
      righe: (db.prepare("SELECT COUNT(*) AS n FROM credentials").get() as { n: number }).n,
      figli: {},
      violazioniPrima: 0,
      violazioniDopo: 0,
      seq: seqCredenziali(db),
    };
  }
  if (db.inTransaction) {
    throw new Error("credentials: chiamata dentro una transazione aperta, dove le chiavi esterne non si spengono: ricostruzione non eseguita");
  }

  const indici = db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'credentials' AND sql IS NOT NULL")
    .all() as Array<{ name: string; sql: string }>;
  // Il RENAME rilegge trigger e viste di tutto lo schema: uno che nomina
  // `credentials` mentre la tabella non c'è lo fa fallire. Si tolgono e si
  // rimettono tutti quelli che la nominano (anche come parte di un altro nome:
  // ricrearli è innocuo).
  const trigger = db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND (tbl_name = 'credentials' OR sql LIKE '%credentials%')")
    .all() as Array<{ name: string; sql: string }>;
  const viste = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'view' AND sql LIKE '%credentials%'").all() as Array<{
    name: string;
    sql: string;
  }>;
  const colonne = (db.prepare("PRAGMA table_info(credentials)").all() as Array<{ name: string }>).map((c) => citato(c.name)).join(", ");

  const fkPrima = db.pragma("foreign_keys", { simple: true }) as number;
  db.pragma("foreign_keys = OFF");
  try {
    if ((db.pragma("foreign_keys", { simple: true }) as number) !== 0) {
      throw new Error("credentials: le chiavi esterne non si spengono (transazione già aperta?): ricostruzione non eseguita");
    }
    return db.transaction((): EsitoMigraCredenziali => {
      const violazioniPrima = contaViolazioni(db);
      const righePrima = JSON.stringify(db.prepare("SELECT * FROM credentials ORDER BY id").all());
      const figliPrima = contaFigli(db);
      const seqPrima = seqCredenziali(db);

      for (const v of viste) db.exec(`DROP VIEW ${citato(v.name)}`);
      for (const t of trigger) db.exec(`DROP TRIGGER IF EXISTS ${citato(t.name)}`);
      db.exec(`DROP TABLE IF EXISTS ${NUOVA}`);
      db.exec(sqlNuova);
      db.exec(`INSERT INTO ${NUOVA} (${colonne}) SELECT ${colonne} FROM credentials`);
      if (seqPrima != null) {
        const upd = db.prepare("UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = ?").run(seqPrima, NUOVA);
        if (upd.changes === 0) db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)").run(NUOVA, seqPrima);
      }
      db.exec("DROP TABLE credentials");
      db.exec(`ALTER TABLE ${NUOVA} RENAME TO credentials`);
      for (const i of indici) db.exec(i.sql);
      for (const t of trigger) db.exec(t.sql);
      for (const v of viste) db.exec(v.sql);

      const righeDopo = JSON.stringify(db.prepare("SELECT * FROM credentials ORDER BY id").all());
      if (righeDopo !== righePrima) throw new Error("credentials: le righe ricopiate non sono uguali alle originali: ricostruzione annullata");
      const figliDopo = contaFigli(db);
      if (JSON.stringify(figliDopo) !== JSON.stringify(figliPrima)) {
        throw new Error(`credentials: figli da ${JSON.stringify(figliPrima)} a ${JSON.stringify(figliDopo)}: ricostruzione annullata`);
      }
      // Il contatore resta dov'era; solo se era sotto l'id più alto (scritto a
      // mano) sale a quello, come farebbe SQLite al primo inserimento.
      const seqDopo = seqCredenziali(db);
      const maxId = (db.prepare("SELECT MAX(id) AS m FROM credentials").get() as { m: number | null }).m;
      const seqAtteso = seqPrima == null ? null : Math.max(seqPrima, maxId ?? 0);
      if (seqAtteso != null && seqDopo !== seqAtteso) {
        throw new Error(`credentials: contatore da ${seqPrima} a ${seqDopo}: ricostruzione annullata`);
      }
      const violazioniDopo = contaViolazioni(db);
      if (violazioniDopo > violazioniPrima) {
        throw new Error(`credentials: foreign_key_check da ${violazioniPrima} a ${violazioniDopo} violazioni: ricostruzione annullata`);
      }
      const sqlDopo = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'credentials'").get() as { sql: string }).sql;
      if (RE_CHECK_SUL_TIPO.test(sqlDopo)) throw new Error("credentials: il CHECK sul tipo è ancora lì: ricostruzione annullata");
      return {
        eseguita: true,
        righe: (JSON.parse(righeDopo) as unknown[]).length,
        figli: figliDopo,
        violazioniPrima,
        violazioniDopo,
        seq: seqDopo,
      };
    })();
  } finally {
    if (fkPrima) db.pragma("foreign_keys = ON");
  }
}
