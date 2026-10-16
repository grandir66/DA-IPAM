/**
 * Copia CONGELATA delle quattro funzioni del gruppo 0 com'erano nella facciata
 * `db.ts` prima dello spostamento in `db-tenant.ts` (commit b842f0c, T3-03).
 * Dopo lo spostamento `db.ts` le riesporta, quindi confrontare `@/lib/db` con
 * `@/lib/db-tenant` vorrebbe dire confrontare una funzione con se stessa: la
 * parità si prova contro questa copia (revisione 2026-10-12).
 *
 * Unica differenza voluta: `cleanOrphanedForeignKeys` non ha la bandierina
 * `_fkCleaned` unica per processo, il difetto corretto in T3-04 (la pulizia
 * avveniva solo sul primo tenant). Il resto è testo identico; non si modifica.
 */
import { getDb } from "@/lib/db";
import { buildStatusSeries, statusWindowStartMs, type StatusObservation, type StatusPoint } from "@/lib/status-over-time";

export function cleanOrphanedForeignKeys(): void {
  const db = getDb();
  db.prepare("UPDATE mac_ip_mapping SET source_device_id = NULL WHERE source_device_id IS NOT NULL AND source_device_id NOT IN (SELECT id FROM network_devices)").run();
  db.prepare("UPDATE mac_ip_mapping SET network_id = NULL WHERE network_id IS NOT NULL AND network_id NOT IN (SELECT id FROM networks)").run();
  db.prepare("UPDATE mac_ip_mapping SET host_id = NULL WHERE host_id IS NOT NULL AND host_id NOT IN (SELECT id FROM hosts)").run();
  db.prepare("UPDATE dhcp_leases SET host_id = NULL WHERE host_id IS NOT NULL AND host_id NOT IN (SELECT id FROM hosts)").run();
  db.prepare("UPDATE dhcp_leases SET network_id = NULL WHERE network_id IS NOT NULL AND network_id NOT IN (SELECT id FROM networks)").run();
}

export function updateScheduledJobInterval(id: number, intervalMinutes: number): void {
  getDb().prepare(
    `UPDATE scheduled_jobs SET interval_minutes = ?, next_run = datetime('now', '+' || ? || ' minutes'), updated_at = datetime('now') WHERE id = ?`
  ).run(intervalMinutes, intervalMinutes, id);
}

export function getStatusOverTime(
  hours: number = 24
): StatusPoint[] {
  // Ultimo stato noto di ogni host portato avanti per 24 h (status-over-time.ts):
  // prima un host contava solo nell'ora in cui era stato controllato, e con il
  // controllo ogni 3 ore il grafico andava su e giù (cliente A, ottobre 2026).
  const STALE_HOURS = 24;
  if (!Number.isFinite(hours)) hours = 24;
  hours = Math.min(Math.max(Math.round(hours), 1), 720);
  const nowMs = Date.now();
  const startMs = statusWindowStartMs(hours, nowMs);
  const toSql = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);
  const bucketFmt = hours <= 48 ? "%Y-%m-%dT%H:00:00" : "%Y-%m-%dT00:00:00";
  const totalRow = getDb().prepare("SELECT COUNT(*) as c FROM hosts").get() as { c: number };
  // Per ogni host: l'ultimo controllo di ciascun periodo della finestra, più
  // l'ultimo prima della finestra (entro STALE_HOURS) come stato di partenza.
  const observations = getDb().prepare(`
    WITH dentro AS (
      SELECT host_id, status, checked_at,
        ROW_NUMBER() OVER (PARTITION BY strftime(?, checked_at), host_id ORDER BY checked_at DESC, id DESC) AS rn
      FROM status_history
      WHERE checked_at >= ?
    ),
    prima AS (
      SELECT host_id, status, checked_at,
        ROW_NUMBER() OVER (PARTITION BY host_id ORDER BY checked_at DESC, id DESC) AS rn
      FROM status_history
      WHERE checked_at >= ? AND checked_at < ?
    )
    SELECT host_id, status, checked_at FROM dentro WHERE rn = 1
    UNION ALL
    SELECT host_id, status, checked_at FROM prima WHERE rn = 1
  `).all(
    bucketFmt,
    toSql(startMs),
    toSql(startMs - STALE_HOURS * 3_600_000),
    toSql(startMs),
  ) as StatusObservation[];
  return buildStatusSeries({ hours, nowMs, totalHosts: totalRow.c, observations, staleAfterHours: STALE_HOURS });
}

export function getRecentStatusChanges(
  limit: number = 10,
  hoursWindow: number = 24
): { host_id: number; ip: string; hostname: string | null; from_status: string | null; to_status: string; changed_at: string }[] {
  // CTE: per ogni riga di status_history, recupera il PREV status dello stesso host
  // (window LAG). Filtra dove status != prev_status → vere transizioni.
  return getDb().prepare(`
    WITH ordered AS (
      SELECT
        sh.host_id, sh.status, sh.checked_at,
        LAG(sh.status) OVER (PARTITION BY sh.host_id ORDER BY sh.checked_at) AS prev_status
      FROM status_history sh
      WHERE sh.checked_at >= datetime('now', '-' || ? || ' hours')
    )
    SELECT
      o.host_id,
      h.ip,
      COALESCE(h.custom_name, h.hostname) AS hostname,
      o.prev_status AS from_status,
      o.status AS to_status,
      o.checked_at AS changed_at
    FROM ordered o
    JOIN hosts h ON h.id = o.host_id
    WHERE o.prev_status IS NOT NULL AND o.prev_status != o.status
    ORDER BY o.checked_at DESC
    LIMIT ?
  `).all(hoursWindow, limit) as { host_id: number; ip: string; hostname: string | null; from_status: string | null; to_status: string; changed_at: string }[];
}

