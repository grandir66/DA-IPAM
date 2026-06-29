// src/lib/integrations/meshcentral/__tests__/scheduled-jobs-v6.test.ts
//
// Proves that the scheduled_jobs_v6 migration correctly upgrades an EXISTING
// tenant DB whose CHECK constraint does NOT yet include 'meshcentral_sync'.
//
// Pattern mirrors the existing v4/v5 migration blocks in src/lib/db-tenant.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Inline replica of the v6 migration logic (same code as in getTenantDb).
// We run it directly on an in-memory DB so the test has no filesystem side-
// effects and does not require a real tenant code.
// ---------------------------------------------------------------------------
function applyV6Migration(db: Database.Database): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scheduled_jobs'")
    .get() as { sql?: string } | undefined;
  if (row?.sql && !row.sql.includes("'meshcentral_sync'")) {
    db.pragma("foreign_keys = OFF");
    db.exec("DROP TABLE IF EXISTS scheduled_jobs_v6");
    db.exec(`CREATE TABLE scheduled_jobs_v6 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
      job_type TEXT NOT NULL CHECK(job_type IN ('ping_sweep', 'snmp_scan', 'nmap_scan', 'arp_poll', 'dns_resolve', 'fast_scan', 'cleanup', 'known_host_check', 'ad_sync', 'anomaly_check', 'librenms_sync', 'vuln_sync', 'wazuh_sync', 'mdm_sync', 'meshcentral_sync')),
      interval_minutes INTEGER NOT NULL DEFAULT 60,
      last_run TEXT,
      next_run TEXT,
      enabled INTEGER DEFAULT 1,
      config TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`);
    db.exec("INSERT INTO scheduled_jobs_v6 SELECT * FROM scheduled_jobs");
    db.exec("DROP TABLE scheduled_jobs");
    db.exec("ALTER TABLE scheduled_jobs_v6 RENAME TO scheduled_jobs");
    db.pragma("foreign_keys = ON");
  }
}

// ---------------------------------------------------------------------------
// Helper: build an OLD in-memory DB (v5 schema — mdm_sync is the last type,
// meshcentral_sync is absent from the CHECK).
// ---------------------------------------------------------------------------
function buildOldDb(): Database.Database {
  const db = new Database(":memory:");
  // Minimal networks table needed for the FK reference in scheduled_jobs.
  db.exec(`CREATE TABLE networks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  )`);
  // Old scheduled_jobs with v5 CHECK (no meshcentral_sync).
  db.exec(`CREATE TABLE scheduled_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
    job_type TEXT NOT NULL CHECK(job_type IN ('ping_sweep', 'snmp_scan', 'nmap_scan', 'arp_poll', 'dns_resolve', 'fast_scan', 'cleanup', 'known_host_check', 'ad_sync', 'anomaly_check', 'librenms_sync', 'vuln_sync', 'wazuh_sync', 'mdm_sync')),
    interval_minutes INTEGER NOT NULL DEFAULT 60,
    last_run TEXT,
    next_run TEXT,
    enabled INTEGER DEFAULT 1,
    config TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
  return db;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("scheduled_jobs_v6: meshcentral_sync INSERT fails BEFORE migration (baseline)", () => {
  const db = buildOldDb();
  assert.throws(
    () => {
      db.prepare(
        "INSERT INTO scheduled_jobs (network_id, job_type, enabled) VALUES (NULL, 'meshcentral_sync', 1)",
      ).run();
    },
    (err: unknown) => {
      assert.ok(err instanceof Error, "must throw an Error");
      assert.ok(
        (err as NodeJS.ErrnoException).code === "SQLITE_CONSTRAINT_CHECK",
        `expected SQLITE_CONSTRAINT_CHECK, got: ${(err as NodeJS.ErrnoException).code}`,
      );
      return true;
    },
  );
});

test("scheduled_jobs_v6: pre-existing rows survive migration", () => {
  const db = buildOldDb();
  // Insert a pre-existing row with a valid old job_type.
  db.prepare(
    "INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled) VALUES (NULL, 'mdm_sync', 120, 1)",
  ).run();

  applyV6Migration(db);

  const rows = db.prepare("SELECT job_type, interval_minutes FROM scheduled_jobs").all() as Array<{
    job_type: string;
    interval_minutes: number;
  }>;
  assert.equal(rows.length, 1, "pre-existing row must survive migration");
  assert.equal(rows[0].job_type, "mdm_sync");
  assert.equal(rows[0].interval_minutes, 120);
});

test("scheduled_jobs_v6: INSERT meshcentral_sync SUCCEEDS after migration", () => {
  const db = buildOldDb();
  applyV6Migration(db);

  assert.doesNotThrow(() => {
    db.prepare(
      "INSERT INTO scheduled_jobs (network_id, job_type, enabled) VALUES (NULL, 'meshcentral_sync', 1)",
    ).run();
  }, "meshcentral_sync INSERT must not raise after migration");

  const row = db
    .prepare("SELECT job_type FROM scheduled_jobs WHERE job_type='meshcentral_sync'")
    .get() as { job_type: string };
  assert.equal(row.job_type, "meshcentral_sync");
});

test("scheduled_jobs_v6: migration is idempotent (second run is a no-op)", () => {
  const db = buildOldDb();
  applyV6Migration(db);
  // Second call must not throw.
  assert.doesNotThrow(() => applyV6Migration(db));
  // Table still works after second call.
  assert.doesNotThrow(() => {
    db.prepare(
      "INSERT INTO scheduled_jobs (network_id, job_type, enabled) VALUES (NULL, 'meshcentral_sync', 1)",
    ).run();
  });
});
