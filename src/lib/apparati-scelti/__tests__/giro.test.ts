/**
 * Il giro del job `apparati_scelti` (piano 2026-10-22 scansione automatica, Task 5): per ogni apparato del job, in ordine e
 * uno alla volta, l'idoneità si ricontrolla al giro (tolto, credenziale persa → «escluso» col motivo), il lucchetto per
 * apparato è quello del giro ARP e di «Interroga» (occupato → «saltato», non si aspetta), si fanno solo le letture scelte e
 * valide per il tipo, al più 5 minuti per apparato; un esito per apparato in `job_apparati_esiti`. Nessuno letto → il job
 * lancia (fra i falliti, l'allarme lo vede). Log di soli id e codici.
 *
 * Client finti dappertutto: nessun traffico verso un apparato.
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/apparati-scelti/__tests__/giro.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import cron from "node-cron";
import { closeHubDb } from "@/lib/db-hub";
import {
  closeTenantDb,
  deleteTenantDatabase,
  getTenantDb,
  leggiEsitiJob,
  rileggiSchemaCavi,
  rileggiSchemaSwitchVlan,
  withTenant,
} from "@/lib/db-tenant";
import { runJob } from "@/lib/cron/jobs";
import { reloadTenantScheduler, stopTenantJobs } from "@/lib/cron/scheduler";
import { runApparatiScelti, type OpzioniGiro } from "@/lib/apparati-scelti/giro";
import { conLucchettoApparato } from "@/lib/devices/lucchetto-apparato";
import type { EsitoInfo } from "@/lib/devices/lettura-info";
import type { RouterClient } from "@/lib/devices/router-client";
import type { SwitchClient } from "@/lib/devices/switch-client";
import type { LettoreSnmp, VoceSnmp } from "@/lib/devices/snmp-walk";
import { oraUtc, scriviEsito, scriviInterruttore } from "@/lib/topology/letture/interruttori";
import type { NetworkDevice } from "@/types";
import { LETTURE_SPENTE_SQL } from "@/lib/topology/letture/__tests__/letture-spente";

const T = "TESTAPPARATISCELTIGIRO";
const db = () => getTenantDb(T);

after(() => {
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

interface Fx { sw: number; rt: number; px: number; nudo: number; hostSw: number }
let F: Fx;

beforeEach(() => {
  const d = db();
  d.exec(`DELETE FROM job_apparati_esiti; DELETE FROM scheduled_jobs; DELETE FROM mac_port_entries; DELETE FROM switch_ports;
    DELETE FROM arp_entries; DELETE FROM switch_vlan; DELETE FROM switch_vlan_porte; DELETE FROM switch_porta_pvid; DELETE FROM switch_vlan_lettura;
    DELETE FROM host_credentials; DELETE FROM device_credential_bindings; DELETE FROM credentials; DELETE FROM network_devices;
    DELETE FROM hosts; DELETE FROM networks; DELETE FROM tenant_settings WHERE key LIKE 'topologia.lettura.%';
    ${LETTURE_SPENTE_SQL}`);
  const net = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('192.0.2.0/24', 'Prova')").run().lastInsertRowid);
  const host = (ip: string): number => Number(d.prepare("INSERT INTO hosts (network_id, ip, hostname) VALUES (?, ?, ?)").run(net, ip, `h-${ip}`).lastInsertRowid);
  const voce = (tipo: string): number => Number(d.prepare("INSERT INTO credentials (name, credential_type) VALUES (?, ?)").run(`voce ${tipo}`, tipo).lastInsertRowid);
  const dev = (nome: string, ip: string, tipo: string, vendor: string, proto: string, hostId: number | null, usaArp = 0, community: string | null = null): number =>
    Number(d.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol, host_id, use_for_arp_poll, community_string, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)")
      .run(nome, ip, tipo, vendor, proto, hostId, usaArp, community).lastInsertRowid);
  const hc = (hostId: number, cred: number, proto: string): void => {
    d.prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated) VALUES (?, ?, ?, 161, 1)").run(hostId, cred, proto);
  };
  const hostSw = host("192.0.2.10"); const hostRt = host("192.0.2.1"); const hostPx = host("192.0.2.20");
  const sw = dev("SW-SEGRETO", "192.0.2.10", "switch", "hp", "snmp_v2", hostSw, 0, "public");
  const rt = dev("MK-SEGRETO", "192.0.2.1", "router", "mikrotik", "ssh", hostRt, 1);
  const px = dev("PX-SEGRETO", "192.0.2.20", "hypervisor", "proxmox", "api", hostPx);
  const nudo = dev("SW-NUDO", "198.51.100.9", "switch", "hp", "ssh", null); // nessuna credenziale: escluso
  hc(hostSw, voce("snmp"), "snmp");
  hc(hostRt, voce("ssh"), "ssh");
  hc(hostPx, voce("api"), "api");
  withTenant(T, () => { rileggiSchemaCavi(); rileggiSchemaSwitchVlan(); });
  F = { sw, rt, px, nudo, hostSw };
});

function creaJob(ids: number[], cosa = { info: true, porte_mac: true, vlan: true }, extra: Record<string, unknown> = {}, intervallo = 240): number {
  return Number(db().prepare("INSERT INTO scheduled_jobs (job_type, interval_minutes, config, enabled) VALUES ('apparati_scelti', ?, ?, 1)")
    .run(intervallo, JSON.stringify({ nome: "Apparati scelti", device_ids: ids, cosa, ...extra })).lastInsertRowid);
}

/** Letture finte che registrano chi chiamano: `info`, client del router e dello switch, walk SNMP. */
function finti(info: (d: NetworkDevice) => Promise<EsitoInfo> = async () => ({ stato: "letto", campi: 3 })) {
  const chiamate: string[] = [];
  const opz: OpzioniGiro = {
    leggiInfo: async (d) => { chiamate.push(`${d.id}:info`); return info(d); },
    creaClientRouter: async (d): Promise<RouterClient> => {
      chiamate.push(`${d.id}:router`);
      return { async getArpTable() { return []; }, async testConnection() { return true; } };
    },
    creaClientSwitch: async (d): Promise<SwitchClient> => {
      chiamate.push(`${d.id}:switch`);
      return { async getMacTable() { return []; }, async getPortSchema() { return []; }, async testConnection() { return true; } };
    },
    creaWalkSnmp: async (d): Promise<LettoreSnmp> => {
      chiamate.push(`${d.id}:walk`);
      const walk = async (): Promise<VoceSnmp[]> => [];
      return Object.assign(walk, { get: async (): Promise<VoceSnmp[]> => [] });
    },
    apriEsecutore: async (d) => { chiamate.push(`${d.id}:ssh`); throw Object.assign(new Error("finto"), { code: "FINTO" }); },
  };
  return { opz, chiamate, di: (id: number) => chiamate.filter((c) => c.startsWith(`${id}:`)) };
}

