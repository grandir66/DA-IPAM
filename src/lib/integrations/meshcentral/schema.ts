/**
 * Schema modulo MeshCentral (RMM). Opt-in: tabelle create solo a feature install.
 * Idempotente (CREATE/INDEX IF NOT EXISTS). DROP in ordine FK inverso.
 * Nessun ALTER su core (hosts): binding via FK su PK INTEGER.
 * DDL = spec §6 verbatim.
 */
import type { Database } from "better-sqlite3";

export const MC_TABLES = [
  "mc_node",
  "mc_remote_session",
  "mc_node_bind",
  "mc_command_log",
] as const;
export type McTable = (typeof MC_TABLES)[number];

export const MC_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS mc_node (
  node_id        TEXT PRIMARY KEY,
  host_id        INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
  mesh_id        TEXT NOT NULL,
  name           TEXT,
  rname          TEXT,
  primary_ip     TEXT,
  primary_mac    TEXT,
  osdesc         TEXT,
  conn           INTEGER DEFAULT 0,
  last_connect   TEXT,
  match_status   TEXT,
  synced_at      TEXT DEFAULT (datetime('now')),
  created_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mc_node_host ON mc_node(host_id);
CREATE INDEX IF NOT EXISTS idx_mc_node_mesh ON mc_node(mesh_id);

CREATE TABLE IF NOT EXISTS mc_remote_session (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id          INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  node_id          TEXT REFERENCES mc_node(node_id) ON DELETE SET NULL,
  operator         TEXT NOT NULL,
  mesh_user        TEXT NOT NULL,
  viewmode         INTEGER,
  token_expire_min INTEGER,
  token_once       INTEGER DEFAULT 1,
  status           TEXT DEFAULT 'minted',
  created_at       TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mc_remote_session_host_ts ON mc_remote_session(host_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mc_node_bind (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id     TEXT NOT NULL,
  host_id     INTEGER NOT NULL,
  operator    TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Audit dell'esecuzione comandi remoti (Fase 2). Traccia CHI ha eseguito COSA e
-- DOVE: e' esecuzione di codice remoto, quindi deve restare una traccia anche
-- quando il comando fallisce.
-- L'OUTPUT non viene salvato di proposito: puo' contenere password, token o dati
-- del cliente (basti 'cat .env'), e finirebbe in chiaro nel DB e nei backup.
-- Restano il comando e l'esito; l'output vive solo nella risposta HTTP all'operatore.
CREATE TABLE IF NOT EXISTS mc_command_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id     INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  node_id     TEXT REFERENCES mc_node(node_id) ON DELETE SET NULL,
  operator    TEXT NOT NULL,
  command     TEXT NOT NULL,
  shell       TEXT NOT NULL DEFAULT 'auto',   -- auto | powershell
  run_as_user INTEGER NOT NULL DEFAULT 0,     -- 0 SYSTEM/root · 1 utente se possibile · 2 solo utente
  status      TEXT NOT NULL DEFAULT 'ok',     -- ok | error
  error       TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mc_command_log_host_ts ON mc_command_log(host_id, created_at DESC);
`;

/** Crea le tabelle del modulo MeshCentral nel DB tenant fornito (idempotente). */
export function applyMcSchemaMigrations(db: Database): void {
  db.exec(MC_SCHEMA_SQL);
}

/**
 * Rimuove le tabelle MeshCentral dal DB tenant. Ordine FK inverso:
 *   mc_remote_session → FK su mc_node + hosts
 *   mc_command_log    → FK su mc_node + hosts (va PRIMA di mc_node)
 *   mc_node           → FK su hosts (core, non droppata)
 *   mc_node_bind      → audit standalone
 */
export function dropMcSchema(db: Database): void {
  const order: McTable[] = ["mc_remote_session", "mc_command_log", "mc_node", "mc_node_bind"];
  for (const table of order) {
    db.exec(`DROP TABLE IF EXISTS ${table};`);
  }
}

/** True se tutte le tabelle del modulo esistono nel DB tenant. */
export function mcTablesExist(db: Database): boolean {
  const placeholders = MC_TABLES.map(() => "?").join(", ");
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN (${placeholders})`,
    )
    .get(...(MC_TABLES as unknown as string[])) as { n: number } | undefined;
  return (row?.n ?? 0) === MC_TABLES.length;
}
