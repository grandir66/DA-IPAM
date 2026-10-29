// 29/10/2026, su un'appliance: integrazione AD salvata spenta e accesa dopo da «Modifica»; il job
// ad_sync nasceva solo alla creazione, quindi l'AD non si sincronizzava più da solo.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getScheduledJobs, getTenantDb, toggleJob, withTenant } from "@/lib/db-tenant";
import { AD_SYNC_INTERVAL_MIN, ensureAdSyncJob } from "@/lib/ad/sincronizzazione";
import { stopTenantJobs } from "@/lib/cron/scheduler";

const T = "TESTADSYNC";
beforeEach(() => {
  getTenantDb(T).exec("DELETE FROM scheduled_jobs");
});
// ensureAdSyncJob ricarica lo scheduler: i timer accesi terrebbero vivo il processo delle prove.
after(() => { stopTenantJobs(T); deleteTenantDatabase(T); closeHubDb(); removeTestHubDb(); });

const adSync = () => getScheduledJobs().filter((j) => j.job_type === "ad_sync");

test("crea il job ad_sync per tutte le integrazioni, ogni 6 ore, acceso", () => {
  withTenant(T, () => {
    ensureAdSyncJob(T);
    const j = adSync();
    assert.equal(j.length, 1);
    assert.equal(j[0].network_id, null);
    assert.equal(j[0].interval_minutes, AD_SYNC_INTERVAL_MIN);
    assert.equal(j[0].enabled, 1);
  });
});

test("idempotente, e riaccende un job spento invece di crearne un altro", () => {
  withTenant(T, () => {
    ensureAdSyncJob(T);
    toggleJob(adSync()[0].id, false);
    ensureAdSyncJob(T);
    const j = adSync();
    assert.equal(j.length, 1);
    assert.equal(j[0].enabled, 1);
  });
});
