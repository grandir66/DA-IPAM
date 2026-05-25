/**
 * Schema modulo Patch Management.
 *
 * Migrazione opt-in: le tabelle vengono create SOLO quando l'admin installa
 * il modulo via POST /api/features/patch_management/install. Disinstallazione
 * con dropData=true rimuove tutte le tabelle (ordine inverso per FK).
 *
 * Vincoli:
 *  - Nessun ALTER su tabelle core (software_inventory, hosts). Il binding
 *    avviene via FK su PK INTEGER esistenti.
 *  - Idempotente: ri-esecuzione di applyPatchModuleMigrations non fallisce
 *    (tutti i CREATE/INDEX sono IF NOT EXISTS).
 *  - Nessun import dal core verso questo file (loose coupling per feature OFF).
 */
import type { Database } from "better-sqlite3";

export const PATCH_MODULE_TABLES = [
  "patch_software_meta",
  "patch_operations",
  "patch_operation_logs",
  "patch_cve_target",
] as const;

export type PatchModuleTable = (typeof PATCH_MODULE_TABLES)[number];

export const PATCH_MODULE_SCHEMA_SQL = `
-- Tabella shadow 1:1 con software_inventory (NO ALTER su software_inventory)
CREATE TABLE IF NOT EXISTS patch_software_meta (
  software_id        INTEGER PRIMARY KEY,
  cpe                TEXT,                        -- best-effort, può restare NULL
  choco_id           TEXT,                        -- es. 'firefox', 'googlechrome'
  winget_id          TEXT,                        -- riservato, vuoto in PR1
  match_strategy     TEXT,                        -- 'wazuh-package' | 'dictionary' | 'manual' | 'name-fuzzy'
  match_confidence   REAL,                        -- 0.0..1.0
  last_matched_at    TEXT,                        -- ISO8601
  FOREIGN KEY (software_id) REFERENCES software_inventory(id) ON DELETE CASCADE
);

-- Operazione = un singolo comando lanciato su un singolo host (audit + stato)
CREATE TABLE IF NOT EXISTS patch_operations (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id                  INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  user_id                  INTEGER NOT NULL,                   -- users.id (hub), audit NIS2
  cve_id                   TEXT,                               -- NULL se manual single-package senza CVE
  package_manager          TEXT NOT NULL DEFAULT 'choco' CHECK(package_manager IN ('choco')),
  package_id               TEXT,                               -- es. 'firefox'; NULL per probe/bootstrap
  package_version_before   TEXT,                               -- versione installata pre-upgrade
  package_version_target   TEXT,                               -- 'latest' o version pinned
  package_version_after    TEXT,                               -- versione installata post-upgrade
  action                   TEXT NOT NULL CHECK(action IN ('probe','bootstrap','upgrade','install','uninstall','rollback')),
  status                   TEXT NOT NULL CHECK(status IN ('queued','running','success','failed','reboot_pending','cancelled')),
  exit_code                INTEGER,
  started_at               TEXT,                               -- ISO8601 UTC
  finished_at              TEXT,
  reboot_required          INTEGER NOT NULL DEFAULT 0,
  log_file_path            TEXT,                               -- 'C:\\ProgramData\\DA-IPAM\\op-<id>.log'
  log_offset               INTEGER NOT NULL DEFAULT 0,         -- per tail polling
  error_message            TEXT
);

-- Output streaming (riempito dal tail poller)
CREATE TABLE IF NOT EXISTS patch_operation_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id    INTEGER NOT NULL REFERENCES patch_operations(id) ON DELETE CASCADE,
  ts              TEXT NOT NULL,                  -- ISO8601 UTC
  stream          TEXT NOT NULL CHECK(stream IN ('stdout','stderr','system')),
  line            TEXT NOT NULL
);

-- Mapping CVE → riga software_inventory (popolato dal matcher)
CREATE TABLE IF NOT EXISTS patch_cve_target (
  cve_id              TEXT NOT NULL,
  software_id         INTEGER NOT NULL REFERENCES software_inventory(id) ON DELETE CASCADE,
  match_strategy      TEXT NOT NULL CHECK(match_strategy IN ('wazuh-package','dictionary','manual','name-fuzzy')),
  confidence          REAL NOT NULL,
  fix_package_manager TEXT,
  fix_package_id      TEXT,
  fix_version         TEXT,                       -- versione fix nota (da Wazuh advisory) o NULL
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (cve_id, software_id)
);

CREATE INDEX IF NOT EXISTS idx_patch_ops_host ON patch_operations(host_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_patch_ops_cve  ON patch_operations(cve_id);
CREATE INDEX IF NOT EXISTS idx_patch_ops_status ON patch_operations(status);
CREATE INDEX IF NOT EXISTS idx_patch_logs_op ON patch_operation_logs(operation_id, id);
CREATE INDEX IF NOT EXISTS idx_patch_meta_choco ON patch_software_meta(choco_id);
CREATE INDEX IF NOT EXISTS idx_patch_cve_target_cve ON patch_cve_target(cve_id);
`;

/**
 * Applica le migration del modulo patch al DB tenant fornito.
 * Idempotente: tutte le DDL sono IF NOT EXISTS.
 *
 * Ritorna l'elenco delle tabelle gestite dal modulo (sempre il set completo,
 * non un diff vs lo stato pre-esistente).
 */
export function applyPatchModuleMigrations(
  db: Database
): { tablesCreated: string[] } {
  db.exec(PATCH_MODULE_SCHEMA_SQL);
  return { tablesCreated: PATCH_MODULE_TABLES.slice() };
}

/**
 * Rimuove tutte le tabelle del modulo patch dal DB tenant fornito.
 * Ordine: figli (FK) prima dei padri.
 *
 *   patch_operation_logs  → FK su patch_operations
 *   patch_operations      → FK su hosts (core, non droppata)
 *   patch_cve_target      → FK su software_inventory (core, non droppata)
 *   patch_software_meta   → FK su software_inventory (core, non droppata)
 */
export function dropPatchModuleSchema(
  db: Database
): { tablesDropped: string[] } {
  const order: PatchModuleTable[] = [
    "patch_operation_logs",
    "patch_operations",
    "patch_cve_target",
    "patch_software_meta",
  ];
  const dropped: string[] = [];
  for (const table of order) {
    db.exec(`DROP TABLE IF EXISTS ${table};`);
    dropped.push(table);
  }
  return { tablesDropped: dropped };
}

/**
 * Ritorna true se TUTTE e 4 le tabelle del modulo esistono nel DB tenant.
 * Utile per evitare DROP rumoroso quando il modulo non è mai stato installato.
 */
export function patchModuleTablesExist(db: Database): boolean {
  const placeholders = PATCH_MODULE_TABLES.map(() => "?").join(", ");
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM sqlite_master
        WHERE type = 'table'
          AND name IN (${placeholders})`
    )
    .get(...PATCH_MODULE_TABLES) as { n: number } | undefined;
  return (row?.n ?? 0) === PATCH_MODULE_TABLES.length;
}
