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

/** Data ISO (`toISOString`, con la `T` e la `Z`) di `giorni` giorni fa. */
function isoGiorniFa(giorni: number): string {
  return new Date(Date.now() - giorni * 86_400_000).toISOString();
}

/**
 * Un'integrazione AD (id 1) e cinque oggetti in `tabella` (`ad_computers` o
 * `ad_users`) con l'ultimo accesso nelle forme che scrive la sincronizzazione:
 * - «recente-iso»: 2 giorni fa, forma ISO con la `T`;
 * - «recente-sqlite»: 2 giorni fa, forma di SQLite con lo spazio;
 * - «confine»: il giorno di 7 giorni fa a mezzanotte, forma ISO: fuori dalla
 *   finestra di 7 giorni, ma la `T` è maggiore dello spazio e un confronto fra
 *   testi lo teneva dentro;
 * - «vecchio»: 30 giorni fa; «mai»: nessun accesso.
 */
export function adConAccessi(tabella: "ad_computers" | "ad_users"): (db: Database.Database) => void {
  return (db) => {
    db.prepare(
      "INSERT INTO ad_integrations (id, name, dc_host, domain, base_dn, encrypted_username, encrypted_password) VALUES (1, 'Dominio', 'dc01', 'dominio.local', 'DC=dominio,DC=local', 'u', 'p')",
    ).run();
    // ad_computers vuole il DN; ad_users non ha la colonna e tiene l'OU.
    const dove = tabella === "ad_computers" ? "distinguished_name" : "ou";
    const ins = db.prepare(
      `INSERT INTO ${tabella} (integration_id, object_guid, sam_account_name, ${dove}, last_logon_at) VALUES (1, ?, ?, ?, ?)`,
    );
    const recenteSqlite = isoGiorniFa(2).replace("T", " ").slice(0, 19);
    const confine = `${isoGiorniFa(7).slice(0, 10)}T00:00:00.000Z`;
    for (const [nome, quando] of [
      ["recente-iso", isoGiorniFa(2)],
      ["recente-sqlite", recenteSqlite],
      ["confine", confine],
      ["vecchio", isoGiorniFa(30)],
      ["mai", null],
    ] as const) {
      ins.run(`guid-${nome}`, nome, `CN=${nome}`, quando);
    }
  };
}
