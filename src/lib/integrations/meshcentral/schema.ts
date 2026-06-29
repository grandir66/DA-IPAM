/**
 * Schema modulo MeshCentral (RMM). Opt-in: tabelle create solo a feature install.
 * Idempotente (CREATE/INDEX IF NOT EXISTS). DROP in ordine FK inverso.
 * Nessun ALTER su core (hosts): binding via FK su PK INTEGER.
 * DDL = spec §6 verbatim.
 */
import type { Database } from "better-sqlite3";

export const MC_TABLES = ["mc_node", "mc_remote_session", "mc_node_bind"] as const;
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
`;

/** Crea le tabelle del modulo MeshCentral nel DB tenant fornito (idempotente). */
export function applyMcSchemaMigrations(db: Database): void {
  db.exec(MC_SCHEMA_SQL);
}

/**
 * Rimuove le tabelle MeshCentral dal DB tenant. Ordine FK inverso:
 *   mc_remote_session → FK su mc_node + hosts
 *   mc_node           → FK su hosts (core, non droppata)
 *   mc_node_bind      → audit standalone
 */
export function dropMcSchema(db: Database): void {
  const order: McTable[] = ["mc_remote_session", "mc_node", "mc_node_bind"];
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
