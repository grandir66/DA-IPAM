/**
 * Il lanciatore /scans scrive sonda_l2, segmentazione, controlli in scan_history:
 * il CHECK deve accettarli (incidente 10/11, CHECK constraint failed).
 * Run: node --import tsx --test src/lib/scanner/__tests__/scan-history-tipi-giro.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { addScanHistory, closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";

const T = "PROVACHECKGIRO";

after(() => {
  closeTenantDb(T);
  deleteTenantDatabase(T);
  closeHubDb();
});

test("scan_history accetta i tipi del lanciatore /scans", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const sql = (d.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scan_history'").get() as { sql: string }).sql;
    assert.match(sql, /'controlli'/);
    assert.match(sql, /'sonda_l2'/);
    assert.match(sql, /'segmentazione'/);
    for (const tipo of ["controlli", "sonda_l2", "segmentazione"] as const) {
      addScanHistory({
        host_id: null,
        network_id: null,
        scan_type: tipo,
        status: "avviato",
        ports_open: null,
        raw_output: null,
        duration_ms: null,
      });
    }
    const n = (d.prepare("SELECT COUNT(*) AS n FROM scan_history WHERE scan_type IN ('controlli','sonda_l2','segmentazione')").get() as { n: number }).n;
    assert.equal(n, 3);
  });
});
