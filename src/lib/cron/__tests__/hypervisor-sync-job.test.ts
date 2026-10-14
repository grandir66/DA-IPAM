// Job hypervisor_sync (topologia fase 2b, Task 4): uno per tenant, ogni giorno,
// SPENTO di default; legge con la scansione Proxmox tutti gli apparati
// hypervisor configurati. Un tenant senza hypervisor non chiama nessuno; un
// apparato che non si legge non ferma gli altri e non scrive niente (Review
// Focus 4, provato in proxmox/__tests__/run-proxmox-device-scan.test.ts).
// Nessun MAC, nome o IP nel log. Niente rete: la scansione è finta, oppure si
// ferma prima della rete (credenziali mancanti).
//
// Hub isolato importato per primo (il perché sta in support/hub-isolato); i
// tenant stanno in DA_INVENT_DATA_DIR: lanciare con una cartella di prova.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import {
  deleteTenantDatabase,
  getHypervisorSyncSchedule,
  getTenantDb,
  setHypervisorSyncSchedule,
  withTenant,
} from "@/lib/db-tenant";
import { encrypt } from "@/lib/crypto";
import { HYPERVISOR_SYNC_MINUTES, runHypervisorSync, runJob } from "@/lib/cron/jobs";

const T = "TESTHYPERVISORJOB";

after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

beforeEach(() => {
  deleteTenantDatabase(T);
});

function apparato(campi: { name: string; host: string; device_type: string; vendor: string; scan_target?: string | null; enabled?: number; creds?: boolean }): number {
  return Number(
    getTenantDb(T)
      .prepare(
        `INSERT INTO network_devices (name, host, device_type, vendor, protocol, scan_target, username, encrypted_password, enabled)
         VALUES (?, ?, ?, ?, 'ssh', ?, ?, ?, ?)`,
      )
      .run(
        campi.name, campi.host, campi.device_type, campi.vendor, campi.scan_target ?? null,
        campi.creds === false ? null : "root", campi.creds === false ? null : encrypt("segreto-di-prova"), campi.enabled ?? 1,
      ).lastInsertRowid,
  );
}

function jobHypervisor(): Array<{ id: number; network_id: number | null; interval_minutes: number; enabled: number; config: string }> {
  return getTenantDb(T)
    .prepare("SELECT id, network_id, interval_minutes, enabled, config FROM scheduled_jobs WHERE job_type = 'hypervisor_sync' ORDER BY id")
    .all() as Array<{ id: number; network_id: number | null; interval_minutes: number; enabled: number; config: string }>;
}

async function catturaLog<R>(fn: () => Promise<R>): Promise<{ righe: string[]; esito: R | Error }> {
  const righe: string[] = [];
  const orig = { info: console.info, warn: console.warn, error: console.error, log: console.log };
  const prendi = (...a: unknown[]) => righe.push(a.map((x) => (x instanceof Error ? `${x.message}` : String(x))).join(" "));
  console.info = prendi; console.warn = prendi; console.error = prendi; console.log = prendi;
  try {
    return { righe, esito: await fn() };
  } catch (e) {
    return { righe, esito: e instanceof Error ? e : new Error(String(e)) };
  } finally {
    Object.assign(console, orig);
  }
}

const NIENTE_DATI = /192\.0\.2\.|02:00:00|HV-|PVE-/i;

test("spento di default: un tenant nuovo non ha il job hypervisor_sync", () => {
  getTenantDb(T);
  assert.deepEqual(jobHypervisor(), []);
  assert.deepEqual(withTenant(T, () => getHypervisorSyncSchedule()), { enabled: false, jobId: null, lastRun: null, hypervisors: 0, lastScanAt: null });
});

test("setHypervisorSyncSchedule: acceso = un job solo, ogni giorno, config {}; spento = nessun job", () => {
  withTenant(T, () => setHypervisorSyncSchedule(true));
  withTenant(T, () => setHypervisorSyncSchedule(true));
  const jobs = jobHypervisor();
  assert.equal(jobs.length, 1);
  assert.deepEqual({ ...jobs[0], id: 0 }, { id: 0, network_id: null, interval_minutes: 1440, enabled: 1, config: "{}" });
  assert.equal(HYPERVISOR_SYNC_MINUTES, 1440);
  assert.equal(withTenant(T, () => getHypervisorSyncSchedule()).enabled, true);
  assert.equal(withTenant(T, () => getHypervisorSyncSchedule()).jobId, jobs[0].id);
  withTenant(T, () => setHypervisorSyncSchedule(false));
  assert.deepEqual(jobHypervisor(), []);
  assert.equal(withTenant(T, () => getHypervisorSyncSchedule()).enabled, false);
});

