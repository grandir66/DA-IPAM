// src/lib/integrations/meshcentral/__tests__/tenant-schema-wiring.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "@/lib/db-tenant-schema";

function buildTenant(): Database.Database {
  const db = new Database(":memory:");
  db.exec(TENANT_SCHEMA_SQL);
  db.exec(TENANT_INDEXES_SQL);
  return db;
}

test("tenant schema includes mc_node / mc_remote_session / mc_node_bind / mc_config", () => {
  const db = buildTenant();
  const names = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name),
  );
  for (const t of ["mc_node", "mc_remote_session", "mc_node_bind", "mc_config"]) {
    assert.ok(names.has(t), `missing ${t}`);
  }
});

test("scheduled_jobs CHECK accepts meshcentral_sync", () => {
  const db = buildTenant();
  // insert a row using the meshcentral_sync job_type; must not raise CHECK violation
  const cols = (db.prepare("PRAGMA table_info(scheduled_jobs)").all() as { name: string }[]).map((c) => c.name);
  assert.ok(cols.includes("job_type"), "scheduled_jobs.job_type missing");
  assert.doesNotThrow(() => {
    db.prepare(
      "INSERT INTO scheduled_jobs (network_id, job_type, enabled) VALUES (NULL, 'meshcentral_sync', 1)",
    ).run();
  });
  const row = db.prepare("SELECT job_type FROM scheduled_jobs WHERE job_type='meshcentral_sync'").get() as { job_type: string };
  assert.equal(row.job_type, "meshcentral_sync");
});

test("mc_node indexes present", () => {
  const db = buildTenant();
  const idx = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[]).map((r) => r.name),
  );
  assert.ok(idx.has("idx_mc_node_host"));
  assert.ok(idx.has("idx_mc_node_mesh"));
  assert.ok(idx.has("idx_mc_remote_session_host_ts"));
});
