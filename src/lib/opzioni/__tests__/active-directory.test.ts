// Riccardo, 29/10/2026: «sarebbe comodo avere [l'integrazione AD] nella pagina delle opzioni». Una levetta
// per integrazione (accesa garantisce la sincronizzazione automatica) e una riga per la sincronizzazione
// (ad_sync, una per tutte), col suo ritmo.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { createAdIntegration, deleteTenantDatabase, getAdIntegrations, getScheduledJobs, getTenantDb, withTenant } from "@/lib/db-tenant";
import { stopTenantJobs } from "@/lib/cron/scheduler";
import { catalogo } from "@/lib/opzioni/catalogo";
import { idOpzioneDelJob } from "@/lib/opzioni/ancore";
import type { StatoOpzione } from "@/lib/opzioni/tipi";

const T = "TESTOPZIONIAD";
beforeEach(() => {
  getTenantDb(T).exec("DELETE FROM scheduled_jobs; DELETE FROM ad_integrations");
});
// ensureAdSyncJob ricarica lo scheduler: i timer accesi terrebbero vivo il processo delle prove.
after(() => { stopTenantJobs(T); deleteTenantDatabase(T); closeHubDb(); removeTestHubDb(); });

const voce = (id: string) => withTenant(T, () => catalogo().find((o) => o.id === id));
const adSync = () => getScheduledJobs().filter((j) => j.job_type === "ad_sync");
const nuova = (enabled: number) => withTenant(T, () =>
  createAdIntegration({ name: "dominio", dc_host: "dc.esempio.invalid", domain: "esempio.invalid", base_dn: "DC=esempio,DC=invalid",
    encrypted_username: "", encrypted_password: "", enabled }).id);

test("senza integrazioni né job: una riga che porta ad aggiungerla", () => {
  const o = voce("ad.nessuna");
  assert.ok(o);
  assert.equal(o.configura?.href, "/active-directory");
  assert.equal(o.cambia, undefined);
});

test("integrazione accesa dalle Opzioni: abilitata e sincronizzazione automatica creata", () => {
  const id = nuova(0);
  const o = voce(`ad.${id}`);
  assert.ok(o?.cambia);
  withTenant(T, () => {
    assert.equal((o.leggi() as StatoOpzione).acceso, false);
    void o.cambia!({ acceso: true }, "prova");
    assert.equal(getAdIntegrations().find((i) => i.id === id)?.enabled, 1);
    assert.equal(adSync().length, 1);
    assert.equal(adSync()[0].interval_minutes, 360);
    void o.cambia!({ acceso: false }, "prova");
    assert.equal(getAdIntegrations().find((i) => i.id === id)?.enabled, 0);
  });
});

test("accesa ma con la sincronizzazione spenta: lo dice con un avviso", () => {
  const id = nuova(1);
  const s = withTenant(T, () => voce(`ad.${id}`)!.leggi() as StatoOpzione);
  assert.equal(s.acceso, true);
  assert.equal(s.esito.tipo, "attenzione");
});

test("la riga della sincronizzazione: ritmo, spegnimento, ed è la riga del job ad_sync", () => {
  nuova(1);
  const o = voce("ad.sincronizzazione");
  assert.ok(o?.cambia);
  withTenant(T, () => {
    void o.cambia!({ valore: "720" }, "prova");
    assert.equal(adSync()[0].interval_minutes, 720);
    void o.cambia!({ acceso: false }, "prova");
    assert.equal(adSync()[0].enabled, 0);
    const j = adSync()[0];
    assert.equal(idOpzioneDelJob(j), "ad.sincronizzazione");
    assert.ok(!catalogo().some((x) => x.id === `job.${j.id}`), "niente doppione fra i job generici");
  });
});