const esiti = (job: number) => withTenant(T, () => leggiEsitiJob(job)).righe.map((r) => ({ id: r.device_id, stato: r.stato, letture: r.letture, motivo: r.motivo }));
const riga = (job: number, id: number) => esiti(job).find((r) => r.id === id);

test("3 inclusi + 1 escluso: tre righe ok, una esclusa; l'hypervisor ha solo info; VLAN spenta = «spenta»; motivo in numeri", async () => {
  const j = creaJob([F.sw, F.rt, F.px, F.nudo]);
  const f = finti();
  const e = await withTenant(T, () => runJob(j, { apparatiScelti: f.opz }));
  assert.deepEqual(e, { esito: "eseguito", motivo: "3 letti su 3; 1 escluso" });
  assert.deepEqual(riga(j, F.sw), { id: F.sw, stato: "ok", motivo: null,
    letture: { info: { stato: "letto" }, porte_mac: { stato: "letto" }, vlan: { stato: "spenta" } } });
  assert.deepEqual(riga(j, F.rt)?.letture, { info: { stato: "letto" }, porte_mac: { stato: "letto" }, vlan: { stato: "spenta" } });
  assert.equal(riga(j, F.rt)?.stato, "ok");
  assert.deepEqual(riga(j, F.px), { id: F.px, stato: "ok", motivo: null,
    letture: { info: { stato: "letto" }, porte_mac: { stato: "non_valida" }, vlan: { stato: "non_valida" } } });
  assert.deepEqual(riga(j, F.nudo), { id: F.nudo, stato: "escluso", motivo: "SENZA_CREDENZIALE", letture: {} });
  assert.deepEqual(f.di(F.nudo), [], "escluso: nessuna chiamata");
  assert.deepEqual(f.di(F.sw), [`${F.sw}:info`, `${F.sw}:switch`], "VLAN spenta: nessuna walk");
  assert.deepEqual(f.di(F.px), [`${F.px}:info`]);
});

