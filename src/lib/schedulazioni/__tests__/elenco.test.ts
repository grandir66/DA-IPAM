// Pagina Schedulazioni (tavola del 22/10, oggetti 21-30). Le schedulazioni erano in sei posti: questa prova fa fallire
// un tipo di job nuovo, o un timer nuovo avviato da server.ts, che non compare nell'elenco unico.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { closeHubDb } from "@/lib/db-hub";
import { createNetwork, createScheduledJob, deleteTenantDatabase, getScheduledJobs, getTenantDb, getTenantSetting, withTenant } from "@/lib/db-tenant";
import { SCHEDULED_JOB_TYPES } from "@/lib/scheduled-job-types";
import { saveEdgeSchedule } from "@/lib/vuln/edge-schedule-store";
import { statoScheduler, chiaveJob } from "@/lib/cron/stato-scheduler";
import { recordOutcome } from "@/lib/health/job-failure-tracker";
import { TIMER_DI_SERVER, elencoSchedulazioni } from "@/lib/schedulazioni/elenco";
import { cambiaSchedulazione } from "@/lib/schedulazioni/cambio";

const T = "TESTSCHEDULAZ";
const ADMIN = { ruolo: "admin", chi: "mario", idUtente: "7" };
let ricariche = 0;
const ricarica = () => { ricariche++; return null; };

beforeEach(() => {
  ricariche = 0;
  const db = getTenantDb(T);
  db.exec("DELETE FROM scheduled_jobs; DELETE FROM tenant_settings; DELETE FROM edge_scan_schedules; DELETE FROM networks");
  statoScheduler().fallimenti.jobs.clear();
});
after(() => { deleteTenantDatabase(T); closeHubDb(); removeTestHubDb(); });

const ADESSO = new Date("2026-10-23T08:00:00Z");

test("(a) ogni tipo di job ha la sua riga, una per job", async () => {
  await withTenant(T, async () => {
    const id = new Map<string, number>();
    for (const tipo of SCHEDULED_JOB_TYPES) {
      id.set(tipo, createScheduledJob({ job_type: tipo, interval_minutes: 60, network_id: null }).id);
    }
    const righe = new Set((await elencoSchedulazioni(ADESSO)).map((r) => r.id));
    for (const [tipo, n] of id) assert.ok(righe.has(`job.${n}`), `job ${tipo}`);
  });
});

