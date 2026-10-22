/**
 * «Esegui ora» del job `apparati_scelti` (revisione finale del piano 2026-10-22 scansione automatica): il giro può durare
 * minuti (fino a 5 per apparato, 50 apparati), quindi si risponde subito («in_background», la rotta dà 202) e si gira in
 * sottofondo, con la stessa guardia del cron (`runningJobs`): un secondo «Esegui ora» o il tick programmato dello stesso job
 * mentre gira non partono (409 «giro già in corso» / «gia_in_esecuzione»). Prima la richiesta HTTP restava aperta per
 * tutto il giro e un tick del cron poteva accavallarsi.
 *
 * Letture finte: nessun traffico verso un apparato.
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/cron/__tests__/esegui-ora-apparati.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { closeTenantDb, deleteTenantDatabase, getScheduledJobById, getTenantDb, leggiEsitiJob, withTenant } from "@/lib/db-tenant";
import { eseguiJobOra } from "@/lib/cron/jobs";
import { eseguiJobProgrammato } from "@/lib/cron/scheduler";
import { chiaveJob, statoScheduler } from "@/lib/cron/stato-scheduler";
import type { OpzioniGiro } from "@/lib/apparati-scelti/giro";

const T = "TESTESEGUIORAAPPARATI";

after(() => {
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

function fixture(): number {
  const d = getTenantDb(T);
  const net = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('192.0.2.0/24', 'Prova')").run().lastInsertRowid);
  const host = Number(d.prepare("INSERT INTO hosts (network_id, ip, hostname) VALUES (?, '192.0.2.10', 'h')").run(net).lastInsertRowid);
  const cred = Number(d.prepare("INSERT INTO credentials (name, credential_type) VALUES ('voce snmp', 'snmp')").run().lastInsertRowid);
  const dev = Number(d.prepare(`INSERT INTO network_devices (name, host, device_type, vendor, protocol, host_id, use_for_arp_poll, community_string, enabled)
    VALUES ('SW-PROVA', '192.0.2.10', 'switch', 'hp', 'snmp_v2', ?, 0, 'public', 1)`).run(host).lastInsertRowid);
  d.prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated) VALUES (?, ?, 'snmp', 161, 1)").run(host, cred);
  return Number(d.prepare("INSERT INTO scheduled_jobs (job_type, interval_minutes, config, enabled) VALUES ('apparati_scelti', 240, ?, 1)")
    .run(JSON.stringify({ nome: "Prova", device_ids: [dev], cosa: { info: true, porte_mac: false, vlan: false } })).lastInsertRowid);
}

test("Esegui ora: risponde subito, gira in sottofondo con la guardia del cron; un secondo «Esegui ora» o il tick → fermati", async () => {
  const jobId = fixture();
  let libera!: () => void;
  const cancello = new Promise<void>((r) => { libera = r; });
  let chiamate = 0;
  const opz: OpzioniGiro = { leggiInfo: async () => { chiamate++; await cancello; return { stato: "letto", campi: 3 }; } };
  const chiave = chiaveJob(T, jobId);

  const primo = await withTenant(T, () => eseguiJobOra(jobId, { apparatiScelti: opz }));
  assert.equal(primo.modo, "in_background", "la risposta non aspetta il giro");
  assert.ok(statoScheduler().runningJobs.has(chiave), "il giro tiene la guardia del cron");

  const secondo = await withTenant(T, () => eseguiJobOra(jobId, { apparatiScelti: opz }));
  assert.deepEqual(secondo, { modo: "in_corso" });
  assert.equal(await eseguiJobProgrammato(chiave, jobId, T), "gia_in_esecuzione", "il tick del cron non si accavalla");

  libera();
  assert.equal(primo.modo, "in_background");
  await primo.fine;
  assert.equal(chiamate, 1, "un giro solo");
  assert.ok(!statoScheduler().runningJobs.has(chiave), "a giro finito la guardia si libera");
  withTenant(T, () => {
    assert.equal(leggiEsitiJob(jobId).righe[0]?.stato, "ok");
    assert.ok(getScheduledJobById(jobId)?.last_run, "last_run scritto a giro finito");
  });
});

test("Esegui ora: un giro che lancia libera comunque la guardia", async () => {
  const jobId = (getTenantDb(T).prepare("SELECT id FROM scheduled_jobs WHERE job_type = 'apparati_scelti' LIMIT 1").get() as { id: number }).id;
  const opz: OpzioniGiro = { leggiInfo: async () => { throw Object.assign(new Error("finto"), { code: "FINTO" }); } };
  const e = await withTenant(T, () => eseguiJobOra(jobId, { apparatiScelti: opz }));
  assert.equal(e.modo, "in_background");
  if (e.modo === "in_background") await e.fine;
  assert.ok(!statoScheduler().runningJobs.has(chiaveJob(T, jobId)));
});
