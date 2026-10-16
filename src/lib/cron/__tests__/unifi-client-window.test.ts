// Job dei client UniFi (topologia fase 2, spec §10.5): un secondo job
// unifi_sync per controller con config.cosa = "client", ogni ora, che legge
// solo dalle 7 alle 20 in ora italiana. Fuori finestra non chiama il
// controller, lo dice in una riga di log e non è un fallimento; dentro, un
// giro non riuscito fa fallire il job come per gli apparati.
//
// Niente rete: il controller della prova è spento, quindi il giro si ferma
// prima di qualunque richiesta (il giro che legge è provato in
// integrations/__tests__/unifi-clients-sync.test.ts).
//
// Hub isolato importato per primo (il perché sta in support/hub-isolato); i
// tenant stanno in DA_INVENT_DATA_DIR: lanciare con una cartella di prova.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, insertNetworkController, setControllerClientSchedule, withTenant } from "@/lib/db-tenant";
import { eseguiJobOra, inFinestraClient, runUnifiClientJob, unifiJobKind } from "@/lib/cron/jobs";

const T = "TESTUNIFICLIENTJOB";

test("finestra 7-20 in ora italiana, anche col cambio d'ora", () => {
  assert.equal(inFinestraClient(new Date("2026-10-13T04:59:00Z")), false); // 06:59 a Roma (estate)
  assert.equal(inFinestraClient(new Date("2026-10-13T05:00:00Z")), true); // 07:00
  assert.equal(inFinestraClient(new Date("2026-10-13T17:59:00Z")), true); // 19:59
  assert.equal(inFinestraClient(new Date("2026-10-13T18:00:00Z")), false); // 20:00
  assert.equal(inFinestraClient(new Date("2026-12-01T06:00:00Z")), true); // 07:00 d'inverno
  assert.equal(inFinestraClient(new Date("2026-12-01T05:59:00Z")), false); // 06:59 d'inverno
  assert.equal(inFinestraClient(new Date("2026-12-01T22:30:00Z")), false); // 23:30
});

test("il tipo di job: senza 'cosa' è la lettura degli apparati (job nati prima)", () => {
  assert.equal(unifiJobKind('{"controller_id":1}'), "apparati");
  assert.equal(unifiJobKind('{"controller_id":1,"cosa":"client"}'), "client");
  assert.equal(unifiJobKind("non json"), "apparati");
  assert.equal(unifiJobKind(null), "apparati");
});

function controllerSpento(): number {
  return withTenant(T, () =>
    insertNetworkController({
      name: "Controller di prova",
      vendor: "unifi",
      kind: "self_hosted",
      url: "https://10.99.0.1:8443",
      site: "default",
      username: "lettore",
      password_enc: "",
      api_key_enc: "",
      cert_pin: null,
      enabled: 0,
      origin: "manual",
    }),
  ).id;
}

function letture(controllerId: number): Array<{ ok: number; trigger: string }> {
  return getTenantDb(T)
    .prepare("SELECT ok, trigger FROM network_controller_runs WHERE controller_id = ? ORDER BY id")
    .all(controllerId) as Array<{ ok: number; trigger: string }>;
}

function catturaInfo<R>(fn: () => Promise<R>): Promise<{ righe: string[]; esito: R }> {
  const righe: string[] = [];
  const orig = console.info;
  console.info = (...a: unknown[]) => {
    righe.push(a.map(String).join(" "));
  };
  return fn()
    .then((esito) => ({ righe, esito }))
    .finally(() => {
      console.info = orig;
    });
}

beforeEach(() => {
  deleteTenantDatabase(T);
});

after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

test("fuori dalle 7-20: non chiama il controller, una riga di log, nessun giro nello storico, nessun errore", async () => {
  const c = controllerSpento();
  const { righe, esito } = await catturaInfo(() =>
    withTenant(T, () => runUnifiClientJob(c, new Date("2026-10-13T19:30:00Z"))), // 21:30 a Roma
  );
  assert.equal(righe.length, 1);
  assert.match(righe[0], /fuori dalle 7-20/);
  assert.match(String(esito), /Fuori dalle 7-20.*non sono stati letti/, "il motivo torna a chi chiama");
  assert.equal(letture(c).length, 0, "fuori orario non si registra nessun giro");
});

test("«Esegui ora» fuori dalle 7-20: la risposta dice che i client non sono stati letti (revisione finale)", async () => {
  const c = controllerSpento();
  withTenant(T, () => setControllerClientSchedule(c, true));
  const job = getTenantDb(T).prepare("SELECT id FROM scheduled_jobs WHERE job_type = 'unifi_sync'").get() as { id: number };
  const { esito } = await catturaInfo(() => withTenant(T, () => eseguiJobOra(job.id, { adesso: new Date("2026-10-13T19:30:00Z") })));
  assert.equal(esito.modo, "eseguito");
  assert.match(esito.modo === "eseguito" ? (esito.motivo ?? "") : "", /Fuori dalle 7-20.*non sono stati letti/);
  assert.equal(letture(c).length, 0);
});

test("dentro le 7-20: il giro parte (trigger client:schedule) e un giro non riuscito fa fallire il job", async () => {
  const c = controllerSpento();
  await assert.rejects(
    withTenant(T, () => runUnifiClientJob(c, new Date("2026-10-13T08:00:00Z"))), // 10:00 a Roma
    /Lettura dei client UniFi non riuscita.*Controller spento/,
  );
  const l = letture(c);
  assert.equal(l.length, 1);
  assert.equal(l[0].ok, 0);
  assert.equal(l[0].trigger, "client:schedule");
});