test("(a) ogni modulo che server.ts avvia ha la sua riga, o il perché è fuori", async () => {
  const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
  const avviati = [...server.matchAll(/import\("(\.\/src\/lib\/[^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(avviati.length >= 8, `pochi moduli letti da server.ts (${avviati.length}): la ricerca si è rotta`);
  const righe = new Set(await withTenant(T, async () => (await elencoSchedulazioni(ADESSO)).map((r) => r.id)));
  for (const m of new Set(avviati)) {
    const voce = TIMER_DI_SERVER[m];
    assert.ok(voce, `${m}: avviato da server.ts ma né in Schedulazioni né fuori col perché`);
    if (!voce.startsWith("fuori:")) assert.ok(righe.has(voce), `${m}: manca la riga ${voce}`);
  }
});

test("(b) un job semplice si spegne dal suo interruttore, ricarica lo scheduler e scrive il registro", async () => {
  await withTenant(T, async () => {
    const j = createScheduledJob({ job_type: "snmp_scan", interval_minutes: 60, network_id: null });
    const r = await cambiaSchedulazione(`job.${j.id}`, { acceso: false }, ADMIN, ricarica);
    assert.equal(r.status, 200);
    assert.equal(getScheduledJobs().find((x) => x.id === j.id)?.enabled, 0);
    assert.equal(ricariche, 1);
  });
});

test("(b) un job di serie passa da Opzioni: spento da qui lascia la lapide", async () => {
  await withTenant(T, async () => {
    const j = createScheduledJob({ job_type: "arp_poll", interval_minutes: 30, network_id: null });
    const r = await cambiaSchedulazione(`job.${j.id}`, { acceso: false }, ADMIN, ricarica);
    assert.equal(r.status, 200);
    assert.equal(getScheduledJobs().find((x) => x.id === j.id)?.enabled, 0);
    assert.match(getTenantSetting("opzioni.job_di_serie.arp_poll") ?? "", /"da":"mario"/);
  });
});

test("(b) Edge e timer non si cambiano da qui (409 col posto); chi non è admin riceve 403", async () => {
  await withTenant(T, async () => {
    const rete = createNetwork({ cidr: "192.168.50.0/24", name: "LAN" });
    saveEdgeSchedule({
      network_id: rete.id, job_name: "x", frequency: "weekly", at_time: "22:00", days_of_week: "0", day_of_month: null,
      cron_expr: "0 22 * * 0", profile: "balanced", targeting_mode: null, enabled: true,
    });
    const righe = await elencoSchedulazioni(ADESSO);
    const edge = righe.find((r) => r.id === `edge.${rete.id}`);
    assert.deepEqual([edge?.quando, edge?.su], ["ogni dom alle 22:00", "LAN"]);
    const e = await cambiaSchedulazione(`edge.${rete.id}`, { acceso: false }, ADMIN, ricarica);
    assert.equal(e.status, 409);
    assert.equal(e.body.dove, `/networks/${rete.id}`);
    const b = await cambiaSchedulazione("timer.backup", { acceso: false }, ADMIN, ricarica);
    assert.equal(b.status, 409);
    const j = createScheduledJob({ job_type: "snmp_scan", interval_minutes: 60, network_id: null });
    const v = await cambiaSchedulazione(`job.${j.id}`, { acceso: false }, { ...ADMIN, ruolo: "viewer" }, ricarica);
    assert.equal(v.status, 403);
    assert.equal(getScheduledJobs().find((x) => x.id === j.id)?.enabled, 1);
  });
});

test("(c) un job che fallisce di fila si vede in errore col motivo", async () => {
  await withTenant(T, async () => {
    const j = createScheduledJob({ job_type: "snmp_scan", interval_minutes: 60, network_id: null });
    const k = chiaveJob(T, j.id);
    recordOutcome(statoScheduler().fallimenti, k, { ok: false, error: "timeout SNMP" }, ADESSO.getTime() - 60_000);
    recordOutcome(statoScheduler().fallimenti, k, { ok: false, error: "timeout SNMP" }, ADESSO.getTime());
    const r = (await elencoSchedulazioni(ADESSO)).find((x) => x.id === `job.${j.id}`);
    assert.equal(r?.esito.tipo, "errore");
    assert.match(r?.esito.testo ?? "", /timeout SNMP \(2 di fila\)$/);
  });
});

test("(d) prima chi ha un prossimo giro, il più vicino in cima", async () => {
  await withTenant(T, async () => {
    const a = createScheduledJob({ job_type: "snmp_scan", interval_minutes: 60, network_id: null });
    const b = createScheduledJob({ job_type: "nmap_scan", interval_minutes: 60, network_id: null });
    getTenantDb(T).prepare("UPDATE scheduled_jobs SET next_run = ? WHERE id = ?").run("2026-10-23 09:00:00", a.id);
    getTenantDb(T).prepare("UPDATE scheduled_jobs SET next_run = ? WHERE id = ?").run("2026-10-23 08:01:00", b.id);
    const ids = (await elencoSchedulazioni(ADESSO)).map((r) => r.id);
    assert.ok(ids.indexOf(`job.${b.id}`) < ids.indexOf(`job.${a.id}`));
    const conProssimo = (await elencoSchedulazioni(ADESSO)).filter((r) => r.prossimo).length;
    assert.ok(ids.slice(0, conProssimo).every((id) => id !== "timer.dalink"), "il segnale senza file non ha un prossimo giro");
  });
});