test("apparato tolto dopo la creazione: escluso TOLTO, gli altri letti", async () => {
  const j = creaJob([F.sw, F.rt]);
  db().prepare("DELETE FROM network_devices WHERE id = ?").run(F.rt);
  const f = finti();
  const r = await withTenant(T, () => runApparatiScelti(j, f.opz));
  assert.equal(riga(j, F.rt)?.stato, "escluso");
  assert.equal(riga(j, F.rt)?.motivo, "TOLTO");
  assert.equal(riga(j, F.sw)?.stato, "ok");
  assert.deepEqual({ letti: r.letti, totale: r.totale, esclusi: r.esclusi }, { letti: 1, totale: 2, esclusi: 1 });
});

test("credenziale non più valida dopo la creazione: escluso CREDENZIALE_NON_PROVATA, nessuna chiamata", async () => {
  const j = creaJob([F.sw, F.rt]);
  db().prepare("UPDATE host_credentials SET validated = 0 WHERE host_id = ?").run(F.hostSw);
  const f = finti();
  await withTenant(T, () => runApparatiScelti(j, f.opz));
  assert.deepEqual(riga(j, F.sw), { id: F.sw, stato: "escluso", motivo: "CREDENZIALE_NON_PROVATA", letture: {} });
  assert.deepEqual(f.di(F.sw), []);
  assert.equal(riga(j, F.rt)?.stato, "ok");
});

test("apparato già in lettura (lucchetto preso): saltato OCCUPATO, nessuna chiamata, non si aspetta", async () => {
  const j = creaJob([F.sw, F.rt]);
  const f = finti();
  let libera!: () => void;
  const tenuto = new Promise<void>((r) => { libera = r; });
  const presa = withTenant(T, () => conLucchettoApparato(F.sw, () => tenuto));
  await withTenant(T, () => runApparatiScelti(j, f.opz));
  libera();
  await presa;
  assert.deepEqual(riga(j, F.sw), { id: F.sw, stato: "saltato", motivo: "OCCUPATO", letture: {} });
  assert.deepEqual(f.di(F.sw), []);
  assert.equal(riga(j, F.rt)?.stato, "ok");
});

test("lettura che non torna mai: errore TEMPO_SCADUTO dopo il tempo massimo, si passa al prossimo", async () => {
  const j = creaJob([F.sw, F.rt]);
  const f = finti((d) => (d.id === F.sw ? new Promise<EsitoInfo>(() => {}) : Promise.resolve({ stato: "letto", campi: 1 })));
  const t0 = Date.now();
  await withTenant(T, () => runApparatiScelti(j, { ...f.opz, tempoApparatoMs: 50 }));
  assert.ok(Date.now() - t0 < 5000);
  const s = riga(j, F.sw);
  assert.equal(s?.stato, "errore");
  assert.equal(s?.motivo, "TEMPO_SCADUTO");
  assert.deepEqual(s?.letture.info, { stato: "errore", codice: "TEMPO_SCADUTO" });
  assert.equal(riga(j, F.rt)?.stato, "ok");
});

test("una lettura che lancia: errore col codice sulla lettura, le altre fatte, riga «parziale»", async () => {
  const j = creaJob([F.sw]);
  const f = finti(async () => { throw Object.assign(new Error("192.0.2.10 SW-SEGRETO rifiuta"), { code: "SNMP_STATO_5" }); });
  const logs = cattura();
  try {
    const e = await withTenant(T, () => runJob(j, { apparatiScelti: f.opz }));
    assert.equal(e.esito, "eseguito");
  } finally { logs.ripristina(); }
  const s = riga(j, F.sw);
  assert.equal(s?.stato, "parziale");
  assert.deepEqual(s?.letture.info, { stato: "errore", codice: "SNMP_STATO_5" });
  assert.deepEqual(s?.letture.porte_mac, { stato: "letto" });
  assert.doesNotMatch(logs.testo(), /SEGRETO|192\.0\.2/);
});

