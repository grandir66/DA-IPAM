// Rotte di Opzioni (spec §3.3, piano Task 3). `requireAdmin` legge la sessione e `mock.module` non gira sotto Node 22
// con tsx: la logica sta in lib/opzioni/cambio.ts e si prova qui; la guardia della rotta la prova api-auth-guards.test.ts.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { closeHubDb } from "@/lib/db-hub";
import { createNetwork, deleteTenantDatabase, getScheduledJobs, getTenantDb, getTenantSetting, withTenant } from "@/lib/db-tenant";
import { cambiaOpzione, elencoOpzioni, type Chiamante } from "@/lib/opzioni/cambio";
import { chiaveLapide } from "@/lib/opzioni/job-di-serie";
import { seminaJobDiSerie } from "@/lib/opzioni/job-di-serie";
import type { Opzione } from "@/lib/opzioni/tipi";

const T = "TESTOPZIONIROTTE";
beforeEach(() => {
  getTenantDb(T).exec("DELETE FROM scheduled_jobs; DELETE FROM networks; DELETE FROM tenant_settings");
});
after(() => { deleteTenantDatabase(T); closeHubDb(); removeTestHubDb(); });

const admin: Chiamante = { ruolo: "admin", chi: "Mario", idUtente: "3" };
const viewer: Chiamante = { ruolo: "viewer", chi: "Ugo", idUtente: "4" };
let ricariche = 0;
const ricarica = (): string | null => { ricariche++; return null; };
const cambia = (id: string, corpo: unknown, c: Chiamante = admin) => withTenant(T, () => cambiaOpzione(id, corpo, c, ricarica));

test("GET: tutte le opzioni con lo stato; puoCambiare solo per un admin", async () => {
  const a = await withTenant(T, () => elencoOpzioni("admin"));
  const v = await withTenant(T, () => elencoOpzioni("viewer"));
  assert.equal(a.puoCambiare, true);
  assert.equal(v.puoCambiare, false);
  assert.equal(v.opzioni.length, a.opzioni.length, "chi non è admin vede tutto");
  const r = a.opzioni.find((o) => o.id === "lettura.mikrotik_scheda");
  assert.equal(r?.stato.acceso, true);
  assert.equal(r?.cambiabile, true);
  assert.equal(a.opzioni.find((o) => o.id === "file.tls_redirect")?.cambiabile, false);
  assert.equal(typeof (r as unknown as { leggi?: unknown }).leggi, "undefined", "le funzioni non escono dalla rotta");
});

test("PUT: chi non è admin → 403, id sconosciuto → 404, voce da file → 405, modulo che si accende configurandolo → 409", async () => {
  assert.equal((await cambia("lettura.mikrotik", { acceso: false }, viewer)).status, 403);
  assert.equal((await cambia("non.esiste", { acceso: false })).status, 404);
  const f = await cambia("file.tls_redirect", { acceso: true });
  assert.equal(f.status, 405);
  assert.match(String(f.body.error), /TLS_REDIRECT/);
  assert.equal((await cambia("modulo.wazuh", { acceso: true })).status, 409);
});

test("PUT: corpo vuoto, campi in più o valore troppo lungo → 400", async () => {
  assert.equal((await cambia("lettura.mikrotik", {})).status, 400);
  assert.equal((await cambia("lettura.mikrotik", { acceso: false, altro: 1 })).status, 400);
  assert.equal((await cambia("lettura.mikrotik", { valore: "x".repeat(65) })).status, 400);
  assert.equal((await cambia("lettura.mikrotik", null)).status, 400);
});

