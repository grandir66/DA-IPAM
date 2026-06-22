/**
 * Idempotente: se esiste almeno un vuln_scanners enabled, garantisce il job
 * scheduled_jobs vuln_sync (30 min). Usato da entrypoint container appliance.
 */
import { getTenantDb } from "../src/lib/db-tenant";

const tenantCode = process.env.DA_TENANT_CODE?.trim() || "DEFAULT";
const db = getTenantDb(tenantCode);

const scanner = db
  .prepare("SELECT id FROM vuln_scanners WHERE enabled = 1 LIMIT 1")
  .get() as { id: number } | undefined;
if (!scanner) {
  process.exit(0);
}

const job = db
  .prepare(
    "SELECT id FROM scheduled_jobs WHERE job_type = 'vuln_sync' AND network_id IS NULL",
  )
  .get() as { id: number } | undefined;
if (!job) {
  db.prepare(
    `INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled, config)
     VALUES (NULL, 'vuln_sync', 30, 1, '{}')`,
  ).run();
  console.log("[ensure-vuln-sync] job vuln_sync creato (30 min)");
}
