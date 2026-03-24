#!/usr/bin/env tsx
/**
 * migrate-to-multitenant.ts
 *
 * Converte un'installazione single-tenant DA-IPAM in multi-tenant.
 *
 * Cosa fa:
 *   1. Verifica prerequisiti (ipam.db esiste, hub.db non esiste)
 *   2. Crea data/hub.db con lo schema hub e copia tabelle condivise
 *   3. Crea data/tenants/DEFAULT.db copiando ipam.db
 *   4. Rinomina ipam.db → ipam.db.pre-multitenant come backup
 *
 * Uso: tsx scripts/migrate-to-multitenant.ts
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// ---------- paths ----------
const DATA_DIR = path.resolve(__dirname, "..", "data");
const IPAM_DB_PATH = path.join(DATA_DIR, "ipam.db");
const HUB_DB_PATH = path.join(DATA_DIR, "hub.db");
const TENANTS_DIR = path.join(DATA_DIR, "tenants");
const DEFAULT_TENANT_DB_PATH = path.join(TENANTS_DIR, "DEFAULT.db");
const BACKUP_PATH = path.join(DATA_DIR, "ipam.db.pre-multitenant");

// ---------- hub schema (inlined from db-hub-schema.ts) ----------
// We import dynamically to avoid TS module resolution issues in scripts
const HUB_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codice_cliente TEXT NOT NULL UNIQUE,
  ragione_sociale TEXT NOT NULL,
  indirizzo TEXT,
  citta TEXT,
  provincia TEXT,
  cap TEXT,
  telefono TEXT,
  email TEXT,
  piva TEXT,
  cf TEXT,
  referente TEXT,
  note TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('superadmin', 'admin', 'viewer')),
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now')),
  last_login TEXT
);

CREATE TABLE IF NOT EXISTS user_tenant_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('admin', 'viewer')),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, tenant_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS nmap_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  args TEXT NOT NULL,
  snmp_community TEXT,
  custom_ports TEXT,
  tcp_ports TEXT,
  udp_ports TEXT,
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS snmp_vendor_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  enterprise_oid_prefixes TEXT NOT NULL DEFAULT '[]',
  sysdescr_pattern TEXT,
  fields TEXT NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL DEFAULT 0.90,
  enabled INTEGER NOT NULL DEFAULT 1,
  builtin INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS device_fingerprint_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  device_label TEXT NOT NULL,
  classification TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1,
  tcp_ports_key TEXT,
  tcp_ports_optional TEXT,
  min_key_ports INTEGER,
  oid_prefix TEXT,
  sysdescr_pattern TEXT,
  hostname_pattern TEXT,
  mac_vendor_pattern TEXT,
  banner_pattern TEXT,
  ttl_min INTEGER,
  ttl_max INTEGER,
  note TEXT,
  builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(name)
);

CREATE TABLE IF NOT EXISTS fingerprint_classification_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_kind TEXT NOT NULL CHECK(match_kind IN ('exact','contains')),
  pattern TEXT NOT NULL,
  classification TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(match_kind, pattern)
);

CREATE TABLE IF NOT EXISTS sysobj_lookup (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  oid TEXT NOT NULL UNIQUE,
  vendor TEXT NOT NULL,
  product TEXT NOT NULL,
  category TEXT NOT NULL,
  enterprise_id INTEGER NOT NULL,
  builtin INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
`;

const HUB_INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_tenants_codice ON tenants(codice_cliente);
CREATE INDEX IF NOT EXISTS idx_tenants_active ON tenants(active);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_tenant_access_user ON user_tenant_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_tenant_access_tenant ON user_tenant_access(tenant_id);
CREATE INDEX IF NOT EXISTS idx_snmp_vendor_profiles_category ON snmp_vendor_profiles(category);
CREATE INDEX IF NOT EXISTS idx_snmp_vendor_profiles_enabled ON snmp_vendor_profiles(enabled);
CREATE INDEX IF NOT EXISTS idx_device_fp_rules_pri ON device_fingerprint_rules(enabled, priority ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_fingerprint_class_map_pri ON fingerprint_classification_map(enabled, priority ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_sysobj_lookup_oid ON sysobj_lookup(oid);
CREATE INDEX IF NOT EXISTS idx_sysobj_lookup_enabled ON sysobj_lookup(enabled);
`;

// ---------- helpers ----------

function log(msg: string) {
  console.log(`[migrate] ${msg}`);
}

function fatal(msg: string): never {
  console.error(`[migrate] ERRORE: ${msg}`);
  process.exit(1);
}

function cleanup(createdFiles: string[], createdDirs: string[]) {
  for (const f of createdFiles) {
    try {
      if (fs.existsSync(f)) {
        fs.unlinkSync(f);
        log(`  Pulizia: rimosso ${f}`);
      }
    } catch { /* best effort */ }
  }
  for (const d of createdDirs) {
    try {
      if (fs.existsSync(d) && fs.readdirSync(d).length === 0) {
        fs.rmdirSync(d);
        log(`  Pulizia: rimossa directory ${d}`);
      }
    } catch { /* best effort */ }
  }
}

