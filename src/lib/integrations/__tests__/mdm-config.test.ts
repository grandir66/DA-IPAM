process.env.ENCRYPTION_KEY ||= "test-encryption-key-mdm-config";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { withTenant, deleteTenantDatabase, getTenantDb } from "@/lib/db-tenant";
import { assicuraColonneMdmConfig } from "@/lib/db-tenant-schema";
import {
  saveMdmConfig,
  getMdmConfig,
  getMdmCreds,
  recordSync,
  MDM_MAX_ERRORI_CONSECUTIVI,
  MDM_SYNC_INTERVALLO_MINUTI,
} from "@/lib/integrations/mdm-config";

const T = "TESTMDMCFG";
const T_JOB = "TESTMDMJOB";
const T_RIATT = "TESTMDMRIATT";
after(() => {
  deleteTenantDatabase(T);
  deleteTenantDatabase(T_JOB);
  deleteTenantDatabase(T_RIATT);
});

const BASE = { base_url: "http://mdm.example.test:8088", username: "admin" };

function jobsMdm(code: string): Array<{ id: number; enabled: number; interval_minutes: number; network_id: number | null }> {
  return getTenantDb(code)
    .prepare(`SELECT id, enabled, interval_minutes, network_id FROM scheduled_jobs WHERE job_type='mdm_sync' ORDER BY id`)
    .all() as Array<{ id: number; enabled: number; interval_minutes: number; network_id: number | null }>;
}

test("config save/read + creds decrypt + auto-disable", () => {
  withTenant(T, () => {
    saveMdmConfig({ ...BASE, password: "secret", enabled: true });
    const cfg = getMdmConfig();
    assert.equal(cfg.base_url, BASE.base_url);
    assert.equal(cfg.username, "admin");
    assert.equal(cfg.enabled, true);
    assert.equal((cfg as unknown as Record<string, unknown>).password_encrypted, undefined); // never leaked

    const creds = getMdmCreds();
    assert.equal(creds!.password, "secret");

    // save without password keeps the existing one
    saveMdmConfig({ ...BASE, enabled: true });
    assert.equal(getMdmCreds()!.password, "secret");

    for (let i = 0; i < 5; i++) recordSync(false, "boom");
    const after5 = getMdmConfig();
    assert.equal(after5.enabled, false); // auto-disabled
    assert.equal(after5.consecutive_errors, 5);
    assert.equal(after5.last_error, "boom");

    recordSync(true);
    assert.equal(getMdmConfig().consecutive_errors, 0);
    assert.equal(getMdmConfig().last_error, null);
  });
});

test("cinque errori di fila → spento da solo, e la pagina lo sa (auto_disabled)", () => {
  withTenant(T_RIATT, () => {
    saveMdmConfig({ ...BASE, password: "p", enabled: true });
    for (let i = 0; i < MDM_MAX_ERRORI_CONSECUTIVI - 1; i++) recordSync(false, "timeout");
    assert.equal(getMdmConfig().enabled, true, "quattro errori: ancora acceso");
    assert.equal(getMdmConfig().auto_disabled, false);

    recordSync(false, "timeout");
    const cfg = getMdmConfig();
    assert.equal(MDM_MAX_ERRORI_CONSECUTIVI, 5);
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.consecutive_errors, 5);
    assert.equal(cfg.auto_disabled, true);
    assert.ok(cfg.last_attempt_at, "tentativo registrato");
    assert.equal(cfg.last_success_at, null, "mai riuscito");
  });
});

