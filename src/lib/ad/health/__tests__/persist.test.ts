import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  ensureAdHealthSchema,
  finishRun,
  getFindings,
  getLatestRun,
  getRunningRun,
  insertFindings,
  insertRun,
} from "../persist";
import { ENGINE_VERSION, type HealthFinding } from "../types";

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  // Minimal parent so FK to ad_integrations resolves
  db.exec(`
    CREATE TABLE ad_integrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    );
  `);
  db.prepare("INSERT INTO ad_integrations (id, name) VALUES (1, 'lab')").run();
  return db;
}

function tableNames(db: Database.Database): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
  ).map((r) => r.name);
}

const sampleFinding: HealthFinding = {
  ruleId: "DA-S-InactiveUser",
  axis: "stale",
  points: 10,
  severity: "Medium",
  title: "Inactive users",
  description: "users inactive",
  objectCount: 2,
  sampleDns: ["CN=a,DC=lab", "CN=b,DC=lab"],
  raw: { note: "x" },
};

test("ensureAdHealthSchema creates tables and is idempotent", () => {
  const db = freshDb();
  ensureAdHealthSchema(db);
  ensureAdHealthSchema(db);
  const names = tableNames(db);
  assert.ok(names.includes("ad_health_runs"));
  assert.ok(names.includes("ad_health_findings"));
});

test("insertRun + finishRun + insertFindings + getLatest/getFindings", () => {
  const db = freshDb();
  ensureAdHealthSchema(db);

  const runId = insertRun(db, {
    integrationId: 1,
    engineVersion: ENGINE_VERSION,
  });
  assert.equal(typeof runId, "number");
  assert.ok(runId > 0);

  const running = getLatestRun(db, 1);
  assert.ok(running);
  assert.equal(running.id, runId);
  assert.equal(running.status, "running");
  assert.equal(running.engineVersion, ENGINE_VERSION);
  assert.equal(running.scoreGlobal, null);

  insertFindings(db, runId, [sampleFinding]);
  finishRun(db, runId, {
    status: "ok",
    score: { global: 10, stale: 10, privileged: 0, trust: 0, anomaly: 0 },
  });

  const latest = getLatestRun(db, 1);
  assert.ok(latest);
  assert.equal(latest.status, "ok");
  assert.equal(latest.scoreGlobal, 10);
  assert.equal(latest.scoreStale, 10);
  assert.ok(latest.finishedAt);

  const findings = getFindings(db, runId);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].ruleId, "DA-S-InactiveUser");
  assert.equal(findings[0].axis, "stale");
  assert.equal(findings[0].objectCount, 2);
  assert.deepEqual(findings[0].sampleDns, ["CN=a,DC=lab", "CN=b,DC=lab"]);
  assert.deepEqual(findings[0].raw, { note: "x" });
});

test("getLatestRun returns most recent by started_at / id", () => {
  const db = freshDb();
  ensureAdHealthSchema(db);

  const older = insertRun(db, { integrationId: 1, startedAt: "2026-01-01T00:00:00.000Z" });
  finishRun(db, older, { status: "ok", score: { global: 1, stale: 1, privileged: 0, trust: 0, anomaly: 0 } });

  const newer = insertRun(db, { integrationId: 1, startedAt: "2026-07-01T00:00:00.000Z" });
  finishRun(db, newer, { status: "ok", score: { global: 5, stale: 5, privileged: 0, trust: 0, anomaly: 0 } });

  const latest = getLatestRun(db, 1);
  assert.ok(latest);
  assert.equal(latest.id, newer);
  assert.equal(latest.scoreGlobal, 5);
});

test("getRunningRun finds only status=running", () => {
  const db = freshDb();
  ensureAdHealthSchema(db);
  assert.equal(getRunningRun(db, 1), null);

  const runId = insertRun(db, { integrationId: 1 });
  const running = getRunningRun(db, 1);
  assert.ok(running);
  assert.equal(running.id, runId);
  assert.equal(running.status, "running");

  finishRun(db, runId, { status: "ok" });
  assert.equal(getRunningRun(db, 1), null);
});