/**
 * Checks if a table exists in a database.
 */
function tableExists(db: InstanceType<typeof Database>, tableName: string): boolean {
  const row = db.prepare("SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name=?").get(tableName) as { cnt: number } | undefined;
  return (row?.cnt ?? 0) > 0;
}

/**
 * Copies all rows from srcDb.tableName to destDb.tableName.
 * The dest table must already exist. Columns are matched by name.
 * Extra columns in dest that don't exist in src get NULL/default.
 */
function copyTable(
  srcDb: InstanceType<typeof Database>,
  destDb: InstanceType<typeof Database>,
  tableName: string,
  options?: { extraColumns?: Record<string, unknown> }
): number {
  if (!tableExists(srcDb, tableName)) {
    log(`  Tabella ${tableName} non presente in ipam.db, skip.`);
    return 0;
  }

  const rows = srcDb.prepare(`SELECT * FROM ${tableName}`).all() as Record<string, unknown>[];
  if (rows.length === 0) {
    log(`  Tabella ${tableName}: 0 righe, skip.`);
    return 0;
  }

  // Get dest table columns
  const destCols = destDb.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[];
  const destColNames = new Set(destCols.map((c) => c.name));

  // Get src columns that exist in dest
  const srcCols = Object.keys(rows[0]).filter((c) => destColNames.has(c));
  const extraCols = options?.extraColumns ?? {};
  const allCols = [...srcCols, ...Object.keys(extraCols).filter((c) => !srcCols.includes(c))];

  const placeholders = allCols.map(() => "?").join(", ");
  const colList = allCols.join(", ");
  const insert = destDb.prepare(`INSERT INTO ${tableName} (${colList}) VALUES (${placeholders})`);

  const insertAll = destDb.transaction(() => {
    for (const row of rows) {
      const values = allCols.map((c) => {
        if (c in extraCols) return extraCols[c];
        return row[c] ?? null;
      });
      insert.run(...values);
    }
  });

  insertAll();
  return rows.length;
}

// ---------- main ----------

