/**
 * CRUD per la tabella anomaly_events nel DB tenant.
 * Tutte le funzioni richiedono un contesto tenant attivo (withTenant / withTenantFromSession).
 */

import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";
import type { AnomalyEvent, AnomalyType, AnomalySeverity } from "@/types";

function db() {
  const code = getCurrentTenantCode();
  if (!code) throw new Error("Nessun contesto tenant attivo");
  return getTenantDb(code);
}

export interface InsertAnomalyEventInput {
  host_id: number | null;
  network_id: number | null;
  anomaly_type: AnomalyType;
  severity: AnomalySeverity;
  description: string;
  detail_json?: string | null;
}

export function insertAnomalyEvent(event: InsertAnomalyEventInput): number {
  const result = db()
    .prepare(
      `INSERT INTO anomaly_events
         (host_id, network_id, anomaly_type, severity, description, detail_json)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      event.host_id,
      event.network_id,
      event.anomaly_type,
      event.severity,
      event.description,
      event.detail_json ?? null
    );
  return result.lastInsertRowid as number;
}

export interface GetAnomalyEventsFilters {
  network_id?: number;
  anomaly_type?: AnomalyType;
  acknowledged?: boolean;
  limit?: number;
  offset?: number;
}

export function getAnomalyEvents(filters: GetAnomalyEventsFilters = {}): AnomalyEvent[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.network_id !== undefined) {
    conditions.push("network_id = ?");
    params.push(filters.network_id);
  }
  if (filters.anomaly_type !== undefined) {
    conditions.push("anomaly_type = ?");
    params.push(filters.anomaly_type);
  }
  if (filters.acknowledged !== undefined) {
    conditions.push("acknowledged = ?");
    params.push(filters.acknowledged ? 1 : 0);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;

  return db()
    .prepare(
      `SELECT * FROM anomaly_events ${where} ORDER BY detected_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as AnomalyEvent[];
}

export function countAnomalyEvents(filters: Omit<GetAnomalyEventsFilters, "limit" | "offset"> = {}): number {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.network_id !== undefined) {
    conditions.push("network_id = ?");
    params.push(filters.network_id);
  }
  if (filters.anomaly_type !== undefined) {
    conditions.push("anomaly_type = ?");
    params.push(filters.anomaly_type);
  }
  if (filters.acknowledged !== undefined) {
    conditions.push("acknowledged = ?");
    params.push(filters.acknowledged ? 1 : 0);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const row = db()
    .prepare(`SELECT COUNT(*) as cnt FROM anomaly_events ${where}`)
    .get(...params) as { cnt: number };
  return row.cnt;
}

export function countUnacknowledgedAnomalies(networkId?: number): number {
  if (networkId !== undefined) {
    const row = db()
      .prepare("SELECT COUNT(*) as cnt FROM anomaly_events WHERE acknowledged = 0 AND network_id = ?")
      .get(networkId) as { cnt: number };
    return row.cnt;
  }
  const row = db()
    .prepare("SELECT COUNT(*) as cnt FROM anomaly_events WHERE acknowledged = 0")
    .get() as { cnt: number };
  return row.cnt;
}

export function acknowledgeAnomalyEvent(id: number, acknowledgedBy: string): boolean {
  const result = db()
    .prepare(
      `UPDATE anomaly_events
       SET acknowledged = 1, acknowledged_at = datetime('now'), acknowledged_by = ?
       WHERE id = ?`
    )
    .run(acknowledgedBy, id);
  return result.changes > 0;
}

export function resolveAnomalyEvent(id: number): boolean {
  const result = db()
    .prepare(
      `UPDATE anomaly_events SET resolved_at = datetime('now') WHERE id = ?`
    )
    .run(id);
  return result.changes > 0;
}

export function deleteAnomalyEvent(id: number): boolean {
  const result = db()
    .prepare("DELETE FROM anomaly_events WHERE id = ?")
    .run(id);
  return result.changes > 0;
}

/**
 * Verifica se esiste già un evento aperto (non risolto, non acked) dello stesso tipo
 * per lo stesso host nell'ultima finestra di ore indicata.
 * Usato per deduplicare prima di insert.
 */
export function hasOpenAnomaly(hostId: number, type: AnomalyType, windowHours: number): boolean {
  const row = db()
    .prepare(
      `SELECT 1 FROM anomaly_events
       WHERE host_id = ?
         AND anomaly_type = ?
         AND acknowledged = 0
         AND resolved_at IS NULL
         AND detected_at >= datetime('now', '-' || ? || ' hours')
       LIMIT 1`
    )
    .get(hostId, type, windowHours) as unknown;
  return row !== undefined;
}
