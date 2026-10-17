/**
 * Job d'installazione in memoria (passo 2 del piano di solidità, 2026-10-16):
 * il log ha un tetto e i job finiti da più di un'ora spariscono.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  appendLog,
  createJob,
  getJob,
  listJobs,
  pulisciJobFiniti,
  tagliaLog,
  updateJob,
  CONSERVA_FINITI_MS,
  MAX_RIGHE_LOG,
} from "../job-store";
import type { InstallJob } from "../types";

function job(id: string, extra: Partial<InstallJob> = {}): InstallJob {
  return { id, component: "docker", phase: "pulling", log: [], startedAt: new Date().toISOString(), ...extra };
}

describe("job-store: tetto al log", () => {
  beforeEach(() => { globalThis.__daipam_integration_jobs__ = undefined; });

  it("sotto il tetto il log resta intero", () => {
    createJob(job("a"));
    for (let i = 0; i < 10; i++) appendLog("a", `riga ${i}`);
    assert.equal(getJob("a")?.log.length, 10);
  });

  it(`oltre ${MAX_RIGHE_LOG} righe restano le ultime, con il conto delle omesse`, () => {
    createJob(job("a"));
    const totale = MAX_RIGHE_LOG + 250;
    for (let i = 0; i < totale; i++) appendLog("a", `riga ${i}`);
    const log = getJob("a")?.log ?? [];
    assert.equal(log.length, MAX_RIGHE_LOG);
    assert.equal(log[log.length - 1], `riga ${totale - 1}`);
    // Righe mostrate + omesse = tutte quelle scritte.
    const m = /^… (\d+) righe precedenti omesse …$/.exec(log[0]);
    assert.ok(m, `prima riga: ${log[0]}`);
    assert.equal(Number(m[1]) + (log.length - 1), totale);
    assert.equal(log[1], `riga ${Number(m[1])}`);
  });

  it("anche un log passato intero a updateJob/createJob ha il tetto", () => {
    const lungo = Array.from({ length: MAX_RIGHE_LOG * 2 }, (_, i) => `r${i}`);
    createJob(job("b", { log: lungo }));
    assert.equal(getJob("b")?.log.length, MAX_RIGHE_LOG);
    updateJob("b", { log: lungo });
    assert.equal(getJob("b")?.log.length, MAX_RIGHE_LOG);
    assert.equal(tagliaLog(["x"]).length, 1);
  });
});

describe("job-store: pulizia dei job finiti", () => {
  beforeEach(() => { globalThis.__daipam_integration_jobs__ = undefined; });

  it("toglie solo i finiti da più di un'ora", () => {
    // Relativo all'ora vera: createJob pulisce già con Date.now().
    const adesso = Date.now();
    const vecchio = new Date(adesso - CONSERVA_FINITI_MS - 1000).toISOString();
    const recente = new Date(adesso - CONSERVA_FINITI_MS + 60_000).toISOString();
    // Prima tutti creati, poi chiusi: createJob pulirebbe già i vecchi.
    for (const id of ["finito-vecchio", "errore-vecchio", "finito-recente", "in-corso", "senza-fine"]) {
      createJob(job(id));
    }
    updateJob("finito-vecchio", { phase: "done", finishedAt: vecchio });
    updateJob("errore-vecchio", { phase: "error", finishedAt: vecchio });
    updateJob("finito-recente", { phase: "done", finishedAt: recente });
    updateJob("senza-fine", { phase: "done" });

    assert.equal(pulisciJobFiniti(adesso), 2);
    assert.equal(getJob("finito-vecchio"), undefined);
    assert.equal(getJob("errore-vecchio"), undefined);
    assert.ok(getJob("finito-recente"));
    assert.ok(getJob("in-corso"));
    assert.ok(getJob("senza-fine"));
  });

  it("listJobs e createJob puliscono da soli", () => {
    const vecchio = new Date(Date.now() - CONSERVA_FINITI_MS - 1000).toISOString();
    createJob(job("v", { phase: "done", finishedAt: vecchio }));
    assert.deepEqual(listJobs().map((j) => j.id), []);
    globalThis.__daipam_integration_jobs__ = undefined;
    createJob(job("v", { phase: "error", finishedAt: vecchio }));
    createJob(job("nuovo"));
    assert.equal(getJob("v"), undefined);
    assert.ok(getJob("nuovo"));
  });
});
