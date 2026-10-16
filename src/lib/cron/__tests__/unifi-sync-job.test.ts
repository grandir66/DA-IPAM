// Job schedulato unifi_sync (ADR 0007): è la pianificazione di UN controller
// (`config.controller_id`). runJob lo smista a syncController e, se il giro non
// ha letto o scritto niente, lancia col motivo: lo scheduler lo conta fra i
// falliti (e ne avvisa se succede di fila) invece di dirlo «completato».
//
// Niente rete: solo casi che si fermano prima del controller (job senza
// controller, controller spento, credenziali mancanti). Il giro che scrive è
// provato in integrations/__tests__/unifi-sync.test.ts con la risposta vera.
//
// Hub isolato importato per primo (il perché sta in support/hub-isolato); i
// tenant stanno in DA_INVENT_DATA_DIR: lanciare con una cartella di prova.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, insertNetworkController, withTenant } from "@/lib/db-tenant";
import { runJob } from "@/lib/cron/jobs";

const T = "TESTUNIFIJOB";

function nuovoJob(controllerId?: number): number {
  const config = controllerId === undefined ? "{}" : JSON.stringify({ controller_id: controllerId });
  return Number(
    getTenantDb(T)
      .prepare("INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled, config) VALUES (NULL, 'unifi_sync', 60, 1, ?)")
      .run(config).lastInsertRowid,
  );
}

function controller(campi: { enabled: number; password_enc?: string }): number {
  return withTenant(T, () =>
    insertNetworkController({
      name: "Controller di prova",
      vendor: "unifi",
      kind: "self_hosted",
      url: "https://10.99.0.1:8443",
      site: "default",
      username: "map",
      password_enc: campi.password_enc ?? "",
      api_key_enc: "",
      cert_pin: null,
      enabled: campi.enabled,
      origin: "manual",
    }),
  ).id;
}

function letture(controllerId: number): Array<{ ok: number; trigger: string; message: string }> {
  return getTenantDb(T)
    .prepare("SELECT ok, trigger, message FROM network_controller_runs WHERE controller_id = ? ORDER BY id")
    .all(controllerId) as Array<{ ok: number; trigger: string; message: string }>;
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

test("job unifi_sync senza controller (nato prima dei controller multipli): fallisce col motivo, non indovina quale", async () => {
  const id = nuovoJob();
  await assert.rejects(withTenant(T, () => runJob(id)), /senza controller/);
  assert.equal(apparati(), 0);
});

test("job unifi_sync di un controller spento: fallisce col motivo, non scrive apparati, il giro resta nello storico", async () => {
  const c = controller({ enabled: 0 });
  const id = nuovoJob(c);
  await assert.rejects(withTenant(T, () => runJob(id)), /Controller spento/);
  assert.equal(apparati(), 0);
  const l = letture(c);
  assert.equal(l.length, 1);
  assert.equal(l[0].ok, 0);
  assert.equal(l[0].trigger, "schedule");
});

// Tappa 2f (T23): un controller senza voce d'archivio e senza segreti nelle
// colonne è «Credenziale mancante», detto prima di aprire una connessione.
test("job unifi_sync con credenziali mancanti: fallisce prima di qualunque rete, e la riga del controller lo dice", async () => {
  const c = controller({ enabled: 1 });
  const id = nuovoJob(c);
  await assert.rejects(withTenant(T, () => runJob(id)), /Credenziale mancante/);
  assert.equal(apparati(), 0);
  const row = getTenantDb(T).prepare("SELECT last_ok, last_message FROM network_controllers WHERE id = ?").get(c) as {
    last_ok: number;
    last_message: string;
  };
  assert.equal(row.last_ok, 0);
  assert.match(row.last_message, /Credenziale mancante: scegli una voce dell'archivio/);
});
