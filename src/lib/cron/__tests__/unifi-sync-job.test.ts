// Job schedulato unifi_sync (tappa 2 UniFi, Task 6): runJob lo smista a
// syncUnifiForTenant e, se il giro non ha letto o scritto niente, lancia col
// motivo. Così lo scheduler lo conta fra i falliti (e ne avvisa se succede di
// fila) invece di dirlo «completato» mentre il controller non risponde.
//
// Niente rete: solo casi che si fermano prima del controller (integrazione
// spenta, indirizzo mancante). Il giro che scrive è provato in
// integrations/__tests__/unifi-sync.test.ts con la risposta vera.
//
// Hub isolato importato per primo (il perché sta in support/hub-isolato); i
// tenant stanno in DA_INVENT_DATA_DIR: lanciare con una cartella di prova.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { setIntegrationConfig } from "@/lib/integrations/config";
import { runJob } from "@/lib/cron/jobs";

const T = "TESTUNIFIJOB";

function nuovoJob(): number {
  return Number(
    getTenantDb(T)
      .prepare("INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled) VALUES (NULL, 'unifi_sync', 60, 1)")
      .run().lastInsertRowid,
  );
}

function apparati(): number {
  return (getTenantDb(T).prepare("SELECT COUNT(*) AS n FROM network_devices").get() as { n: number }).n;
}

beforeEach(() => {
  deleteTenantDatabase(T);
});

after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

test("job unifi_sync a integrazione spenta: fallisce col motivo e non scrive niente", async () => {
  setIntegrationConfig("unifi", { mode: "disabled" });
  const id = nuovoJob();
  await assert.rejects(
    withTenant(T, () => runJob(id)),
    /Integrazione UniFi disattivata/,
  );
  assert.equal(apparati(), 0);
});

test("job unifi_sync senza indirizzo del controller: fallisce col motivo, prima di qualunque rete", async () => {
  setIntegrationConfig("unifi", { mode: "external", url: "", kind: "self_hosted", username: "map", password: "prova" });
  const id = nuovoJob();
  await assert.rejects(
    withTenant(T, () => runJob(id)),
    /Indirizzo del controller non configurato/,
  );
  assert.equal(apparati(), 0);
});
