// I rimandi della pagina dei job e della rete puntano a `/settings/opzioni#<id>`: l'id deve essere una riga vera del
// catalogo, altrimenti il link porta in cima alla pagina e non dice niente.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { createScheduledJob, deleteTenantDatabase, getScheduledJobs, getTenantDb, withTenant } from "@/lib/db-tenant";
import { SCHEDULED_JOB_TYPES } from "@/lib/scheduled-job-types";
import { catalogo } from "@/lib/opzioni/catalogo";
import { idOpzioneDelJob } from "@/lib/opzioni/ancore";

const T = "TESTOPZIONIANCORE";
after(() => { deleteTenantDatabase(T); closeHubDb(); removeTestHubDb(); });

test("ogni job porta a una riga che esiste nel catalogo", () => {
  withTenant(T, () => {
    getTenantDb(T).exec("DELETE FROM scheduled_jobs");
    for (const tipo of SCHEDULED_JOB_TYPES) {
      if (tipo !== "unifi_sync") createScheduledJob({ job_type: tipo, interval_minutes: 60, network_id: null });
    }
    const ids = new Set(catalogo().map((o) => o.id));
    for (const j of getScheduledJobs()) assert.ok(ids.has(idOpzioneDelJob(j)), `${j.job_type} → ${idOpzioneDelJob(j)}`);
  });
});

test("unifi_sync: la riga del suo controller, apparati o client", () => {
  assert.equal(idOpzioneDelJob({ id: 9, job_type: "unifi_sync", config: '{"controller_id":3}' }), "controller.3.apparati");
  assert.equal(idOpzioneDelJob({ id: 9, job_type: "unifi_sync", config: '{"controller_id":3,"cosa":"client"}' }), "controller.3.client");
  assert.equal(idOpzioneDelJob({ id: 9, job_type: "unifi_sync", config: "{rotto" }), "job.9");
});