test("VLAN con switch_vlan acceso e lettura di 10 minuti fa: si legge lo stesso (cadenza ignorata)", async () => {
  withTenant(T, () => {
    scriviInterruttore("switch_vlan", true, "admin");
    scriviEsito("switch_vlan", F.sw, { il: oraUtc(new Date(Date.now() - 10 * 60_000)), comandi: 7, riusciti: 7, codice: null });
  });
  const j = creaJob([F.sw], { info: false, porte_mac: false, vlan: true });
  const f = finti();
  await withTenant(T, () => runApparatiScelti(j, f.opz));
  assert.ok(f.di(F.sw).includes(`${F.sw}:walk`), "la walk parte nonostante la cadenza");
  // Le walk finte rispondono vuote: per `leggiVlanSwitch` è una lettura riuscita (nessuna VLAN).
  assert.deepEqual(riga(j, F.sw)?.letture, { vlan: { stato: "letto" } });
  assert.equal(riga(j, F.sw)?.stato, "ok");
});

test("tutti in errore o esclusi: runJob lancia «Nessun apparato letto», gli esiti sono scritti", async () => {
  const j = creaJob([F.sw, F.nudo], { info: true, porte_mac: false, vlan: false });
  const f = finti(async () => ({ stato: "errore", codice: "SSH_TIMEOUT" }));
  await assert.rejects(withTenant(T, () => runJob(j, { apparatiScelti: f.opz })), /Nessun apparato letto: 0 letti su 1; 1 escluso/);
  assert.deepEqual(esiti(j).map((r) => [r.id, r.stato]).sort(), [[F.sw, "errore"], [F.nudo, "escluso"]].sort());
});

test("solo VLAN scelta e switch_vlan spento: niente da leggere, il job è «saltato», non fallisce", async () => {
  const j = creaJob([F.sw], { info: false, porte_mac: false, vlan: true });
  const e = await withTenant(T, () => runJob(j, { apparatiScelti: finti().opz }));
  assert.equal(e.esito, "saltato");
  assert.match(e.motivo ?? "", /^niente da leggere/);
  assert.deepEqual(riga(j, F.sw), { id: F.sw, stato: "saltato", motivo: "NIENTE_DA_LEGGERE", letture: { vlan: { stato: "spenta" } } });
});

test("tutti gli apparati occupati: il job è «saltato» (tutti occupati), non fallisce", async () => {
  const j = creaJob([F.sw, F.rt]);
  let libera!: () => void;
  const tenuto = new Promise<void>((r) => { libera = r; });
  const prese = [F.sw, F.rt].map((id) => withTenant(T, () => conLucchettoApparato(id, () => tenuto)));
  const e = await withTenant(T, () => runJob(j, { apparatiScelti: finti().opz }));
  libera();
  await Promise.all(prese);
  assert.equal(e.esito, "saltato");
  assert.match(e.motivo ?? "", /tutti occupati/);
});

test("host senza credenziale validata ma con un binding SNMP riuscito: incluso e letto", async () => {
  db().prepare("UPDATE host_credentials SET validated = 0 WHERE host_id = ?").run(F.hostSw);
  const voce = Number(db().prepare("INSERT INTO credentials (name, credential_type) VALUES ('c', 'snmp')").run().lastInsertRowid);
  db().prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, test_status) VALUES (?, ?, 'snmp', 161, 'success')").run(F.sw, voce);
  const j = creaJob([F.sw], { info: true, porte_mac: false, vlan: false });
  await withTenant(T, () => runApparatiScelti(j, finti().opz));
  assert.equal(riga(j, F.sw)?.stato, "ok");
});

