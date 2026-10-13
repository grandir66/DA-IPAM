/**
 * Rigenera `data/ipam.empty.db` (template vuoto versionato in Git).
 * Imposta `DA_IPAM_DB_PATH` prima di importare `db-legacy.ts` e apre quel file
 * direttamente (T3-08): passando dalla facciata `getDb()`, su una macchina con
 * `data/hub.db` e un tenant DEFAULT si sarebbe aperto DEFAULT invece del modello.
 */
import fs from "fs";
import path from "path";

async function main(): Promise<void> {
  const root = process.cwd();
  const target = path.join(root, "data", "ipam.empty.db");

  for (const ext of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(target + ext);
    } catch {
      /* assente */
    }
  }

  process.env.DA_IPAM_DB_PATH = target;

  const { getLegacyDb, closeDb } = await import("../src/lib/db-legacy");
  const db = getLegacyDb();

  // Rimuovi tabelle temporanee orfane create dalle migrazioni (CREATE TABLE ... poi catch)
  const orphans = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%_new' OR name LIKE '%_ext' OR name LIKE '%_fix' OR name LIKE '%_winrm' OR name LIKE '%_nas')`).all() as { name: string }[]);
  for (const { name } of orphans) {
    db.exec(`DROP TABLE IF EXISTS "${name}"`);
  }

  db.pragma("journal_mode = DELETE");
  closeDb();

  for (const ext of ["-wal", "-shm"]) {
    try {
      fs.unlinkSync(target + ext);
    } catch {
      /* assente */
    }
  }

  console.log("Template aggiornato:", target);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
