// scripts/credenziali/appoggio-pulizia.ts
/**
 * La pulizia della 2g (tappa 2 credenziali, T27 del piano
 * 2026-10-15-tappa2-archivio-credenziali): l'appoggio di `pulizia-t2.ts`.
 *
 * Si carica SOLO con `await import()` da `pulizia-t2.ts`, DOPO che lo script
 * ha spostato DA_INVENT_DATA_DIR e DA_IPAM_HUB_DB_PATH su --dati: db-tenant e
 * db-hub fissano i percorsi quando si caricano. Qui db-tenant si importa
 * staticamente, solo per il percorso della cartella dei tenant (ADR 0002:
 * l'import dinamico vietato è quello di db-tenant stesso).
 *
 * I DB tenant si aprono DIRETTAMENTE con better-sqlite3, non con getTenantDb:
 * niente migrazioni, i segni sono quelli del DB così com'è (a servizio fermo,
 * dopo il rilascio del codice della 2g, le migrazioni sono già girate).
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { cartellaTenant } from "../../src/lib/db-tenant";
import { getHubDbPath } from "../../src/lib/db-hub";

export { cartellaTenant, getHubDbPath };
export { applicaPuliziaDb, misuraCondizioniDb, pianoPuliziaDb, puliziaFatta, type PianoPulizia } from "../../src/lib/credentials/pulizia-t2";
export { backupAccanto, oraItaliana } from "../../src/lib/credentials/backup-accanto";

const CODICE_TENANT = /^([A-Za-z0-9_-]{1,64})\.db$/;

export function elencaTenant(): string[] {
  return fs
    .readdirSync(cartellaTenant())
    .map((f) => CODICE_TENANT.exec(f)?.[1])
    .filter((c): c is string => !!c)
    .sort();
}

/** Apre il DB del tenant (deve esistere), con le chiavi esterne attive come getTenantDb. */
export function apriTenant(code: string): { dbh: Database.Database; file: string } {
  const file = path.join(cartellaTenant(), `${code}.db`);
  const dbh = new Database(file, { fileMustExist: true });
  dbh.pragma("foreign_keys = ON");
  dbh.pragma("busy_timeout = 5000");
  return { dbh, file };
}
