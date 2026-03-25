#!/usr/bin/env tsx
/**
 * Completa il multi-tenant quando l’installazione ha già creato hub.db (es. dopo /setup)
 * ma manca ancora data/tenants/DEFAULT.db.
 *
 * In quel caso `npm run migrate:multitenant` non è utilizzabile: richiede l’assenza di hub.db.
 *
 * Cosa fa (con hub.db + ipam.db presenti, DEFAULT.db assente):
 * 1. Checkpoint WAL su ipam.db e copia → data/tenants/DEFAULT.db
 * 2. Inserisce il tenant DEFAULT in hub (se manca)
 * 3. Collega gli utenti non-superadmin a DEFAULT in user_tenant_access
 * 4. Se non c’è ancora un superadmin (installazioni vecchie con primo utente «admin»), promuove il primo
 *    utente «admin» (per id) a superadmin così compare il menu «Clienti»
 * 5. Rinomina ipam.db in backup (i dati operativi restano solo nel tenant DEFAULT)
 *
 * Prerequisito: fermare il processo che tiene aperti i DB (es. systemctl stop da-invent).
 *
 * Uso: npx tsx scripts/enable-multitenant.ts
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const IPAM_DB = path.join(DATA_DIR, "ipam.db");
const HUB_DB = path.join(DATA_DIR, "hub.db");
const TENANTS_DIR = path.join(DATA_DIR, "tenants");
const DEFAULT_DB = path.join(TENANTS_DIR, "DEFAULT.db");
const IPAM_BACKUP = path.join(DATA_DIR, "ipam.db.pre-enable-multitenant");

function copyDbWithSidecars(srcBase: string, destBase: string): void {
  fs.copyFileSync(srcBase, destBase);
  for (const ext of ["-wal", "-shm"] as const) {
    const s = srcBase + ext;
    const d = destBase + ext;
    if (fs.existsSync(s)) fs.copyFileSync(s, d);
  }
}

function renameDbWithSidecars(srcBase: string, destBase: string): void {
  fs.renameSync(srcBase, destBase);
  for (const ext of ["-wal", "-shm"] as const) {
    const s = srcBase + ext;
    const d = destBase + ext;
    if (fs.existsSync(s)) fs.renameSync(s, d);
  }
}

function log(msg: string) {
  console.log(`[enable-multitenant] ${msg}`);
}

function fatal(msg: string): never {
  console.error(`[enable-multitenant] ERRORE: ${msg}`);
  process.exit(1);
}

function main() {
  log("=== Completamento multi-tenant (hub già presente) ===\n");

  if (!fs.existsSync(HUB_DB)) {
    fatal(
      `Manca ${HUB_DB}. Se hai solo ipam.db, usa: npm run migrate:multitenant`
    );
  }

  if (fs.existsSync(DEFAULT_DB)) {
    log(`Esiste già ${DEFAULT_DB} — niente da copiare.`);
    ensureHubTenantAndAccess();
    log("\nGià in modalità multi-tenant (database tenant presente).");
    log("Se non vedi «Clienti», il tuo utente deve avere ruolo superadmin in hub.db.");
    return;
  }

  if (!fs.existsSync(IPAM_DB)) {
    fatal(
      `Manca ${IPAM_DB}. Senza copia dati non si può creare il tenant DEFAULT. Ripristina un backup o reinstalla.`
    );
  }

  fs.mkdirSync(TENANTS_DIR, { recursive: true });

  log(`Checkpoint WAL e copia ${IPAM_DB} → ${DEFAULT_DB} ...`);
  const ipam = new Database(IPAM_DB);
  try {
    ipam.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    ipam.close();
  }

  copyDbWithSidecars(IPAM_DB, DEFAULT_DB);

  log(`Backup: ${IPAM_DB} → ${IPAM_BACKUP}`);
  if (fs.existsSync(IPAM_BACKUP)) {
    fatal(`Esiste già ${IPAM_BACKUP}. Rinominalo o rimuovilo e riprova.`);
  }
  renameDbWithSidecars(IPAM_DB, IPAM_BACKUP);

  ensureHubTenantAndAccess();

  log("\n=== Completato ===");
  log(`Dati operativi: ${DEFAULT_DB}`);
  log(`Backup single-tenant: ${IPAM_BACKUP}`);
  log("Riavvia il servizio: systemctl start da-invent");
}

function ensureHubTenantAndAccess() {
  const hub = new Database(HUB_DB);
  hub.pragma("journal_mode = WAL");
  hub.pragma("foreign_keys = ON");

  try {
    let row = hub
      .prepare(`SELECT id FROM tenants WHERE codice_cliente = ?`)
      .get("DEFAULT") as { id: number } | undefined;

    if (!row) {
      hub
        .prepare(
          `INSERT INTO tenants (codice_cliente, ragione_sociale, active) VALUES (?, ?, 1)`
        )
        .run("DEFAULT", "Installazione iniziale");
      row = hub
        .prepare(`SELECT id FROM tenants WHERE codice_cliente = ?`)
        .get("DEFAULT") as { id: number };
      log(`Tenant DEFAULT creato (id=${row.id}).`);
    } else {
      log(`Tenant DEFAULT già presente (id=${row.id}).`);
    }

    const tenantId = row!.id;

    const superCount = (
      hub.prepare(`SELECT COUNT(*) as c FROM users WHERE role = 'superadmin'`).get() as {
        c: number;
      }
    ).c;
    if (superCount === 0) {
      const firstAdmin = hub
        .prepare(
          `SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`
        )
        .get() as { id: number } | undefined;
      if (firstAdmin) {
        hub.prepare(`UPDATE users SET role = 'superadmin' WHERE id = ?`).run(firstAdmin.id);
        log(
          `Primo utente admin (id=${firstAdmin.id}) promosso a superadmin — menu «Clienti» visibile dopo login.`
        );
      }
    }

    const users = hub
      .prepare(`SELECT id, role FROM users ORDER BY id`)
      .all() as Array<{ id: number; role: string }>;

    const ins = hub.prepare(
      `INSERT OR IGNORE INTO user_tenant_access (user_id, tenant_id, role) VALUES (?, ?, ?)`
    );

    const t = hub.transaction(() => {
      for (const u of users) {
        if (u.role === "superadmin") continue;
        const accessRole = u.role === "viewer" ? "viewer" : "admin";
        ins.run(u.id, tenantId, accessRole);
      }
    });
    t();
    log(`Associazioni utente ↔ tenant DEFAULT aggiornate (${users.length} utenti).`);
  } finally {
    hub.close();
  }
}

main();
