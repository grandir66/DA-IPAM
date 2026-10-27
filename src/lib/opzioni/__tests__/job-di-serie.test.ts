// Spec pagina Opzioni §3.2 (22/10, 70151: nessun job leggeva gli apparati, perché giro ARP, scansioni e lettura degli
// hypervisor si creavano a mano). Quattro job nascono da soli; uno spento da un admin resta spento (la lapide).
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import {
  applyTenantSchedulerDefaults, createNetwork, createScheduledJob, deleteTenantDatabase, getScheduledJobs, getTenantDb, toggleJob, withTenant,
} from "@/lib/db-tenant";
import { JOB_DI_SERIE, chiaveLapide, lapide, scriviLapide, seminaJobDiSerie, togliLapide } from "@/lib/opzioni/job-di-serie";

const T = "TESTJOBDISERIE";
beforeEach(() => {
  const d = getTenantDb(T);
  d.exec("DELETE FROM scheduled_jobs; DELETE FROM networks; DELETE FROM tenant_settings WHERE key LIKE 'opzioni.%'");
});
after(() => { deleteTenantDatabase(T); closeHubDb(); removeTestHubDb(); });

const tipi = (): string[] => getScheduledJobs().map((j) => j.job_type).sort();

test("i quattro di serie, coi valori decisi: ARP 30 min, DNS ogni giorno, hypervisor, scansione veloce 12 ore per rete", () => {
  assert.deepEqual(JOB_DI_SERIE.map((j) => [j.tipo, j.intervalloMinuti, j.perRete]), [
    ["arp_poll", 30, false], ["hypervisor_sync", 1440, false], ["dns_resolve", 1440, false], ["fast_scan", 720, true],
  ]);
});

test("su un cliente con una rete nascono i quattro; un secondo giro non ne crea altri", () => {
  withTenant(T, () => {
    const rete = createNetwork({ cidr: "192.168.50.0/24", name: "LAN" });
    assert.equal(seminaJobDiSerie().creati, 4);
    const jobs = getScheduledJobs();
    const per = (t: string) => jobs.filter((j) => j.job_type === t);
    assert.equal(per("arp_poll")[0].interval_minutes, 30);
    assert.equal(per("arp_poll")[0].network_id, null);
    assert.equal(per("dns_resolve")[0].interval_minutes, 1440);
    assert.equal(per("hypervisor_sync").length, 1);
    assert.equal(per("fast_scan")[0].network_id, rete.id);
    assert.equal(per("fast_scan")[0].interval_minutes, 720);
    assert.ok(jobs.every((j) => j.enabled === 1), "accesi");
    assert.equal(seminaJobDiSerie().creati, 0, "idempotente");
  });
});

test("cliente senza reti: niente scansione veloce, gli altri tre sì", () => {
  withTenant(T, () => {
    assert.equal(seminaJobDiSerie().creati, 3);
    assert.deepEqual(tipi(), ["arp_poll", "dns_resolve", "hypervisor_sync"]);
  });
});

test("non tocca i job che esistono: un giro ARP a 15 minuti e un DNS spento senza lapide restano come sono", () => {
  withTenant(T, () => {
    createScheduledJob({ job_type: "arp_poll", interval_minutes: 15, network_id: null });
    const dns = createScheduledJob({ job_type: "dns_resolve", interval_minutes: 60, network_id: null });
    toggleJob(dns.id, false);
    seminaJobDiSerie();
    const arp = getScheduledJobs().filter((j) => j.job_type === "arp_poll");
    assert.equal(arp.length, 1);
    assert.equal(arp[0].interval_minutes, 15);
    const d = getScheduledJobs().filter((j) => j.job_type === "dns_resolve");
    assert.equal(d.length, 1);
    assert.equal(d[0].enabled, 0);
  });
});

test("con la lapide non nasce; tolta la lapide sì", () => {
  withTenant(T, () => {
    scriviLapide("arp_poll", "admin", new Date("2026-10-22T13:12:00Z"));
    assert.deepEqual(lapide("arp_poll"), { acceso: false, da: "admin", il: "2026-10-22 13:12:00" });
    seminaJobDiSerie();
    assert.ok(!tipi().includes("arp_poll"));
    togliLapide("arp_poll");
    assert.equal(lapide("arp_poll"), null);
    seminaJobDiSerie();
    assert.ok(tipi().includes("arp_poll"));
  });
});

test("una lapide rovinata vale come lapide: nel dubbio non si crea niente", () => {
  withTenant(T, () => {
    getTenantDb(T).prepare("INSERT INTO tenant_settings (key, value) VALUES (?, ?)").run(chiaveLapide("dns_resolve"), "{rotta");
    seminaJobDiSerie();
    assert.ok(!tipi().includes("dns_resolve"));
  });
});

test("il freno sulle reti /22 non spegne la scansione veloce a 12 ore", () => {
  withTenant(T, () => {
    createNetwork({ cidr: "10.20.0.0/22", name: "grande" });
    seminaJobDiSerie();
    const r = applyTenantSchedulerDefaults();
    assert.equal(r.jobsDisabled, 0);
    assert.equal(getScheduledJobs().find((j) => j.job_type === "fast_scan")?.enabled, 1);
  });
});