test("stato per la pagina: quanti hypervisor configurati e l'ultima lettura", () => {
  const a = apparato({ name: "HV-1", host: "192.0.2.11", device_type: "hypervisor", vendor: "proxmox", scan_target: "proxmox" });
  apparato({ name: "HV-2", host: "192.0.2.12", device_type: "server", vendor: "proxmox" });
  apparato({ name: "HV-3", host: "192.0.2.13", device_type: "hypervisor", vendor: "proxmox", enabled: 0 });
  apparato({ name: "SW-1", host: "192.0.2.2", device_type: "switch", vendor: "ubiquiti" });
  getTenantDb(T).prepare("UPDATE network_devices SET last_proxmox_scan_at = '2026-10-13T22:51:06.323Z' WHERE id = ?").run(a);
  const s = withTenant(T, () => getHypervisorSyncSchedule());
  assert.equal(s.hypervisors, 2);
  assert.equal(s.lastScanAt, "2026-10-13T22:51:06.323Z");
});

test("tenant senza hypervisor: nessuna chiamata, e il resoconto lo dice", async () => {
  apparato({ name: "SW-1", host: "192.0.2.2", device_type: "switch", vendor: "ubiquiti" });
  apparato({ name: "SRV-1", host: "192.0.2.20", device_type: "server", vendor: "linux", scan_target: "linux" });
  const chiamate: number[] = [];
  const r = await withTenant(T, () => runHypervisorSync(async (id) => {
    chiamate.push(id);
  }));
  assert.deepEqual(chiamate, []);
  assert.deepEqual(r, { hypervisors: 0, letti: 0, falliti: 0, errori: [] });
});

test("legge solo gli hypervisor Proxmox accesi; uno che fallisce non ferma gli altri; nel log solo numeri", async () => {
  const a = apparato({ name: "HV-1", host: "192.0.2.11", device_type: "hypervisor", vendor: "proxmox", scan_target: "proxmox" });
  const b = apparato({ name: "HV-2", host: "192.0.2.12", device_type: "server", vendor: "proxmox" });
  apparato({ name: "HV-3", host: "192.0.2.13", device_type: "hypervisor", vendor: "proxmox", enabled: 0 });
  apparato({ name: "SW-1", host: "192.0.2.2", device_type: "switch", vendor: "ubiquiti" });
  const chiamate: number[] = [];
  const { esito, righe } = await catturaLog(() =>
    withTenant(T, () =>
      runHypervisorSync(async (id) => {
        chiamate.push(id);
        if (id === a) throw new Error("connect ETIMEDOUT 192.0.2.11:22");
      }),
    ),
  );
  assert.ok(!(esito instanceof Error));
  assert.deepEqual(chiamate.sort(), [a, b].sort());
  assert.deepEqual(esito, { hypervisors: 2, letti: 1, falliti: 1, errori: [`Apparato #${a}: connect ETIMEDOUT 192.0.2.11:22`] });
  for (const r of righe) assert.doesNotMatch(r, NIENTE_DATI, `nel log: ${r}`);
});

test("runJob: tenant senza hypervisor → eseguito senza chiamate, col motivo", async () => {
  apparato({ name: "SW-1", host: "192.0.2.2", device_type: "switch", vendor: "ubiquiti" });
  withTenant(T, () => setHypervisorSyncSchedule(true));
  const [job] = jobHypervisor();
  const { esito, righe } = await catturaLog(() => withTenant(T, () => runJob(job.id)));
  assert.deepEqual(esito, { esito: "eseguito", motivo: "Nessun hypervisor con scansione Proxmox configurata: niente da leggere" });
  for (const r of righe) assert.doesNotMatch(r, NIENTE_DATI, `nel log: ${r}`);
});

test("runJob: nessun hypervisor letto → il job fallisce (lo scheduler lo conta), senza nomi né IP nel messaggio", async () => {
  // Credenziali mancanti: la scansione si ferma prima della rete.
  apparato({ name: "HV-1", host: "192.0.2.11", device_type: "hypervisor", vendor: "proxmox", scan_target: "proxmox", creds: false });
  withTenant(T, () => setHypervisorSyncSchedule(true));
  const [job] = jobHypervisor();
  const { esito, righe } = await catturaLog(() => withTenant(T, () => runJob(job.id)));
  assert.ok(esito instanceof Error);
  assert.match(esito.message, /Lettura degli hypervisor non riuscita: 0 letti su 1/);
  assert.doesNotMatch(esito.message, NIENTE_DATI);
  for (const r of righe) assert.doesNotMatch(r, NIENTE_DATI, `nel log: ${r}`);
});