test("riattivare azzera il contatore degli errori; salvare da acceso non lo tocca", () => {
  withTenant(T_RIATT, () => {
    // Stato del test precedente: spento da solo con 5 errori.
    const esito = saveMdmConfig({ ...BASE, enabled: true });
    assert.equal(esito.riattivato, true);
    const cfg = getMdmConfig();
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.consecutive_errors, 0);
    assert.equal(cfg.auto_disabled, false);

    // Un errore dopo la riattivazione non la rispegne subito.
    recordSync(false, "di nuovo");
    assert.equal(getMdmConfig().enabled, true);
    assert.equal(getMdmConfig().consecutive_errors, 1);

    // Salvare quando è già acceso non è una riattivazione: il contatore resta.
    const ancora = saveMdmConfig({ ...BASE, enabled: true });
    assert.equal(ancora.riattivato, false);
    assert.equal(getMdmConfig().consecutive_errors, 1);

    // Una riuscita scrive l'ultima riuscita.
    recordSync(true);
    const ok = getMdmConfig();
    assert.ok(ok.last_success_at);
    assert.ok(ok.last_attempt_at);
    assert.equal(ok.consecutive_errors, 0);
  });
});

test("il job mdm_sync nasce e muore con l'interruttore, senza doppioni", () => {
  withTenant(T_JOB, () => {
    assert.deepEqual(jobsMdm(T_JOB), []);

    // Spento e mai acceso: nessun job.
    assert.equal(saveMdmConfig({ ...BASE, password: "p", enabled: false }).job, "assente");
    assert.deepEqual(jobsMdm(T_JOB), []);

    // Acceso: un job, acceso, per tutto il tenant.
    assert.equal(saveMdmConfig({ ...BASE, enabled: true }).job, "creato");
    let jobs = jobsMdm(T_JOB);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].enabled, 1);
    assert.equal(jobs[0].network_id, null);
    assert.equal(jobs[0].interval_minutes, MDM_SYNC_INTERVALLO_MINUTI);

    // Salvare di nuovo da acceso: niente doppioni.
    assert.equal(saveMdmConfig({ ...BASE, enabled: true }).job, "invariato");
    assert.equal(jobsMdm(T_JOB).length, 1);

    // Un job spento a mano si riaccende, non se ne aggiunge un secondo.
    getTenantDb(T_JOB).prepare(`UPDATE scheduled_jobs SET enabled=0 WHERE job_type='mdm_sync'`).run();
    assert.equal(saveMdmConfig({ ...BASE, enabled: true }).job, "riacceso");
    jobs = jobsMdm(T_JOB);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].enabled, 1);

    // Spento: il job sparisce.
    assert.equal(saveMdmConfig({ ...BASE, enabled: false }).job, "rimosso");
    assert.deepEqual(jobsMdm(T_JOB), []);

    // Riacceso: torna, uno solo.
    assert.equal(saveMdmConfig({ ...BASE, enabled: true }).job, "creato");
    assert.equal(jobsMdm(T_JOB).length, 1);
  });
});

test("colonne nuove di mdm_config: ALTER TABLE idempotente su un DB vecchio, solo additivo", () => {
  const vecchio = new Database(":memory:");
  vecchio.exec(`CREATE TABLE mdm_config (
    id INTEGER PRIMARY KEY CHECK (id = 1), base_url TEXT, username TEXT, password_encrypted TEXT,
    jwt_cached TEXT, jwt_expires_at TEXT, user_field TEXT DEFAULT 'description', enabled INTEGER DEFAULT 0,
    last_sync_at TEXT, last_error TEXT, consecutive_errors INTEGER DEFAULT 0)`);
  vecchio.prepare(`INSERT INTO mdm_config (id, base_url, enabled, consecutive_errors) VALUES (1, 'x', 1, 2)`).run();

  assert.deepEqual(assicuraColonneMdmConfig(vecchio), ["last_attempt_at", "last_success_at"]);
  assert.deepEqual(assicuraColonneMdmConfig(vecchio), [], "la seconda volta non fa niente");

  const riga = vecchio.prepare(`SELECT * FROM mdm_config WHERE id=1`).get() as Record<string, unknown>;
  assert.equal(riga.base_url, "x");
  assert.equal(riga.consecutive_errors, 2);
  assert.equal(riga.last_attempt_at, null);
  assert.equal(riga.last_success_at, null);

  // Tabella assente: la crea lo schema, non questa funzione.
  const vuoto = new Database(":memory:");
  assert.deepEqual(assicuraColonneMdmConfig(vuoto), []);
  vecchio.close();
  vuoto.close();
});
