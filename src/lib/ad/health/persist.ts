/**
 * Schema + helpers AD Health. Opt-in: tabelle create via ensureAdHealthSchema
 * (idempotente), pattern meshcentral applyMcSchemaMigrations.
 * DDL = spec §5 verbatim + indici per getLatest/getFindings.
 */
import type { Database } from "better-sqlite3";
import { ENGINE_VERSION, type HealthFinding, type HealthScore } from "./types";

export const AD_HEALTH_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS ad_health_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL REFERENCES ad_integrations(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL, -- running|ok|error
  error_message TEXT,
  score_global INTEGER,
  score_stale INTEGER,
  score_privileged INTEGER,
  score_trust INTEGER,
  score_anomaly INTEGER,
  engine_version TEXT NOT NULL,
  stats_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ad_health_runs_integration_started
  ON ad_health_runs(integration_id, started_at DESC);

CREATE TABLE IF NOT EXISTS ad_health_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES ad_health_runs(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL,
  axis TEXT NOT NULL,
  severity TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  object_count INTEGER NOT NULL DEFAULT 0,
  sample_dns_json TEXT,
  raw_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ad_health_findings_run
  ON ad_health_findings(run_id);
`;

export type AdHealthRunStatus = "running" | "ok" | "error";

export interface AdHealthRunRow {
  id: number;
  integrationId: number;
  startedAt: string;
  finishedAt: string | null;
  status: AdHealthRunStatus;
  errorMessage: string | null;
  scoreGlobal: number | null;
  scoreStale: number | null;
  scorePrivileged: number | null;
  scoreTrust: number | null;
  scoreAnomaly: number | null;
  engineVersion: string;
  statsJson: string | null;
  createdAt: string | null;
}

interface InsertRunArgs {
  integrationId: number;
  engineVersion?: string;
  startedAt?: string;
  statsJson?: string | Record<string, unknown> | null;
}

interface FinishRunArgs {
  status: Exclude<AdHealthRunStatus, "running">;
  score?: HealthScore | null;
  errorMessage?: string | null;
  finishedAt?: string;
  statsJson?: string | Record<string, unknown> | null;
}

interface RunDbRow {
  id: number;
  integration_id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  error_message: string | null;
  score_global: number | null;
  score_stale: number | null;
  score_privileged: number | null;
  score_trust: number | null;
  score_anomaly: number | null;
  engine_version: string;
  stats_json: string | null;
  created_at: string | null;
}

interface FindingDbRow {
  rule_id: string;
  axis: string;
  severity: string;
  points: number;
  title: string;
  description: string;
  object_count: number;
  sample_dns_json: string | null;
  raw_json: string | null;
}

function jsonOrNull(value: string | Record<string, unknown> | null | undefined): string | null {
  if (value == null) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function mapRun(row: RunDbRow): AdHealthRunRow {
  return {
    id: row.id,
    integrationId: row.integration_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status as AdHealthRunStatus,
    errorMessage: row.error_message,
    scoreGlobal: row.score_global,
    scoreStale: row.score_stale,
    scorePrivileged: row.score_privileged,
    scoreTrust: row.score_trust,
    scoreAnomaly: row.score_anomaly,
    engineVersion: row.engine_version,
    statsJson: row.stats_json,
    createdAt: row.created_at,
  };
}

/** Crea le tabelle AD Health nel DB tenant (idempotente). */
export function ensureAdHealthSchema(db: Database): void {
  db.exec(AD_HEALTH_SCHEMA_SQL);
}

/** Inserisce un run in status running. Ritorna l'id. */
export function insertRun(db: Database, args: InsertRunArgs): number {
  const startedAt = args.startedAt ?? new Date().toISOString();
  const engineVersion = args.engineVersion ?? ENGINE_VERSION;
  const result = db
    .prepare(
      `INSERT INTO ad_health_runs (
         integration_id, started_at, status, engine_version, stats_json
       ) VALUES (?, ?, 'running', ?, ?)`,
    )
    .run(args.integrationId, startedAt, engineVersion, jsonOrNull(args.statsJson));
  return Number(result.lastInsertRowid);
}

/** Chiude un run con status ok|error e score opzionale. */
export function finishRun(db: Database, runId: number, args: FinishRunArgs): void {
  const finishedAt = args.finishedAt ?? new Date().toISOString();
  const score = args.score;
  db.prepare(
    `UPDATE ad_health_runs SET
       status = ?,
       finished_at = ?,
       error_message = ?,
       score_global = ?,
       score_stale = ?,
       score_privileged = ?,
       score_trust = ?,
       score_anomaly = ?,
       stats_json = COALESCE(?, stats_json)
     WHERE id = ?`,
  ).run(
    args.status,
    finishedAt,
    args.errorMessage ?? null,
    score?.global ?? null,
    score?.stale ?? null,
    score?.privileged ?? null,
    score?.trust ?? null,
    score?.anomaly ?? null,
    jsonOrNull(args.statsJson),
    runId,
  );
}

/** Inserisce findings aggregati per un run. */
export function insertFindings(db: Database, runId: number, findings: HealthFinding[]): void {
  if (findings.length === 0) return;
  const stmt = db.prepare(
    `INSERT INTO ad_health_findings (
       run_id, rule_id, axis, severity, points, title, description,
       object_count, sample_dns_json, raw_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction((rows: HealthFinding[]) => {
    for (const f of rows) {
      stmt.run(
        runId,
        f.ruleId,
        f.axis,
        f.severity,
        f.points,
        f.title,
        f.description,
        f.objectCount,
        JSON.stringify(f.sampleDns ?? []),
        f.raw != null ? JSON.stringify(f.raw) : null,
      );
    }
  });
  tx(findings);
}

/** Ultimo run per integration (started_at DESC, id DESC). */
export function getLatestRun(db: Database, integrationId: number): AdHealthRunRow | null {
  const row = db
    .prepare(
      `SELECT id, integration_id, started_at, finished_at, status, error_message,
              score_global, score_stale, score_privileged, score_trust, score_anomaly,
              engine_version, stats_json, created_at
         FROM ad_health_runs
        WHERE integration_id = ?
        ORDER BY started_at DESC, id DESC
        LIMIT 1`,
    )
    .get(integrationId) as RunDbRow | undefined;
  return row ? mapRun(row) : null;
}

/** Run per id, o null. */
export function getRunById(db: Database, runId: number): AdHealthRunRow | null {
  const row = db
    .prepare(
      `SELECT id, integration_id, started_at, finished_at, status, error_message,
              score_global, score_stale, score_privileged, score_trust, score_anomaly,
              engine_version, stats_json, created_at
         FROM ad_health_runs
        WHERE id = ?`,
    )
    .get(runId) as RunDbRow | undefined;
  return row ? mapRun(row) : null;
}

/** Run in status running per integration, se presente. */
export function getRunningRun(db: Database, integrationId: number): AdHealthRunRow | null {
  const row = db
    .prepare(
      `SELECT id, integration_id, started_at, finished_at, status, error_message,
              score_global, score_stale, score_privileged, score_trust, score_anomaly,
              engine_version, stats_json, created_at
         FROM ad_health_runs
        WHERE integration_id = ? AND status = 'running'
        ORDER BY started_at DESC, id DESC
        LIMIT 1`,
    )
    .get(integrationId) as RunDbRow | undefined;
  return row ? mapRun(row) : null;
}

/** Default age after which a stuck `running` run is reclaimed as error. */
export const STALE_RUNNING_MS = 10 * 60 * 1000;

const STALE_RUNNING_ERROR =
  "AD healthcheck timed out (stuck in running longer than 10 minutes)";

/** Pure: whether a running run's started_at is older than maxAgeMs. */
export function isStaleRunning(
  startedAt: string,
  now: Date = new Date(),
  maxAgeMs: number = STALE_RUNNING_MS,
): boolean {
  const t = Date.parse(startedAt);
  if (Number.isNaN(t)) return true;
  return now.getTime() - t > maxAgeMs;
}

/**
 * Mark any `running` runs for the integration older than maxAgeMs as `error`.
 * Returns the number of runs reclaimed. Call before conflict-check / insert.
 */
export function reclaimStaleRunningRuns(
  db: Database,
  integrationId: number,
  opts?: { now?: Date; maxAgeMs?: number },
): number {
  const now = opts?.now ?? new Date();
  const maxAgeMs = opts?.maxAgeMs ?? STALE_RUNNING_MS;
  const rows = db
    .prepare(
      `SELECT id, integration_id, started_at, finished_at, status, error_message,
              score_global, score_stale, score_privileged, score_trust, score_anomaly,
              engine_version, stats_json, created_at
         FROM ad_health_runs
        WHERE integration_id = ? AND status = 'running'`,
    )
    .all(integrationId) as RunDbRow[];

  let reclaimed = 0;
  for (const row of rows) {
    if (!isStaleRunning(row.started_at, now, maxAgeMs)) continue;
    finishRun(db, row.id, {
      status: "error",
      errorMessage: STALE_RUNNING_ERROR,
      finishedAt: now.toISOString(),
    });
    reclaimed += 1;
  }
  return reclaimed;
}

/** Findings di un run, in ordine di inserimento. */
export function getFindings(db: Database, runId: number): HealthFinding[] {
  const rows = db
    .prepare(
      `SELECT rule_id, axis, severity, points, title, description,
              object_count, sample_dns_json, raw_json
         FROM ad_health_findings
        WHERE run_id = ?
        ORDER BY id ASC`,
    )
    .all(runId) as FindingDbRow[];

  return rows.map((r) => {
    let sampleDns: string[] = [];
    if (r.sample_dns_json) {
      try {
        const parsed = JSON.parse(r.sample_dns_json) as unknown;
        if (Array.isArray(parsed)) sampleDns = parsed.map(String);
      } catch {
        sampleDns = [];
      }
    }
    let raw: Record<string, unknown> | undefined;
    if (r.raw_json) {
      try {
        raw = JSON.parse(r.raw_json) as Record<string, unknown>;
      } catch {
        raw = undefined;
      }
    }
    return {
      ruleId: r.rule_id,
      axis: r.axis as HealthFinding["axis"],
      severity: r.severity as HealthFinding["severity"],
      points: r.points,
      title: r.title,
      description: r.description,
      objectCount: r.object_count,
      sampleDns,
      ...(raw != null ? { raw } : {}),
    };
  });
}
