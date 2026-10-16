// scripts/credenziali/appoggio-condizioni.ts
/**
 * Misure delle condizioni della 2g (tappa 2 credenziali, T26 del piano
 * 2026-10-15-tappa2-archivio-credenziali), sulla COPIA dei dati.
 *
 * Si carica SOLO con `await import()` da `condizioni-2g.ts`, DOPO che lo
 * script ha spostato DA_INVENT_DATA_DIR e DA_IPAM_HUB_DB_PATH su --dati:
 * db-tenant e db-hub fissano i percorsi quando si caricano. Qui db-tenant si
 * importa staticamente, solo per il percorso della cartella dei tenant (ADR
 * 0002: l'import dinamico vietato è quello di db-tenant stesso).
 *
 * Ogni DB tenant della copia si apre DIRETTAMENTE con better-sqlite3, non con
 * getTenantDb: niente migrazioni, quindi i segni sono quelli della copia così
 * com'è, non quelli che un'apertura scriverebbe. Le due conversioni (2e e 2f)
 * si rifanno a vuoto, cioè dentro una transazione che si annulla: dicono chi
 * resterebbe fuori adesso, senza scrivere. I nomi degli apparati si leggono
 * per il terminale e non vanno su file.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { cartellaTenant } from "../../src/lib/db-tenant";
import { getHubDbPath } from "../../src/lib/db-hub";
import { misuraCondizioniDb, type MisuraCondizioni } from "../../src/lib/credentials/pulizia-t2";

export { cartellaTenant, getHubDbPath };

const CODICE_TENANT = /^([A-Za-z0-9_-]{1,64})\.db$/;

export function elencaTenant(): string[] {
  return fs
    .readdirSync(cartellaTenant())
    .map((f) => CODICE_TENANT.exec(f)?.[1])
    .filter((c): c is string => !!c)
    .sort();
}

/** Segni, lasciati della 2e e della 2f rifatte a vuoto, coi nomi (la stessa misura della pulizia, T27). */
export type MisuraTenant = MisuraCondizioni;

/** Segni, lasciati della 2e e della 2f rifatte a vuoto, coi nomi. Non scrive (tutto si annulla). */
export function misuraTenant(code: string): MisuraTenant {
  const dbh = new Database(path.join(cartellaTenant(), `${code}.db`), { fileMustExist: true });
  try {
    return misuraCondizioniDb(dbh, code);
  } finally {
    dbh.close();
  }
}
