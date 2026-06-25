// src/lib/transfer/schema-introspect.ts
import type Database from "better-sqlite3";

export function listTables(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  return rows.map((r) => r.name);
}

export interface ColumnInfo {
  name: string;
  generated: boolean;
  notnull: boolean;
  hasDefault: boolean;
  pk: boolean;
}

/** Usa table_xinfo: la colonna `hidden` vale 2 o 3 per le GENERATED. */
export function tableColumns(db: Database.Database, table: string): ColumnInfo[] {
  const rows = db.prepare(`PRAGMA table_xinfo(${quoteIdent(table)})`).all() as {
    name: string; notnull: number; dflt_value: unknown; pk: number; hidden: number;
  }[];
  return rows.map((r) => ({
    name: r.name,
    generated: r.hidden === 2 || r.hidden === 3,
    notnull: r.notnull === 1,
    hasDefault: r.dflt_value !== null,
    pk: r.pk > 0,
  }));
}

export function writableColumns(db: Database.Database, table: string): string[] {
  return tableColumns(db, table).filter((c) => !c.generated).map((c) => c.name);
}

/** Colonna cifrata con la chiave d'installazione (richiede re-key in export/import). */
export function isRekeyColumn(name: string): boolean {
  return /encrypt|_enc$/i.test(name);
}

export function rekeyColumns(db: Database.Database, table: string): string[] {
  return writableColumns(db, table).filter(isRekeyColumn);
}

/** Quote identificatore SQLite (i nomi tabella vengono dal registry, non da input utente). */
function quoteIdent(ident: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ident)) throw new Error(`Identificatore non valido: ${ident}`);
  return `"${ident}"`;
}
