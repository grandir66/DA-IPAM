/**
 * Event store per gli alert Wazuh selezionati.
 *
 * Modello: un "evento aperto" per coppia (agent, regola). Una raffica di
 * brute-force diventa UN evento con occurrence_count che sale, non centinaia di
 * righe. Dopo l'acknowledge l'evento resta a storico e un alert successivo ne
 * apre uno nuovo — così un problema che si ripresenta torna visibile.
 *
 * Lo schema vive qui e non in db-tenant-schema.ts (stesso pattern di
 * ad/health/persist.ts e meshcentral): `ensureWazuhAlertSchema` è idempotente e
 * viene chiamata da sync e API, il che rende il modulo testabile su :memory:.
 */

import type { Database } from "better-sqlite3";
import { getTenantDb, getCurrentTenantCode } from "../db-tenant";
import { categoryById, dedupKey, type NormalizedAlert } from "./wazuh-alerts";

export function tenantDb(): Database {
  const code = getCurrentTenantCode();
  if (!code) throw new Error("Nessun contesto tenant attivo");
  return getTenantDb(code) as unknown as Database;
}

export function ensureWazuhAlertSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wazuh_alert_event (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dedup_key TEXT NOT NULL,
      category TEXT NOT NULL,
      diagnostic INTEGER NOT NULL DEFAULT 0,
      rule_id TEXT,
      rule_level INTEGER NOT NULL DEFAULT 0,
      rule_description TEXT,
      agent_id TEXT,
      agent_name TEXT,
      event_id TEXT,
      target_user TEXT,
      source_ip TEXT,
      occurrence_count INTEGER NOT NULL DEFAULT 1,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      acknowledged INTEGER NOT NULL DEFAULT 0,
      acknowledged_at TEXT,
      acknowledged_by TEXT,
      notified_at TEXT,
      raw_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- Al massimo un evento APERTO per (agent, regola): è il dedup, imposto dal DB
    CREATE UNIQUE INDEX IF NOT EXISTS idx_wazuh_alert_event_open
      ON wazuh_alert_event(dedup_key) WHERE acknowledged = 0;
    CREATE INDEX IF NOT EXISTS idx_wazuh_alert_event_seen
      ON wazuh_alert_event(acknowledged, last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_wazuh_alert_event_category
      ON wazuh_alert_event(category, last_seen_at DESC);

    CREATE TABLE IF NOT EXISTS wazuh_alert_sync_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_timestamp TEXT,
      cursor_json TEXT,
      last_run_at TEXT,
      last_error TEXT,
      last_digest_at TEXT
    );
  `);

  // Tabelle create prima dell'introduzione delle notifiche: additivo e idempotente.
  try {
    db.exec("ALTER TABLE wazuh_alert_event ADD COLUMN notified_at TEXT");
  } catch {
    /* colonna già presente */
  }
  try {
    db.exec("ALTER TABLE wazuh_alert_sync_state ADD COLUMN last_digest_at TEXT");
  } catch {
    /* colonna già presente */
  }
}

export interface WazuhAlertEventRow {
  id: number;
  dedup_key: string;
  category: string;
  diagnostic: number;
  rule_id: string | null;
  rule_level: number;
  rule_description: string | null;
  agent_id: string | null;
  agent_name: string | null;
  event_id: string | null;
  target_user: string | null;
  source_ip: string | null;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  acknowledged: number;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  notified_at: string | null;
  raw_json: string | null;
  created_at: string;
}

export interface UpsertResult {
  created: boolean;
  /** Alert fuori dalla selezione curata: non persistito. */
  skipped?: boolean;
}

/**
 * Apre un evento o aggiorna quello aperto corrispondente.
 * Rifiuta gli alert senza categoria o sotto la soglia della categoria.
 */
export function upsertAlertEvent(db: Database, a: NormalizedAlert): UpsertResult {
  if (!a.category) return { created: false, skipped: true };
  const cat = categoryById(a.category);
  if (!cat || a.ruleLevel < cat.minLevel) return { created: false, skipped: true };

  const key = dedupKey(a);
  const open = db
    .prepare(
      "SELECT id, first_seen_at, last_seen_at FROM wazuh_alert_event WHERE dedup_key = ? AND acknowledged = 0",
    )
    .get(key) as { id: number; first_seen_at: string; last_seen_at: string } | undefined;

  if (open) {
    db.prepare(
      `UPDATE wazuh_alert_event
         SET occurrence_count = occurrence_count + 1,
             last_seen_at = MAX(last_seen_at, ?),
             first_seen_at = MIN(first_seen_at, ?),
             rule_level = ?,
             event_id = COALESCE(?, event_id),
             target_user = COALESCE(?, target_user),
             source_ip = COALESCE(?, source_ip)
       WHERE id = ?`,
    ).run(
      a.timestamp,
      a.timestamp,
      a.ruleLevel,
      a.eventId,
      a.targetUser,
      a.sourceIp,
      open.id,
    );
    return { created: false };
  }

  db.prepare(
    `INSERT INTO wazuh_alert_event (
       dedup_key, category, diagnostic, rule_id, rule_level, rule_description,
       agent_id, agent_name, event_id, target_user, source_ip,
       occurrence_count, first_seen_at, last_seen_at, raw_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  ).run(
    key,
    a.category,
    cat.diagnostic ? 1 : 0,
    a.ruleId,
    a.ruleLevel,
    a.ruleDescription,
    a.agentId,
    a.agentName,
    a.eventId,
    a.targetUser,
    a.sourceIp,
    a.timestamp,
    a.timestamp,
    JSON.stringify({ groups: a.groups }),
  );
  return { created: true };
}

