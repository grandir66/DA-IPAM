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
import { convertiCredenzialiApparati } from "../../src/lib/credentials/converti-apparati";
import { convertiControllerEAd } from "../../src/lib/credentials/converti-integrazioni";
import { leggiSegno, SEGNO_APPARATI, SEGNO_CATENE, SEGNO_INTEGRAZIONI, SEGNO_TIPI } from "../../src/lib/credentials/segni-t2";
import type { SegniT2, StatoTenant2g } from "../../src/lib/credentials/condizioni-2g";

export { cartellaTenant, getHubDbPath };

const CODICE_TENANT = /^([A-Za-z0-9_-]{1,64})\.db$/;

export function elencaTenant(): string[] {
  return fs
    .readdirSync(cartellaTenant())
    .map((f) => CODICE_TENANT.exec(f)?.[1])
    .filter((c): c is string => !!c)
    .sort();
}

export interface MisuraTenant {
  stato: StatoTenant2g;
  /** Nomi degli apparati e delle righe lasciate, per il terminale. */
  nomiApparati: Record<number, string>;
  /** Le conversioni a vuoto che non sono riuscite (chiave assente, DB rotto…). */
  nonMisurabili: string[];
}

function haTabella(dbh: Database.Database, nome: string): boolean {
  return !!dbh.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(nome);
}

function segni(dbh: Database.Database): SegniT2 {
  if (!haTabella(dbh, "tenant_settings")) return { tipi: null, catene: null, apparati: null, integrazioni: null };
  return {
    tipi: leggiSegno(dbh, SEGNO_TIPI),
    catene: leggiSegno(dbh, SEGNO_CATENE),
    apparati: leggiSegno(dbh, SEGNO_APPARATI),
    integrazioni: leggiSegno(dbh, SEGNO_INTEGRAZIONI),
  };
}

function messaggio(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Segni, lasciati della 2e e della 2f rifatte a vuoto, coi nomi. Non scrive (tutto si annulla). */
export function misuraTenant(code: string): MisuraTenant {
  const dbh = new Database(path.join(cartellaTenant(), `${code}.db`), { fileMustExist: true });
  try {
    const nonMisurabili: string[] = [];
    const stato: StatoTenant2g = { tenant: code, segni: segni(dbh), lasciatiApparati: [], lasciatiIntegrazioni: [] };
    try {
      stato.lasciatiApparati = convertiCredenzialiApparati(dbh, { aVuoto: true }).lasciati;
    } catch (e) {
      nonMisurabili.push(`conversione degli apparati (2e) a vuoto non riuscita: ${messaggio(e)}`);
    }
    try {
      stato.lasciatiIntegrazioni = convertiControllerEAd(dbh, { aVuoto: true }).lasciati;
    } catch (e) {
      nonMisurabili.push(`conversione di controller e AD (2f) a vuoto non riuscita: ${messaggio(e)}`);
    }
    const nomiApparati: Record<number, string> = {};
    const nome = dbh.prepare("SELECT name FROM network_devices WHERE id = ?");
    for (const l of stato.lasciatiApparati) {
      const r = nome.get(l.device_id) as { name: string } | undefined;
      nomiApparati[l.device_id] = r?.name ?? "?";
    }
    return { stato, nomiApparati, nonMisurabili };
  } finally {
    dbh.close();
  }
}
