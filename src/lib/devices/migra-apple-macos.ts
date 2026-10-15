/**
 * Tappa 1b credenziali (15/10): `apple` in `network_devices.vendor` e `macos` in
 * `network_devices.scan_target`.
 *
 * La scansione macOS esiste (`device-acquisition-resolve.ts` `isMacosDevice`) e
 * il validatore accetta già i due valori, ma il CHECK della tabella li rifiutava:
 * promuovere un Mac finiva in un errore di vincolo.
 *
 * SQLite non modifica un CHECK: la tabella si ricostruisce. Le ricostruzioni
 * vecchie di db-tenant.ts riscrivono un elenco fisso di colonne e perdono quelle
 * non elencate; questa parte dalla **definizione attuale** in `sqlite_master` e
 * cambia solo i due elenchi e il nome, così ogni colonna resta. Procedura delle
 * 12 fasi di SQLite: foreign_keys spente fuori dalla transazione; nella
 * transazione tabella nuova, copia, DROP, RENAME, indici/trigger/viste
 * ricreati, conteggio e foreign_key_check (se non tornano, ROLLBACK).
 */
import type Database from "better-sqlite3";

export interface EsitoMigraAppleMacos {
  /** true se la tabella è stata ricostruita in questa chiamata. */
  eseguita: boolean;
  righe: number;
}

const RE_TABELLA = /^CREATE TABLE\s+("?)network_devices\1\s*\(/i;
const RE_VENDOR = /(vendor\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(\s*vendor\s+IN\s*\()([^)]*)(\))/i;
const RE_SCAN_TARGET = /(scan_target\s+TEXT\s+CHECK\s*\(\s*scan_target\s+IN\s*\()([^)]*)(\))/i;

/** Aggiunge `valore` all'elenco del CHECK trovato da `re`; errore se l'elenco non c'è. */
function aggiungiAlCheck(sql: string, re: RegExp, valore: string, cosa: string): string {
  const m = sql.match(re);
  if (!m) throw new Error(`network_devices: CHECK di ${cosa} non riconosciuto, ricostruzione non eseguita`);
  if (m[2].includes(`'${valore}'`)) return sql;
  return sql.replace(re, `$1$2, '${valore}'$3`);
}

/** Definizione nuova dalla attuale: i due elenchi estesi e il nome della tabella temporanea. */
export function definizioneConAppleMacos(sqlAttuale: string, nomeNuovo: string): string {
  if (!RE_TABELLA.test(sqlAttuale)) throw new Error("network_devices: definizione non riconosciuta, ricostruzione non eseguita");
  let sql = aggiungiAlCheck(sqlAttuale, RE_VENDOR, "apple", "vendor");
  sql = aggiungiAlCheck(sql, RE_SCAN_TARGET, "macos", "scan_target");
  return sql.replace(RE_TABELLA, `CREATE TABLE ${nomeNuovo} (`);
}

function contaViolazioni(db: Database.Database): number {
  return (db.prepare("PRAGMA foreign_key_check").all() as unknown[]).length;
}

export function migraAppleMacos(db: Database.Database): EsitoMigraAppleMacos {
  const riga = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'network_devices'")
    .get() as { sql: string } | undefined;
  if (!riga?.sql) return { eseguita: false, righe: 0 };
  const vendor = riga.sql.match(RE_VENDOR);
  const scan = riga.sql.match(RE_SCAN_TARGET);
  if (vendor?.[2].includes("'apple'") && scan?.[2].includes("'macos'")) {
    return { eseguita: false, righe: 0 };
  }

  const NUOVA = "network_devices__apple_new";
  const sqlNuova = definizioneConAppleMacos(riga.sql, NUOVA);
  const collegati = db
    .prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE tbl_name = 'network_devices' AND type IN ('index', 'trigger') AND sql IS NOT NULL"
    )
    .all() as Array<{ type: string; name: string; sql: string }>;
  const viste = db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'view' AND sql LIKE '%network_devices%'")
    .all() as Array<{ name: string; sql: string }>;
  const colonne = (db.prepare("PRAGMA table_info(network_devices)").all() as Array<{ name: string }>)
    .map((c) => `"${c.name}"`)
    .join(", ");

  const fkPrima = db.pragma("foreign_keys", { simple: true }) as number;
  db.pragma("foreign_keys = OFF");
  try {
    const righe = db.transaction(() => {
      const violazioniPrima = contaViolazioni(db);
      const prima = (db.prepare("SELECT COUNT(*) AS n FROM network_devices").get() as { n: number }).n;
      for (const v of viste) db.exec(`DROP VIEW "${v.name}"`);
      db.exec(`DROP TABLE IF EXISTS ${NUOVA}`);
      db.exec(sqlNuova);
      db.exec(`INSERT INTO ${NUOVA} (${colonne}) SELECT ${colonne} FROM network_devices`);
      db.exec("DROP TABLE network_devices");
      db.exec(`ALTER TABLE ${NUOVA} RENAME TO network_devices`);
      for (const c of collegati) db.exec(c.sql);
      for (const v of viste) db.exec(v.sql);
      const dopo = (db.prepare("SELECT COUNT(*) AS n FROM network_devices").get() as { n: number }).n;
      if (dopo !== prima) throw new Error(`network_devices: ${prima} righe prima, ${dopo} dopo: ricostruzione annullata`);
      const violazioniDopo = contaViolazioni(db);
      if (violazioniDopo > violazioniPrima) {
        throw new Error(`network_devices: foreign_key_check da ${violazioniPrima} a ${violazioniDopo} violazioni: ricostruzione annullata`);
      }
      return dopo;
    })();
    return { eseguita: true, righe };
  } finally {
    if (fkPrima) db.pragma("foreign_keys = ON");
  }
}
