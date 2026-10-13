/**
 * Banco delle prove di comportamento del gruppo 2 (T3-07, NUC-2).
 *
 * Le nove funzioni del gruppo 2 non fanno la stessa cosa nelle due copie: la
 * parità fallirebbe per definizione. Si prova invece il comportamento voluto
 * sulla funzione che esporta la facciata `@/lib/db`: rossa finché la facciata
 * ha la sua copia, verde quando la riesporta da `db-tenant.ts`.
 *
 * Gira su tenant temporanei: il file di prova importa per primo
 * `../support/data-dir-isolata`.
 */
import type Database from "better-sqlite3";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";

let progressivo = 0;

/**
 * Un tenant temporaneo vuoto, i dati di partenza, la chiamata dentro il suo
 * contesto. Il tenant si cancella sempre, anche se la prova fallisce.
 */
export function nelTenant<R>(nome: string, fixture: (db: Database.Database) => void, chiama: (db: Database.Database) => R): R {
  progressivo += 1;
  const codice = `COMPORTAMENTO${nome.toUpperCase().replace(/[^A-Z0-9]/g, "")}${process.pid}${progressivo}`;
  try {
    return withTenant(codice, () => {
      const db = getTenantDb(codice);
      fixture(db);
      return chiama(db);
    });
  } finally {
    deleteTenantDatabase(codice);
  }
}
