process.env.ENCRYPTION_KEY ||= "test-encryption-key-mc-config-route";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { applyMcSchemaMigrations } from "@/lib/integrations/meshcentral/schema";
import { seedMeshSyncJobForTenant } from "@/app/api/integrations/meshcentral/config/route";

const T = "TESTMCCFGROUTE";
after(() => deleteTenantDatabase(T));

test("seedMeshSyncJobForTenant inserts meshcentral_sync once and is idempotent", () => {
  withTenant(T, () => {
    const db = getTenantDb(T);
    applyMcSchemaMigrations(db);

    const r1 = seedMeshSyncJobForTenant(db, 30);
    assert.equal(r1, "created");

    const rows = db
      .prepare("SELECT interval_minutes, enabled FROM scheduled_jobs WHERE job_type = 'meshcentral_sync' AND network_id IS NULL")
      .all() as Array<{ interval_minutes: number; enabled: number }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].interval_minutes, 30);
    assert.equal(rows[0].enabled, 1);

    const r2 = seedMeshSyncJobForTenant(db, 30);
    assert.equal(r2, "unchanged");
    const after2 = db
      .prepare("SELECT COUNT(*) AS c FROM scheduled_jobs WHERE job_type = 'meshcentral_sync' AND network_id IS NULL")
      .get() as { c: number };
    assert.equal(after2.c, 1);

    const r3 = seedMeshSyncJobForTenant(db, 60);
    assert.equal(r3, "updated");
    const after3 = db
      .prepare("SELECT interval_minutes FROM scheduled_jobs WHERE job_type = 'meshcentral_sync' AND network_id IS NULL")
      .get() as { interval_minutes: number };
    assert.equal(after3.interval_minutes, 60);
  });
});
