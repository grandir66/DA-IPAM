/**
 * P1 del piano 2026-10-20 (Riccardo): il job `cleanup` non tocca più gli host.
 * Prima marcava 'stale' dopo 30 giorni e CANCELLAVA dopo 90, senza nessuna delle
 * esclusioni della nuova pulizia (archivio in src/lib/hosts/pulizia-*). Ora gli host
 * li gestisce solo quella; `cleanup` tiene la retention delle tabelle MAC.
 *
 * Run: node --import tsx --test src/lib/cron/__tests__/cleanup-non-tocca-host.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeTenantDb, createScheduledJob, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { runJob } from "@/lib/cron/jobs";

const T = "CLEANUP2010";
after(() => {
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

test("un host offline da 200 giorni resta com'è dopo il job cleanup", async () => {
  await withTenant(T, async () => {
    const d = getTenantDb(T);
    const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.78.0.0/24', 'r')").run().lastInsertRowid);
    const id = Number(
      d.prepare(
        "INSERT INTO hosts (network_id, ip, status, last_seen, classification, classification_manual) VALUES (?, '10.78.0.9', 'offline', datetime('now', '-200 days'), 'workstation', 0)",
      ).run(rete).lastInsertRowid,
    );
    // Vecchia configurazione ancora in archivio: le due soglie devono essere ignorate.
    const job = createScheduledJob({ network_id: null, job_type: "cleanup", interval_minutes: 60, config: { days_until_stale: 30, days_until_delete: 90 } });
    await runJob(job.id);
    const riga = d.prepare("SELECT classification FROM hosts WHERE id = ?").get(id) as { classification: string } | undefined;
    assert.ok(riga, "l'host è stato cancellato dal job cleanup");
    assert.equal(riga.classification, "workstation");
  });
});