function main() {
  log("=== Migrazione DA-IPAM single-tenant → multi-tenant ===\n");

  // Track created files for rollback
  const createdFiles: string[] = [];
  const createdDirs: string[] = [];

  try {
    // ---- Step 0: Prerequisites ----
    log("Step 0: Verifica prerequisiti...");

    if (!fs.existsSync(IPAM_DB_PATH)) {
      fatal(`File ${IPAM_DB_PATH} non trovato. Nessuna installazione da migrare.`);
    }
    log(`  OK: ${IPAM_DB_PATH} trovato.`);

    if (fs.existsSync(HUB_DB_PATH)) {
      fatal(`File ${HUB_DB_PATH} esiste già. Migrazione già eseguita? Rimuoverlo manualmente per ripetere.`);
    }
    log(`  OK: ${HUB_DB_PATH} non esiste.`);

    if (fs.existsSync(DEFAULT_TENANT_DB_PATH)) {
      fatal(`File ${DEFAULT_TENANT_DB_PATH} esiste già. Rimuoverlo manualmente per ripetere.`);
    }
    log(`  OK: ${DEFAULT_TENANT_DB_PATH} non esiste.`);

    if (fs.existsSync(BACKUP_PATH)) {
      fatal(`File ${BACKUP_PATH} esiste già. Migrazione precedente incompleta? Verificare manualmente.`);
    }
    log(`  OK: Nessun backup precedente trovato.\n`);

    // Open source DB
    const srcDb = new Database(IPAM_DB_PATH, { readonly: true });

    // ---- Step 1: Create hub.db ----
    log("Step 1: Creazione hub.db...");
    const hubDb = new Database(HUB_DB_PATH);
    createdFiles.push(HUB_DB_PATH);

    hubDb.pragma("journal_mode = WAL");
    hubDb.pragma("foreign_keys = ON");
    hubDb.exec(HUB_SCHEMA_SQL);
    hubDb.exec(HUB_INDEXES_SQL);
    log("  Schema hub creato.\n");

    // ---- Step 2: Insert DEFAULT tenant ----
    log("Step 2: Inserimento tenant DEFAULT...");
    const tenantInsert = hubDb.prepare(
      `INSERT INTO tenants (codice_cliente, ragione_sociale, active) VALUES (?, ?, 1)`
    );
    const tenantResult = tenantInsert.run("DEFAULT", "Installazione iniziale");
    const defaultTenantId = tenantResult.lastInsertRowid as number;
    log(`  Tenant DEFAULT creato con id=${defaultTenantId}.\n`);

    // ---- Step 3: Copy users ----
    log("Step 3: Copia utenti → hub.db...");
    if (tableExists(srcDb, "users")) {
      const srcUsers = srcDb.prepare("SELECT * FROM users").all() as {
        id: number;
        username: string;
        password_hash: string;
        role: string;
        created_at: string | null;
        last_login: string | null;
      }[];

      if (srcUsers.length > 0) {
        // Find the first admin user to promote to superadmin
        const firstAdmin = srcUsers.find((u) => u.role === "admin") ?? srcUsers[0];

        const insertUser = hubDb.prepare(
          `INSERT INTO users (id, username, password_hash, role, tenant_id, created_at, last_login)
           VALUES (?, ?, ?, ?, NULL, ?, ?)`
        );
        const insertAccess = hubDb.prepare(
          `INSERT INTO user_tenant_access (user_id, tenant_id, role) VALUES (?, ?, ?)`
        );

        const copyUsers = hubDb.transaction(() => {
          for (const u of srcUsers) {
            const hubRole = u.id === firstAdmin.id ? "superadmin" : u.role;
            insertUser.run(u.id, u.username, u.password_hash, hubRole, u.created_at, u.last_login);
            // Access entry: admin users get 'admin', viewer users get 'viewer'
            const accessRole = u.role === "viewer" ? "viewer" : "admin";
            insertAccess.run(u.id, defaultTenantId, accessRole);
          }
        });
        copyUsers();
        log(`  ${srcUsers.length} utente/i copiato/i. "${firstAdmin.username}" promosso a superadmin.`);
      } else {
        log("  Nessun utente trovato in ipam.db.");
      }
    } else {
      log("  Tabella users non presente, skip.");
    }
    log("");

    // ---- Step 4: Copy shared tables ----
    log("Step 4: Copia tabelle condivise → hub.db...");
    const sharedTables = [
      "settings",
      "nmap_profiles",
      "snmp_vendor_profiles",
      "device_fingerprint_rules",
      "fingerprint_classification_map",
      "sysobj_lookup",
    ];
    for (const table of sharedTables) {
      const count = copyTable(srcDb, hubDb, table);
      if (count > 0) {
        log(`  ${table}: ${count} righe copiate.`);
      }
    }
    log("");

    // ---- Step 5: Create tenants directory and copy tenant DB ----
    log("Step 5: Creazione directory tenants e copia DB tenant...");
    if (!fs.existsSync(TENANTS_DIR)) {
      fs.mkdirSync(TENANTS_DIR, { recursive: true });
      createdDirs.push(TENANTS_DIR);
      log(`  Directory ${TENANTS_DIR} creata.`);
    }

    // Close source before copying
    srcDb.close();

    fs.copyFileSync(IPAM_DB_PATH, DEFAULT_TENANT_DB_PATH);
    createdFiles.push(DEFAULT_TENANT_DB_PATH);
    log(`  ${IPAM_DB_PATH} → ${DEFAULT_TENANT_DB_PATH} copiato.`);

    // Also copy WAL/SHM files if they exist (to ensure consistency)
    for (const suffix of ["-wal", "-shm"]) {
      const src = IPAM_DB_PATH + suffix;
      const dest = DEFAULT_TENANT_DB_PATH + suffix;
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        log(`  Copiato anche ${path.basename(src)}.`);
      }
    }
    log("");

    // ---- Step 6: Close hub and create backup ----
    log("Step 6: Chiusura hub.db e backup ipam.db...");
    hubDb.close();

    fs.renameSync(IPAM_DB_PATH, BACKUP_PATH);
    log(`  ${IPAM_DB_PATH} → ${BACKUP_PATH} rinominato.`);

    // Also rename WAL/SHM if they exist
    for (const suffix of ["-wal", "-shm"]) {
      const src = IPAM_DB_PATH + suffix;
      if (fs.existsSync(src)) {
        fs.renameSync(src, BACKUP_PATH + suffix);
        log(`  Rinominato anche ${path.basename(src)}.`);
      }
    }
    log("");

    // ---- Summary ----
    log("=== MIGRAZIONE COMPLETATA ===\n");
    log("File creati:");
    log(`  ${HUB_DB_PATH}          — Database hub (utenti, tenant, config globale)`);
    log(`  ${DEFAULT_TENANT_DB_PATH} — Database tenant DEFAULT (dati operativi)`);
    log("");
    log("Backup:");
    log(`  ${BACKUP_PATH} — Backup del DB originale`);
    log("");
    log("Rollback:");
    log("  Per annullare la migrazione:");
    log(`    1. rm ${HUB_DB_PATH}`);
    log(`    2. rm -rf ${TENANTS_DIR}`);
    log(`    3. mv ${BACKUP_PATH} ${IPAM_DB_PATH}`);
    log("");
  } catch (err) {
    console.error(`\n[migrate] ERRORE FATALE: ${err instanceof Error ? err.message : err}`);
    log("Pulizia file parziali...");
    cleanup(createdFiles, createdDirs);

    // If ipam.db was renamed, restore it
    if (!fs.existsSync(IPAM_DB_PATH) && fs.existsSync(BACKUP_PATH)) {
      fs.renameSync(BACKUP_PATH, IPAM_DB_PATH);
      log(`  Ripristinato ${IPAM_DB_PATH} dal backup.`);
    }

    process.exit(1);
  }
}

main();