test("router: porte fisiche non lette (bridge host in errore) = porte e MAC in errore col codice, non «letto»", async () => {
  const j = creaJob([F.rt], { info: false, porte_mac: true, vlan: false });
  const f = finti();
  f.opz.creaClientRouter = async (): Promise<RouterClient> => ({
    async getArpTable() { return []; }, async testConnection() { return true; },
    async getBridgeHosts() { throw Object.assign(new Error("finto"), { code: "SSH_TIMEOUT_FINTO" }); },
    async getInterfaceTypes() { return []; },
  } as unknown as RouterClient);
  await withTenant(T, () => runApparatiScelti(j, f.opz));
  assert.deepEqual(riga(j, F.rt)?.letture, { porte_mac: { stato: "errore", codice: "SSH_TIMEOUT_FINTO" } });
  assert.equal(riga(j, F.rt)?.stato, "errore");
});

test("porte e MAC non scelte: il client dello switch non si crea", async () => {
  const j = creaJob([F.sw], { info: true, porte_mac: false, vlan: false });
  const f = finti();
  await withTenant(T, () => runApparatiScelti(j, f.opz));
  assert.deepEqual(f.di(F.sw), [`${F.sw}:info`]);
  assert.deepEqual(riga(j, F.sw)?.letture, { info: { stato: "letto" } });
});

test("config illeggibile: lancia «Config del job non valida», nessun esito", async () => {
  const j = Number(db().prepare("INSERT INTO scheduled_jobs (job_type, interval_minutes, config) VALUES ('apparati_scelti', 60, '{}')").run().lastInsertRowid);
  await assert.rejects(withTenant(T, () => runApparatiScelti(j, finti().opz)), /Config del job non valida/);
  assert.deepEqual(esiti(j), []);
});

test("esiti orfani tolti all'inizio del giro", async () => {
  db().prepare("INSERT INTO job_apparati_esiti (job_id, device_id, giro_il, stato, letture) VALUES (999999, 1, '2026-10-22 06:00:00', 'ok', '{}')").run();
  const j = creaJob([F.sw]);
  await withTenant(T, () => runApparatiScelti(j, finti().opz));
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM job_apparati_esiti WHERE job_id = 999999").get() as { n: number }).n, 0);
});

function cattura() {
  const righe: string[] = [];
  const spie = (["info", "warn", "error", "log"] as const).map((m) =>
    mock.method(console, m, (...a: unknown[]) => { righe.push(a.map((x) => (x instanceof Error ? `${x.message}` : String(x))).join(" ")); }));
  return { testo: () => righe.join("\n"), righe, ripristina: () => spie.forEach((s) => s.mock.restore()) };
}

test("log: solo id e codici (niente nomi né IP); riga di riepilogo in numeri", async () => {
  const j = creaJob([F.sw, F.rt, F.px, F.nudo]);
  const f = finti(async (d) => (d.id === F.rt ? { stato: "errore", codice: "SSH_AUTH" } : { stato: "letto", campi: 2 }));
  const logs = cattura();
  try {
    await withTenant(T, () => runJob(j, { apparatiScelti: f.opz }));
  } finally { logs.ripristina(); }
  const testo = logs.testo();
  assert.doesNotMatch(testo, /SEGRETO|NUDO|192\.0\.2|198\.51\.100/);
  assert.match(testo, new RegExp(`\\[Scheduler\\] apparati_scelti #${j}: 3 letti su 3, 1 esclusi; info 2/3, porte 2/2, vlan 0/0`));
});

test("scheduleJob di un giornaliero alle 02:00: cron «0 2 * * *» in ora italiana", () => {
  creaJob([F.sw], { info: true, porte_mac: false, vlan: false }, { ora: "02:00" }, 1440);
  const registrati: Array<{ expr: string; opz: unknown }> = [];
  const spia = mock.method(cron, "schedule", (expr: string, _fn: unknown, opz?: unknown) => {
    registrati.push({ expr, opz });
    return { stop() { /* finto */ } } as unknown as ReturnType<typeof cron.schedule>;
  });
  try {
    reloadTenantScheduler(T);
  } finally {
    stopTenantJobs(T);
    spia.mock.restore();
  }
  assert.deepEqual(registrati, [{ expr: "0 2 * * *", opz: { timezone: "Europe/Rome" } }]);
});
