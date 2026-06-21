/**
 * Schema modulo Inventory Agent (ingest push GLPI JSON).
 * Applicato on install via POST /api/features/inventory_agent/install.
 */
import type { Database } from "better-sqlite3";

export const INVENTORY_AGENT_TABLES = [
  "inv_agent_software",
  "inv_agent_report",
  "inv_agent_endpoint",
] as const;

export const INVENTORY_AGENT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS inv_agent_endpoint (
  device_id TEXT PRIMARY KEY,
  host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
  hostname TEXT,
  primary_ip TEXT,
  primary_mac TEXT,
  os_family TEXT CHECK(os_family IN ('windows','linux','macos','other')),
  os_name TEXT,
  os_version TEXT,
  agent_tag TEXT,
  last_report_id INTEGER,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inv_agent_report (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL REFERENCES inv_agent_endpoint(device_id) ON DELETE CASCADE,
  host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  match_status TEXT NOT NULL DEFAULT 'unmatched' CHECK(match_status IN ('matched','unmatched')),
  apps_count INTEGER NOT NULL DEFAULT 0,
  payload_hash TEXT,
  agent_version TEXT,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS inv_agent_software (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES inv_agent_report(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  version TEXT,
  publisher TEXT,
  install_date TEXT,
  install_location TEXT,
  source TEXT,
  architecture TEXT,
  size_bytes INTEGER
);
`;

export const INVENTORY_AGENT_INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_inv_agent_endpoint_host ON inv_agent_endpoint(host_id);
CREATE INDEX IF NOT EXISTS idx_inv_agent_report_device ON inv_agent_report(device_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_agent_software_report ON inv_agent_software(report_id);
CREATE INDEX IF NOT EXISTS idx_inv_agent_software_name ON inv_agent_software(name, version);
`;

export function applyInventoryAgentMigrations(db: Database): { tablesCreated: string[] } {
  db.exec(INVENTORY_AGENT_SCHEMA_SQL);
  db.exec(INVENTORY_AGENT_INDEXES_SQL);
  return { tablesCreated: [...INVENTORY_AGENT_TABLES] };
}

export function dropInventoryAgentSchema(db: Database): void {
  for (const table of INVENTORY_AGENT_TABLES) {
    db.exec(`DROP TABLE IF EXISTS ${table}`);
  }
}
