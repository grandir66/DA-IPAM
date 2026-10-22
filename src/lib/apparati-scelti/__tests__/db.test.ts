/**
 * Funzioni DB della scansione automatica dei device scelti (piano 2026-10-22, Task 3): lo stato degli apparati in
 * UNA query (niente N+1: un giro da 50 apparati non fa 150 letture), gli esiti per job e apparato (solo l'ultimo
 * giro), i job che contengono un apparato, la cancellazione degli esiti con il job.
 *
 * Run: node --import tsx --test src/lib/apparati-scelti/__tests__/db.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import type Database from "better-sqlite3";
import { closeHubDb } from "@/lib/db-hub";
import {
  cancellaEsitiJob,
  cancellaEsitiOrfani,
  closeTenantDb,
  deleteTenantDatabase,
  getNetworkDeviceById,
  getTenantDb,
  haSnmpApparato,
  jobsDelApparato,
  leggiEsitiJob,
  riassuntiEsitiJobs,
  scriviEsitiGiro,
  statoApparatiPerDevice,
  statoApparatiPerHost,
  withTenant,
} from "@/lib/db-tenant";
import { deleteScheduledJob } from "@/lib/db";
import { resolveDeviceAcquisition } from "@/lib/devices/device-acquisition-resolve";
import { networkDeviceUsesArpPoll } from "@/lib/network-device-arp";
import { vlanSwitchDaLeggere } from "@/lib/cron/jobs";
import { valutaApparato } from "@/lib/apparati-scelti/regole";

const T = "TESTAPPARATISCELTIDB";

after(() => {
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

interface Fixture {
  hostSw: number; hostRt: number; hostPx: number; hostNudo: number; hostNonProvato: number;
  sw: number; rt: number; px: number; nonProvato: number; senzaHost: number; senzaHostNoBinding: number;
}
let F: Fixture;

function crea(d: Database.Database): Fixture {
  const net = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('192.0.2.0/24', 'Prova')").run().lastInsertRowid);
  const host = (ip: string): number => Number(d.prepare("INSERT INTO hosts (network_id, ip, hostname) VALUES (?, ?, ?)").run(net, ip, `h-${ip}`).lastInsertRowid);
  const voce = (tipo: string): number => Number(d.prepare("INSERT INTO credentials (name, credential_type) VALUES (?, ?)").run(`voce ${tipo}`, tipo).lastInsertRowid);
  const snmp = voce("snmp"); const ssh = voce("ssh"); const api = voce("api");
  const dev = (nome: string, ip: string, tipo: string, vendor: string, proto: string, hostId: number | null, usaArp = 0): number =>
    Number(d.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol, host_id, use_for_arp_poll) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(nome, ip, tipo, vendor, proto, hostId, usaArp).lastInsertRowid);
  const hc = (hostId: number, cred: number, proto: string, validated: number): void => {
    d.prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated) VALUES (?, ?, ?, 161, ?)").run(hostId, cred, proto, validated);
  };
  const binding = (devId: number, cred: number, proto: string, status: string): void => {
    d.prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, test_status) VALUES (?, ?, ?, 161, ?)").run(devId, cred, proto, status);
  };

  const hostSw = host("192.0.2.10"); const hostRt = host("192.0.2.1"); const hostPx = host("192.0.2.20");
  const hostNudo = host("192.0.2.50"); const hostNonProvato = host("192.0.2.30");
  const sw = dev("SW-PROVA", "192.0.2.10", "switch", "hp", "snmp_v2", hostSw);
  const rt = dev("MK-PROVA", "192.0.2.1", "router", "mikrotik", "ssh", hostRt, 1);
  const px = dev("PX-PROVA", "192.0.2.20", "hypervisor", "proxmox", "api", hostPx);
  // Collegato solo per IP (host_id NULL): come lo vede Discovery.
  const nonProvato = dev("SW-NONPROVATO", "192.0.2.30", "switch", "hp", "ssh", null);
  const senzaHost = dev("SW-SENZAHOST", "198.51.100.7", "switch", "hp", "ssh", null);
  const senzaHostNoBinding = dev("SW-SENZAHOST-2", "198.51.100.8", "switch", "hp", "ssh", null);
  hc(hostSw, snmp, "snmp", 1);
  hc(hostRt, ssh, "ssh", 1);
  hc(hostPx, api, "api", 1);
  hc(hostNonProvato, ssh, "ssh", 0);
  binding(senzaHost, ssh, "ssh", "success");
  binding(senzaHost, snmp, "snmp", "untested");
  binding(senzaHostNoBinding, ssh, "ssh", "failed");
  binding(nonProvato, snmp, "snmp", "failed");
  return { hostSw, hostRt, hostPx, hostNudo, hostNonProvato, sw, rt, px, nonProvato, senzaHost, senzaHostNoBinding };
}

function job(d: Database.Database, ids: number[], nome = "Apparati scelti"): number {
  return Number(d.prepare("INSERT INTO scheduled_jobs (job_type, interval_minutes, config) VALUES ('apparati_scelti', 240, ?)")
    .run(JSON.stringify({ nome, device_ids: ids, cosa: { info: true, porte_mac: true, vlan: false } })).lastInsertRowid);
}

before(() => {
  F = crea(getTenantDb(T));
});

test("statoApparatiPerHost: tre apparati provati, un host senza apparato, uno non provato", () => withTenant(T, () => {
  const righe = statoApparatiPerHost([F.hostSw, F.hostRt, F.hostPx, F.hostNudo, F.hostNonProvato]);
  const per = new Map(righe.map((r) => [r.host_id, r]));
  assert.equal(righe.length, 5);
  for (const h of [F.hostSw, F.hostRt, F.hostPx]) {
    assert.deepEqual(valutaApparato(per.get(h)!), { incluso: true }, `host ${h}`);
  }
  assert.equal(per.get(F.hostSw)!.device_id, F.sw);
  assert.equal(per.get(F.hostSw)!.nome, "SW-PROVA");
  assert.equal(per.get(F.hostSw)!.ip, "192.0.2.10");
  assert.equal(per.get(F.hostSw)!.tipo.vlan_switch, true);
  assert.equal(per.get(F.hostRt)!.tipo.usa_arp, true);
  assert.deepEqual(valutaApparato(per.get(F.hostNudo)!), { incluso: false, motivo: "NON_APPARATO" });
  assert.equal(per.get(F.hostNudo)!.device_id, null);
  const np = per.get(F.hostNonProvato)!;
  assert.equal(np.device_id, F.nonProvato, "collegato per IP, come Discovery");
  assert.equal(np.validate_sul_host, 0);
  assert.deepEqual(valutaApparato(np), { incluso: false, motivo: "CREDENZIALE_NON_PROVATA" });
}));

test("statoApparatiPerHost: un host inesistente non compare; lista vuota → vuota", () => withTenant(T, () => {
  assert.deepEqual(statoApparatiPerHost([999999]), []);
  assert.deepEqual(statoApparatiPerHost([]), []);
}));

test("statoApparatiPerDevice: stati giusti, id inesistente assente dalla mappa", () => withTenant(T, () => {
  const m = statoApparatiPerDevice([F.sw, F.rt, F.px, F.nonProvato, F.senzaHost, F.senzaHostNoBinding, 999999]);
  assert.equal(m.has(999999), false, "id assente = TOLTO per il giro");
  assert.equal(m.size, 6);
  assert.deepEqual(valutaApparato(m.get(F.sw)!), { incluso: true });
  assert.equal(m.get(F.sw)!.host_id, F.hostSw);
  assert.equal(m.get(F.sw)!.nome, "SW-PROVA");
  assert.deepEqual(valutaApparato(m.get(F.nonProvato)!), { incluso: false, motivo: "CREDENZIALE_NON_PROVATA" });
  assert.equal(m.get(F.nonProvato)!.host_id, F.hostNonProvato, "host trovato per IP");
  const sh = m.get(F.senzaHost)!;
  assert.equal(sh.host_id, null);
  assert.equal(sh.validate_sul_host, null);
  assert.equal(sh.binding_riusciti, 1);
  assert.deepEqual(valutaApparato(sh), { incluso: true }, "senza host: un binding success basta");
  assert.deepEqual(valutaApparato(m.get(F.senzaHostNoBinding)!), { incluso: false, motivo: "CREDENZIALE_NON_PROVATA" });
}));

test("statoApparatiPerDevice: apparato disattivato e senza credenziali", () => withTenant(T, () => {
  const d = getTenantDb(T);
  const spento = Number(d.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol, enabled) VALUES ('SW-SPENTO', '198.51.100.9', 'switch', 'hp', 'ssh', 0)").run().lastInsertRowid);
  const nudo = Number(d.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol) VALUES ('SW-NUDO', '198.51.100.10', 'switch', 'hp', 'ssh')").run().lastInsertRowid);
  const m = statoApparatiPerDevice([spento, nudo]);
  assert.deepEqual(valutaApparato(m.get(spento)!), { incluso: false, motivo: "DISATTIVATO" });
  assert.equal(m.get(nudo)!.credenziali_memorizzate, 0);
  assert.deepEqual(valutaApparato(m.get(nudo)!), { incluso: false, motivo: "SENZA_CREDENZIALE" });
}));

test("tipo e leggibile coincidono con le funzioni che usano «Interroga» e il giro ARP", () => withTenant(T, () => {
  const ids = [F.sw, F.rt, F.px, F.nonProvato, F.senzaHost, F.senzaHostNoBinding];
  const m = statoApparatiPerDevice(ids);
  for (const id of ids) {
    const dev = getNetworkDeviceById(id)!;
    const s = m.get(id)!;
    assert.equal(s.tipo.usa_arp, networkDeviceUsesArpPoll(dev), `usa_arp #${id}`);
    assert.equal(s.tipo.vlan_switch, vlanSwitchDaLeggere(dev), `vlan_switch #${id}`);
    assert.equal(s.leggibile, resolveDeviceAcquisition(dev, haSnmpApparato(dev)).implemented, `leggibile #${id}`);
  }
}));

test("una sola query per 50 apparati (niente N+1)", () => withTenant(T, () => {
  const d = getTenantDb(T);
  const originale = d.prepare.bind(d);
  let n = 0;
  (d as { prepare: unknown }).prepare = ((sql: string) => { n++; return originale(sql); }) as Database.Database["prepare"];
  try {
    const ids = Array.from({ length: 50 }, (_, i) => (i < 6 ? [F.sw, F.rt, F.px, F.nonProvato, F.senzaHost, F.senzaHostNoBinding][i] : 100000 + i));
    statoApparatiPerDevice(ids);
    assert.equal(n, 1, `statoApparatiPerDevice: ${n} prepare`);
    n = 0;
    statoApparatiPerHost(Array.from({ length: 50 }, (_, i) => (i < 5 ? [F.hostSw, F.hostRt, F.hostPx, F.hostNudo, F.hostNonProvato][i] : 100000 + i)));
    assert.equal(n, 1, `statoApparatiPerHost: ${n} prepare`);
  } finally {
    (d as { prepare: unknown }).prepare = originale;
  }
}));

test("scriviEsitiGiro due volte: restano solo le righe del secondo giro", () => withTenant(T, () => {
  const j = job(getTenantDb(T), [F.sw, F.rt, F.px]);
  scriviEsitiGiro(j, "2026-10-22 06:00:00", [
    { device_id: F.sw, stato: "ok", letture: { info: { stato: "letto" } } },
    { device_id: F.rt, stato: "errore", letture: { info: { stato: "errore", codice: "TIMEOUT" } }, motivo: "TEMPO_SCADUTO" },
    { device_id: F.px, stato: "ok", letture: {} },
  ]);
  scriviEsitiGiro(j, "2026-10-22 10:00:00", [
    { device_id: F.sw, stato: "ok", letture: { info: { stato: "letto" }, porte_mac: { stato: "letto" } } },
    { device_id: F.rt, stato: "parziale", letture: { info: { stato: "letto" }, porte_mac: { stato: "errore", codice: "SSH" } } },
  ]);
  const e = leggiEsitiJob(j);
  assert.equal(e.giro_il, "2026-10-22 10:00:00");
  assert.equal(e.righe.length, 2);
  const sw = e.righe.find((r) => r.device_id === F.sw)!;
  assert.equal(sw.nome, "SW-PROVA");
  assert.deepEqual(sw.letture, { info: { stato: "letto" }, porte_mac: { stato: "letto" } });
  assert.equal(sw.motivo, null);
  assert.equal(e.righe.find((r) => r.device_id === F.rt)!.stato, "parziale");
  assert.deepEqual(leggiEsitiJob(987654), { giro_il: null, righe: [] });
}));

test("scriviEsitiGiro: uno stato fuori elenco lancia e non tocca le righe di prima", () => withTenant(T, () => {
  const j = job(getTenantDb(T), [F.sw]);
  scriviEsitiGiro(j, "2026-10-22 06:00:00", [{ device_id: F.sw, stato: "ok", letture: {} }]);
  assert.throws(() => scriviEsitiGiro(j, "2026-10-22 10:00:00", [{ device_id: F.sw, stato: "boh" as "ok", letture: {} }]));
  assert.equal(leggiEsitiJob(j).giro_il, "2026-10-22 06:00:00");
}));

test("riassuntiEsitiJobs: letti, totale, esclusi per job in una query", () => withTenant(T, () => {
  const d = getTenantDb(T);
  const a = job(d, [F.sw, F.rt, F.px]);
  const b = job(d, [F.sw, F.rt, F.px]);
  const vuoto = job(d, [F.sw]);
  scriviEsitiGiro(a, "2026-10-22 10:00:00", [
    { device_id: F.sw, stato: "ok", letture: {} },
    { device_id: F.rt, stato: "ok", letture: {} },
    { device_id: F.px, stato: "ok", letture: {} },
  ]);
  scriviEsitiGiro(b, "2026-10-22 10:00:00", [
    { device_id: F.sw, stato: "ok", letture: {} },
    { device_id: F.rt, stato: "parziale", letture: {} },
    { device_id: F.px, stato: "escluso", letture: {}, motivo: "TOLTO" },
  ]);
  const originale = d.prepare.bind(d);
  let n = 0;
  (d as { prepare: unknown }).prepare = ((sql: string) => { n++; return originale(sql); }) as Database.Database["prepare"];
  let r: ReturnType<typeof riassuntiEsitiJobs>;
  try {
    r = riassuntiEsitiJobs([a, b, vuoto]);
  } finally {
    (d as { prepare: unknown }).prepare = originale;
  }
  assert.equal(n, 1);
  assert.deepEqual(r.get(a), { letti: 3, totale: 3, esclusi: 0, giro_il: "2026-10-22 10:00:00" });
  assert.deepEqual(r.get(b), { letti: 2, totale: 3, esclusi: 1, giro_il: "2026-10-22 10:00:00" });
  assert.equal(r.has(vuoto), false, "mai girato: nessun riassunto");
  assert.equal(riassuntiEsitiJobs([]).size, 0);
}));

test("jobsDelApparato: trova il job con l'id, non quello con 12 cercando 1", () => withTenant(T, () => {
  const d = getTenantDb(T);
  d.prepare("DELETE FROM scheduled_jobs").run();
  const con1 = job(d, [5, 1, 7], "Con uno");
  job(d, [12, 21, 100], "Senza uno");
  d.prepare("INSERT INTO scheduled_jobs (job_type, interval_minutes, config) VALUES ('arp_poll', 60, '{\"device_ids\":[1]}')").run();
  d.prepare("INSERT INTO scheduled_jobs (job_type, interval_minutes, config) VALUES ('apparati_scelti', 60, '{rotto')").run();
  const r = jobsDelApparato(1);
  assert.equal(r.length, 1);
  assert.equal(r[0].id, con1);
  assert.equal(r[0].nome, "Con uno");
  assert.equal(r[0].enabled, true);
  assert.equal(r[0].interval_minutes, 240);
  assert.equal(r[0].last_run, null);
  assert.deepEqual(jobsDelApparato(12).map((x) => x.nome), ["Senza uno"]);
  assert.deepEqual(jobsDelApparato(2), []);
}));

test("deleteScheduledJob (quella della rotta) toglie anche gli esiti; cancellaEsitiJob e orfani", () => withTenant(T, () => {
  const d = getTenantDb(T);
  const j = job(d, [F.sw]);
  const k = job(d, [F.rt]);
  scriviEsitiGiro(j, "2026-10-22 10:00:00", [{ device_id: F.sw, stato: "ok", letture: {} }]);
  scriviEsitiGiro(k, "2026-10-22 10:00:00", [{ device_id: F.rt, stato: "ok", letture: {} }]);
  assert.equal(deleteScheduledJob(j), true);
  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM job_apparati_esiti WHERE job_id = ?").get(j) as { n: number }).n, 0);
  assert.equal(leggiEsitiJob(k).righe.length, 1, "gli esiti degli altri job restano");
  cancellaEsitiJob(k);
  assert.equal(leggiEsitiJob(k).righe.length, 0);
  // Orfano: esiti di un job che non c'è più (cancellato per altre vie). Prima si tolgono quelli lasciati dalle prove
  // di sopra (la prova di jobsDelApparato svuota scheduled_jobs).
  cancellaEsitiOrfani();
  d.prepare("INSERT INTO job_apparati_esiti (job_id, device_id, giro_il, stato) VALUES (424242, ?, '2026-10-22 10:00:00', 'ok')").run(F.sw);
  scriviEsitiGiro(k, "2026-10-22 11:00:00", [{ device_id: F.rt, stato: "ok", letture: {} }]);
  assert.equal(cancellaEsitiOrfani(), 1);
  assert.equal(leggiEsitiJob(424242).righe.length, 0);
  assert.equal(leggiEsitiJob(k).righe.length, 1);
}));