export function listAlertEvents(
  db: Database,
  filter: {
    category?: string;
    onlyOpen?: boolean;
    includeDiagnostic?: boolean;
    limit?: number;
    offset?: number;
  },
): WazuhAlertEventRow[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.category) {
    where.push("category = ?");
    params.push(filter.category);
  }
  if (filter.onlyOpen) where.push("acknowledged = 0");
  if (filter.includeDiagnostic === false) where.push("diagnostic = 0");
  const sql =
    "SELECT * FROM wazuh_alert_event" +
    (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
    " ORDER BY acknowledged ASC, last_seen_at DESC LIMIT ? OFFSET ?";
  params.push(filter.limit ?? 200, filter.offset ?? 0);
  return db.prepare(sql).all(...params) as WazuhAlertEventRow[];
}

export function acknowledgeAlertEvent(
  db: Database,
  id: number,
  by: string,
): boolean {
  const res = db
    .prepare(
      `UPDATE wazuh_alert_event
          SET acknowledged = 1, acknowledged_at = datetime('now'), acknowledged_by = ?
        WHERE id = ? AND acknowledged = 0`,
    )
    .run(by, id);
  return res.changes > 0;
}

/** Eventi aperti mai notificati: input sia dell'invio immediato sia del digest. */
export function listUnnotifiedEvents(db: Database): WazuhAlertEventRow[] {
  return db
    .prepare(
      `SELECT * FROM wazuh_alert_event
        WHERE notified_at IS NULL AND acknowledged = 0
        ORDER BY last_seen_at ASC`,
    )
    .all() as WazuhAlertEventRow[];
}

export function markEventsNotified(db: Database, ids: number[]): void {
  if (ids.length === 0) return;
  const stmt = db.prepare(
    "UPDATE wazuh_alert_event SET notified_at = datetime('now') WHERE id = ?",
  );
  const run = db.transaction((list: number[]) => {
    for (const id of list) stmt.run(id);
  });
  run(ids);
}

/**
 * Retention: elimina SOLO gli eventi presi in carico più vecchi di `days`.
 * Un evento ancora aperto non viene mai cancellato, per quanto vecchio sia:
 * sparirebbe un problema irrisolto.
 */
export function purgeAcknowledgedOlderThan(db: Database, days: number): number {
  const res = db
    .prepare(
      `DELETE FROM wazuh_alert_event
        WHERE acknowledged = 1
          AND acknowledged_at IS NOT NULL
          AND acknowledged_at < datetime('now', ?)`,
    )
    .run(`-${Math.max(1, Math.floor(days))} days`);
  return res.changes;
}

export function countOpenByCategory(db: Database): Record<string, number> {
  const rows = db
    .prepare(
      "SELECT category, COUNT(*) AS n FROM wazuh_alert_event WHERE acknowledged = 0 GROUP BY category",
    )
    .all() as { category: string; n: number }[];
  const out: Record<string, number> = {};
  for (const r of rows) out[r.category] = r.n;
  return out;
}

export interface AlertSyncState {
  lastTimestamp: string | null;
  cursor: unknown[] | null;
  lastRunAt: string | null;
  lastError: string | null;
  lastDigestAt: string | null;
}

export function getAlertSyncState(db: Database): AlertSyncState {
  const row = db
    .prepare("SELECT * FROM wazuh_alert_sync_state WHERE id = 1")
    .get() as
    | {
        last_timestamp: string | null;
        cursor_json: string | null;
        last_run_at: string | null;
        last_error: string | null;
        last_digest_at: string | null;
      }
    | undefined;
  if (!row) {
    return {
      lastTimestamp: null,
      cursor: null,
      lastRunAt: null,
      lastError: null,
      lastDigestAt: null,
    };
  }
  let cursor: unknown[] | null = null;
  if (row.cursor_json) {
    try {
      const parsed: unknown = JSON.parse(row.cursor_json);
      if (Array.isArray(parsed)) cursor = parsed;
    } catch {
      cursor = null;
    }
  }
  return {
    lastTimestamp: row.last_timestamp,
    cursor,
    lastRunAt: row.last_run_at,
    lastError: row.last_error,
    lastDigestAt: row.last_digest_at,
  };
}

/** Segna l'istante dell'ultimo digest inviato. */
export function markDigestSent(db: Database): void {
  db.prepare(
    `INSERT INTO wazuh_alert_sync_state (id, last_digest_at)
     VALUES (1, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET last_digest_at = datetime('now')`,
  ).run();
}

export function setAlertSyncState(
  db: Database,
  s: { lastTimestamp?: string | null; cursor?: unknown[] | null; lastError?: string | null },
): void {
  db.prepare(
    `INSERT INTO wazuh_alert_sync_state (id, last_timestamp, cursor_json, last_run_at, last_error)
     VALUES (1, ?, ?, datetime('now'), ?)
     ON CONFLICT(id) DO UPDATE SET
       last_timestamp = COALESCE(excluded.last_timestamp, wazuh_alert_sync_state.last_timestamp),
       cursor_json    = excluded.cursor_json,
       last_run_at    = excluded.last_run_at,
       last_error     = excluded.last_error`,
  ).run(
    s.lastTimestamp ?? null,
    s.cursor ? JSON.stringify(s.cursor) : null,
    s.lastError ?? null,
  );
}