test("PUT: spegnere una lettura scrive chi e quando; la riga lo dice", async () => {
  const r = await cambia("lettura.mikrotik", { acceso: false });
  assert.equal(r.status, 200);
  const stato = r.body.stato as { acceso: boolean; da: string; il: string };
  assert.equal(stato.acceso, false);
  assert.equal(stato.da, "Mario");
  assert.match(stato.il, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test("PUT job di serie: spento = enabled 0 + lapide e scheduler ricaricato; riacceso = lapide tolta, job acceso", async () => {
  withTenant(T, () => { seminaJobDiSerie(); });
  ricariche = 0;
  const off = await cambia("job.arp_poll", { acceso: false });
  assert.equal(off.status, 200);
  assert.equal(ricariche, 1);
  withTenant(T, () => {
    assert.equal(getScheduledJobs().find((j) => j.job_type === "arp_poll")?.enabled, 0);
    assert.ok(getTenantSetting(chiaveLapide("arp_poll")));
  });
  const on = await cambia("job.arp_poll", { acceso: true });
  assert.equal(on.status, 200);
  withTenant(T, () => {
    assert.equal(getScheduledJobs().find((j) => j.job_type === "arp_poll")?.enabled, 1);
    assert.equal(getTenantSetting(chiaveLapide("arp_poll")), null);
  });
});

test("PUT job di serie che manca: accenderlo da qui lo crea; il ritmo si cambia solo fra le scelte", async () => {
  withTenant(T, () => { createNetwork({ cidr: "192.168.60.0/24", name: "LAN" }); });
  const on = await cambia("job.fast_scan", { acceso: true });
  assert.equal(on.status, 200);
  withTenant(T, () => assert.equal(getScheduledJobs().filter((j) => j.job_type === "fast_scan").length, 1));
  assert.equal((await cambia("job.fast_scan", { valore: "1440" })).status, 200);
  withTenant(T, () => assert.equal(getScheduledJobs().find((j) => j.job_type === "fast_scan")?.interval_minutes, 1440));
  assert.equal((await cambia("job.fast_scan", { valore: "60" })).status, 400, "sotto le 12 ore il freno /22 lo spegnerebbe");
  assert.equal((await cambia("job.hypervisor_sync", { valore: "60" })).status, 400, "ritmo fisso");
});

test("PUT: un cambio rifiutato dice il perché e non cambia niente; uno che lancia → 500 col codice", async () => {
  const r = await cambia("automatismo.freno_offline", { valore: "sempre" });
  assert.equal(r.status, 400);
  const rotta: Opzione = {
    id: "prova.rotta", gruppo: "automatismi", nome: "rotta", cosa: "", valePer: "cliente", forma: "levetta", diSerie: "",
    leggi: () => ({ acceso: true, da: null, il: null, esito: { tipo: "ok", testo: "" } }),
    cambia() { throw Object.assign(new Error("disk I/O error"), { code: "SQLITE_IOERR" }); },
  };
  const e = await withTenant(T, () => cambiaOpzione("prova.rotta", { acceso: false }, admin, ricarica, [rotta]));
  assert.deepEqual([e.status, e.body.error], [500, "Cambio non riuscito (SQLITE_IOERR)"]);
});

test("PUT: un'opzione dell'hub la cambia un admin (stessa regola di PUT /api/settings)", async () => {
  const r = await cambia("automatismo.naabu", { acceso: true });
  assert.equal(r.status, 200);
  assert.equal((r.body.stato as { acceso: boolean }).acceso, true);
  assert.equal((await cambia("automatismo.naabu", { acceso: false }, viewer)).status, 403);
});

test("le rotte: GET con requireAuth, PUT con requireAdmin, entrambe nel contesto del cliente", () => {
  const dir = join(process.cwd(), "src", "app", "api", "opzioni");
  const get = readFileSync(join(dir, "route.ts"), "utf8");
  const put = readFileSync(join(dir, "[id]", "route.ts"), "utf8");
  assert.match(get, /withTenantFromSession[\s\S]*requireAuth\(\)/);
  assert.match(put, /withTenantFromSession[\s\S]*requireAdmin\(\)/);
  assert.match(put, /reloadSchedulerForCurrentTenant/);
});
