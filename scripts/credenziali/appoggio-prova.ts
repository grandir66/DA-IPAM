// scripts/credenziali/appoggio-prova.ts
/**
 * Misure della prova a vuoto delle migrazioni della tappa 2 credenziali (T11
 * del piano 2026-10-15-tappa2-archivio-credenziali; si estende nei T16, T19,
 * T22 e T27).
 *
 * Si carica SOLO con `await import()` da `prova-a-vuoto.ts`, DOPO che lo
 * script ha spostato DA_INVENT_DATA_DIR e DA_IPAM_HUB_DB_PATH su --dati:
 * db-tenant e db-hub fissano i percorsi quando si caricano. Qui db-tenant si
 * importa staticamente (ADR 0002: l'import dinamico vietato è quello di
 * db-tenant stesso, non di un modulo che lo importa).
 *
 * Una misura legge, non scrive: righe e figli di `credentials`, violazioni
 * delle chiavi esterne, contatore, i segni `credenziali_t2_*` e le voci (id,
 * nome, tipo), che lo script stampa a terminale e mai su file.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { cartellaTenant, closeAllTenantDbs, closeTenantDb, getTenantDb, withTenant } from "../../src/lib/db-tenant";
import { closeHubDb, getHubDbPath } from "../../src/lib/db-hub";
import { statoCredenziali, type StatoCredenziali } from "../../src/lib/credentials/migra-credenziali-tipi";

export { cartellaTenant, getHubDbPath };

const CODICE_TENANT = /^([A-Za-z0-9_-]+)\.db$/;

export function elencaTenant(): string[] {
  return fs
    .readdirSync(cartellaTenant())
    .map((f) => CODICE_TENANT.exec(f)?.[1])
    .filter((c): c is string => !!c)
    .sort();
}

export interface Voce {
  id: number;
  name: string;
  credential_type: string;
}

export interface Misura {
  stato: StatoCredenziali;
  segni: Record<string, string>;
  voci: Voce[];
}

function misuraHandle(dbh: Database.Database): Misura {
  const haSettings = dbh.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tenant_settings'").get();
  const segni = haSettings
    ? Object.fromEntries(
        (dbh.prepare("SELECT key, value FROM tenant_settings WHERE key LIKE 'credenziali_t2_%' ORDER BY key").all() as Array<{ key: string; value: string }>).map(
          (r) => [r.key, r.value]
        )
      )
    : {};
  return {
    stato: statoCredenziali(dbh, { violazioni: true }),
    segni,
    voci: dbh.prepare("SELECT id, name, credential_type FROM credentials ORDER BY id").all() as Voce[],
  };
}

/** Misura in sola lettura, prima di qualunque migrazione: il file si apre in readonly e si chiude. */
export function misuraFile(code: string): Misura {
  const dbh = new Database(path.join(cartellaTenant(), `${code}.db`), { readonly: true, fileMustExist: true });
  try {
    return misuraHandle(dbh);
  } finally {
    dbh.close();
  }
}

/** Apre il tenant con getTenantDb (tutte le migrazioni, come al riavvio vero), misura e chiude. */
export function apriEMisura(code: string): Misura {
  try {
    const dbh = withTenant(code, () => getTenantDb(code));
    return misuraHandle(dbh);
  } finally {
    closeTenantDb(code);
  }
}

export function chiudiTutto(): void {
  closeAllTenantDbs();
  closeHubDb();
}
