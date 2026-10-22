/**
 * Rotte del job `apparati_scelti` (piano 2026-10-22 scansione automatica, Task 6): anteprima dell'idoneità, creazione,
 * lettura e modifica per la finestra J2, esiti (J3), testata della scheda (J4), il 409 della PUT generica di
 * `/api/jobs`. I corpi stanno in `src/lib/apparati-scelti/rotte-server.ts` e si provano qui senza sessione
 * (`mock.module` non gira sotto Node 22 con tsx); la guardia admin/auth la provano `api-auth-guards` e `rotte-censite`
 * sul sorgente e `scripts/verifica-permessi.sh` dal di fuori. Dati con la forma vera (indirizzi di documentazione).
 *
 * Run: node --import tsx --test src/app/api/jobs/apparati-scelti/__tests__/route.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { closeHubDb } from "@/lib/db-hub";
import {
  closeTenantDb,
  deleteTenantDatabase,
  getScheduledJobById,
  getTenantDb,
  scriviEsitiGiro,
  withTenant,
} from "@/lib/db-tenant";
import { deleteScheduledJob } from "@/lib/db";
import {
  arricchisciJobs,
  rifiutoPutGenerico,
  rispostaAnteprima,
  rispostaCrea,
  rispostaEsiti,
  rispostaLeggiJob,
  rispostaModifica,
  rispostaScansioneApparato,
} from "@/lib/apparati-scelti/rotte-server";

const T = "TESTAPPARATISCELTIROTTE";

after(() => {
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

interface Fixture { hostSw: number; hostRt: number; hostNudo: number; hostSenzaCred: number; hostNonProvato: number; sw: number; rt: number; senzaCred: number; fast: number }
let F: Fixture;

function crea(d: Database.Database): Fixture {
  const net = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('192.0.2.0/24', 'Prova')").run().lastInsertRowid);
  const host = (ip: string): number => Number(d.prepare("INSERT INTO hosts (network_id, ip, hostname) VALUES (?, ?, ?)").run(net, ip, `h-${ip}`).lastInsertRowid);
  const voce = (tipo: string): number => Number(d.prepare("INSERT INTO credentials (name, credential_type) VALUES (?, ?)").run(`voce ${tipo}`, tipo).lastInsertRowid);
  const snmp = voce("snmp"); const ssh = voce("ssh");
  const dev = (nome: string, ip: string, tipo: string, vendor: string, proto: string, hostId: number | null, usaArp = 0): number =>
    Number(d.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol, host_id, use_for_arp_poll) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(nome, ip, tipo, vendor, proto, hostId, usaArp).lastInsertRowid);
  const hc = (hostId: number, cred: number, proto: string, validated: number): void => {
    d.prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated) VALUES (?, ?, ?, 161, ?)").run(hostId, cred, proto, validated);
  };
  const hostSw = host("192.0.2.10"); const hostRt = host("192.0.2.1"); const hostNudo = host("192.0.2.50");
  const hostSenzaCred = host("192.0.2.40"); const hostNonProvato = host("192.0.2.30");
  const sw = dev("SW-PROVA", "192.0.2.10", "switch", "hp", "snmp_v2", hostSw);
  const rt = dev("MK-PROVA", "192.0.2.1", "router", "mikrotik", "ssh", hostRt, 1);
  const senzaCred = dev("SW-SENZACRED", "192.0.2.40", "switch", "hp", "snmp_v2", hostSenzaCred);
  dev("SW-NONPROVATO", "192.0.2.30", "switch", "hp", "ssh", hostNonProvato);
  hc(hostSw, snmp, "snmp", 1);
  hc(hostRt, ssh, "ssh", 1);
  hc(hostNonProvato, ssh, "ssh", 0);
  const fast = Number(d.prepare("INSERT INTO scheduled_jobs (job_type, interval_minutes, config) VALUES ('fast_scan', 60, '{}')").run().lastInsertRowid);
  return { hostSw, hostRt, hostNudo, hostSenzaCred, hostNonProvato, sw, rt, senzaCred, fast };
}

before(() => {
  F = crea(getTenantDb(T));
});

const corpoCrea = (hostIds: number[], extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  nome: "Apparati scelti", host_ids: hostIds, frequenza: { tipo: "4ore" }, cosa: { info: true, porte_mac: true, vlan: true }, ...extra,
});

/** Un job creato dalla rotta con i due apparati provati; rende l'id. */
function creaJob(extra: Record<string, unknown> = {}): number {
  const r = rispostaCrea(corpoCrea([F.hostSw, F.hostRt], extra));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return (r.body as { id: number }).id;
}

type RigaAnteprima = { host_id: number; device_id: number | null; incluso: boolean; motivo?: string; testo_motivo?: string; link?: { testo: string; href?: string; azione?: string }; credenziale: string; letture_valide: string[] };

test("anteprima: 2 inclusi su 4, esclusi col motivo e il link che lo risolve, interruttori", () => withTenant(T, () => {
  const r = rispostaAnteprima({ host_ids: [F.hostSw, F.hostRt, F.hostNudo, F.hostSenzaCred] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const b = r.body as { righe: RigaAnteprima[]; inclusi: number; esclusi: number; interruttori: { switch_vlan: boolean; mikrotik_scheda: boolean } };
  const per = new Map(b.righe.map((x) => [x.host_id, x]));
  assert.equal(b.righe.length, 4);
  assert.equal(b.inclusi, 2);
  assert.equal(b.esclusi, 2);
  assert.deepEqual(b.interruttori, { switch_vlan: false, mikrotik_scheda: false }, "spenti senza impostazione");
  const sw = per.get(F.hostSw)!;
  assert.equal(sw.incluso, true);
  assert.equal(sw.credenziale, "provata");
  assert.deepEqual(sw.letture_valide, ["info", "porte_mac", "vlan"]);
  assert.equal(per.get(F.hostRt)!.incluso, true);
  const nudo = per.get(F.hostNudo)!;
  assert.equal(nudo.incluso, false);
  assert.equal(nudo.motivo, "NON_APPARATO");
  assert.equal(nudo.testo_motivo, "non è un apparato");
  assert.deepEqual(nudo.link, { testo: "Rendi apparato ›", azione: "rendi_apparato" });
  assert.deepEqual(nudo.letture_valide, []);
  const sc = per.get(F.hostSenzaCred)!;
  assert.equal(sc.motivo, "SENZA_CREDENZIALE");
  assert.equal(sc.credenziale, "nessuna");
  assert.deepEqual(sc.link, { testo: "Assegna credenziale ›", href: `/objects/${F.hostSenzaCred}` });
}));

test("anteprima: credenziale non provata → «Prova credenziali ›»; host che non c'è → escluso TOLTO", () => withTenant(T, () => {
  const r = rispostaAnteprima({ host_ids: [F.hostNonProvato, 999999] });
  assert.equal(r.status, 200);
  const righe = (r.body as { righe: RigaAnteprima[] }).righe;
  const np = righe.find((x) => x.host_id === F.hostNonProvato)!;
  assert.equal(np.motivo, "CREDENZIALE_NON_PROVATA");
  assert.equal(np.credenziale, "non_provata");
  assert.deepEqual(np.link, { testo: "Prova credenziali ›", href: `/objects/${F.hostNonProvato}` });
  const tolto = righe.find((x) => x.host_id === 999999)!;
  assert.equal(tolto.incluso, false);
  assert.equal(tolto.motivo, "TOLTO");
}));

test("anteprima: più di 50 host → 400; corpo senza elenco → 400", () => withTenant(T, () => {
  const tanti = Array.from({ length: 51 }, (_, i) => i + 1);
  const r = rispostaAnteprima({ host_ids: tanti });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: "Al più 50 apparati per job" });
  assert.equal(rispostaAnteprima(null).status, 400);
  assert.equal(rispostaAnteprima({ host_ids: [] }).status, 400);
}));

test("crea: 2 inclusi su 4, esclusi coi motivi, job ogni 4 ore con solo gli inclusi", () => withTenant(T, () => {
  const r = rispostaCrea(corpoCrea([F.hostSw, F.hostRt, F.hostNudo, F.hostSenzaCred]));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const b = r.body as { id: number; inclusi: number; esclusi: Array<{ host_id: number; motivo: string }> };
  assert.equal(b.inclusi, 2);
  assert.deepEqual(b.esclusi, [
    { host_id: F.hostNudo, motivo: "NON_APPARATO" },
    { host_id: F.hostSenzaCred, motivo: "SENZA_CREDENZIALE" },
  ]);
  const job = getScheduledJobById(b.id)!;
  assert.equal(job.job_type, "apparati_scelti");
  assert.equal(job.interval_minutes, 240);
  assert.deepEqual(JSON.parse(job.config as unknown as string), {
    nome: "Apparati scelti", device_ids: [F.sw, F.rt], cosa: { info: true, porte_mac: true, vlan: true },
  });
}));

test("crea: due host dello stesso apparato danno un id solo", () => withTenant(T, () => {
  const d = getTenantDb(T);
  // Lo stesso IP in un'altra rete: per Discovery è lo stesso apparato (collegato per IP).
  const rete2 = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('192.0.2.0/25', 'Prova 2')").run().lastInsertRowid);
  const altroIp = Number(d.prepare("INSERT INTO hosts (network_id, ip, hostname) VALUES (?, '192.0.2.10', 'stesso-ip')").run(rete2).lastInsertRowid);
  const r = rispostaCrea(corpoCrea([F.hostSw, altroIp]));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const job = getScheduledJobById((r.body as { id: number }).id)!;
  assert.deepEqual(JSON.parse(job.config as unknown as string).device_ids, [F.sw]);
}));

test("crea: 0 inclusi → 400; 51 host → 400; giornaliero con l'ora → 1440 e config.ora", () => withTenant(T, () => {
  const zero = rispostaCrea(corpoCrea([F.hostNudo, F.hostSenzaCred]));
  assert.equal(zero.status, 400);
  assert.deepEqual(zero.body, { error: "Nessun apparato con credenziale provata" });
  const tanti = rispostaCrea(corpoCrea(Array.from({ length: 51 }, (_, i) => i + 1)));
  assert.equal(tanti.status, 400);
  assert.deepEqual(tanti.body, { error: "Al più 50 apparati per job" });
  assert.equal(rispostaCrea(corpoCrea([F.hostSw], { frequenza: { tipo: "giorno" } })).status, 400, "giornaliero senza ora");
  assert.equal(rispostaCrea(corpoCrea([F.hostSw], { frequenza: { tipo: "giorno", ora: "25:00" } })).status, 400);
  assert.equal(rispostaCrea(corpoCrea([F.hostSw], { cosa: { info: false, porte_mac: false, vlan: false } })).status, 400);
  assert.equal(rispostaCrea(corpoCrea([F.hostSw, F.hostSw])).status, 400, "host ripetuti");
  const g = rispostaCrea(corpoCrea([F.hostSw], { frequenza: { tipo: "giorno", ora: "02:00" } }));
  assert.equal(g.status, 201);
  const job = getScheduledJobById((g.body as { id: number }).id)!;
  assert.equal(job.interval_minutes, 1440);
  assert.equal(JSON.parse(job.config as unknown as string).ora, "02:00");
}));

test("leggi per la modifica: config, frequenza e stato degli apparati; 404 su un job d'altro tipo o assente", () => withTenant(T, () => {
  const id = creaJob();
  const r = rispostaLeggiJob(String(id));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const b = r.body as { nome: string; frequenza: unknown; cosa: unknown; apparati: Array<{ device_id: number; incluso: boolean; credenziale: string }> };
  assert.equal(b.nome, "Apparati scelti");
  assert.deepEqual(b.frequenza, { tipo: "4ore" });
  assert.deepEqual(b.apparati.map((a) => [a.device_id, a.incluso, a.credenziale]), [[F.sw, true, "provata"], [F.rt, true, "provata"]]);
  assert.equal(rispostaLeggiJob(String(F.fast)).status, 404);
  assert.equal(rispostaLeggiJob("999999").status, 404);
  assert.equal(rispostaLeggiJob("abc").status, 400);
}));

test("modifica: aggiungere un apparato → 400; togliere → config nuova ed esiti del tolto spariti; frequenza giornaliera", () => withTenant(T, () => {
  const id = creaJob();
  const agg = rispostaModifica(String(id), { device_ids: [F.sw, F.rt, F.senzaCred] });
  assert.equal(agg.status, 400);
  assert.deepEqual(agg.body, { error: "Gli apparati si aggiungono da Discovery" });

  scriviEsitiGiro(id, "2026-10-22 08:00:00", [
    { device_id: F.sw, stato: "ok", letture: { info: { stato: "letto" } } },
    { device_id: F.rt, stato: "ok", letture: { info: { stato: "letto" } } },
  ]);
  const r = rispostaModifica(String(id), { device_ids: [F.sw], frequenza: { tipo: "giorno", ora: "03:30" }, nome: "Switch del CED" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const job = getScheduledJobById(id)!;
  assert.equal(job.interval_minutes, 1440);
  const cfg = JSON.parse(job.config as unknown as string);
  assert.deepEqual(cfg, { nome: "Switch del CED", device_ids: [F.sw], cosa: { info: true, porte_mac: true, vlan: true }, ora: "03:30" });
  const esiti = (rispostaEsiti(String(id)).body as { righe: Array<{ device_id: number }> }).righe;
  assert.deepEqual(esiti.map((e) => e.device_id), [F.sw]);

  // Tornando a «ogni ora» l'ora sparisce dalla config (ora solo col giornaliero).
  assert.equal(rispostaModifica(String(id), { frequenza: { tipo: "ora" } }).status, 200);
  const dopo = getScheduledJobById(id)!;
  assert.equal(dopo.interval_minutes, 60);
  assert.equal(JSON.parse(dopo.config as unknown as string).ora, undefined);

  assert.equal(rispostaModifica(String(id), { device_ids: [] }).status, 400);
  assert.equal(rispostaModifica(String(id), { campo_strano: 1 }).status, 400);
  assert.equal(rispostaModifica(String(F.fast), { nome: "x" }).status, 404);
}));

test("esiti: righe dell'ultimo giro; 404 su un job d'altro tipo", () => withTenant(T, () => {
  const id = creaJob();
  scriviEsitiGiro(id, "2026-10-22 08:00:00", [{ device_id: F.sw, stato: "parziale", letture: { info: { stato: "letto" }, vlan: { stato: "errore", codice: "TIMEOUT" } } }]);
  const r = rispostaEsiti(String(id));
  assert.equal(r.status, 200);
  const b = r.body as { giro_il: string; righe: Array<{ device_id: number; stato: string; nome: string }> };
  assert.equal(b.giro_il, "2026-10-22 08:00:00");
  assert.deepEqual(b.righe.map((x) => [x.device_id, x.stato, x.nome]), [[F.sw, "parziale", "SW-PROVA"]]);
  assert.equal(rispostaEsiti(String(F.fast)).status, 404);
}));

test("PUT generica di /api/jobs: interval_minutes su apparati_scelti → 409, enabled sì; fast_scan come prima", () => withTenant(T, () => {
  const id = creaJob();
  const r = rifiutoPutGenerico(id, { id, interval_minutes: 30 });
  assert.equal(r?.status, 409);
  assert.match((r!.body as { error: string }).error, /Modifica/);
  assert.equal(rifiutoPutGenerico(id, { id, enabled: false }), null);
  assert.equal(rifiutoPutGenerico(F.fast, { id: F.fast, interval_minutes: 30 }), null);
  assert.equal(rifiutoPutGenerico(999999, { id: 999999, interval_minutes: 30 }), null);
}));

test("la PUT generica di /api/jobs chiama la guardia prima di scrivere", () => {
  const src = readFileSync(join(process.cwd(), "src/app/api/jobs/route.ts"), "utf8");
  const put = src.slice(src.indexOf("export async function PUT"), src.indexOf("export async function DELETE"));
  assert.ok(put.indexOf("rifiutoPutGenerico(") > 0, "guardia mancante");
  assert.ok(put.indexOf("rifiutoPutGenerico(") < put.indexOf("toggleJob("), "la guardia viene prima delle scritture");
});

test("DELETE: togliendo il job spariscono anche i suoi esiti", () => withTenant(T, () => {
  const id = creaJob();
  scriviEsitiGiro(id, "2026-10-22 08:00:00", [{ device_id: F.sw, stato: "ok", letture: {} }]);
  assert.equal(deleteScheduledJob(id), true);
  const n = getTenantDb(T).prepare("SELECT COUNT(*) AS n FROM job_apparati_esiti WHERE job_id = ?").get(id) as { n: number };
  assert.equal(n.n, 0);
}));

test("testata J4: i job dell'apparato con frequenza, prossima ed esito; nessun IP nella risposta", () => withTenant(T, () => {
  const id = creaJob({ nome: "Testata" });
  scriviEsitiGiro(id, "2026-10-22 08:00:00", [
    { device_id: F.sw, stato: "ok", letture: {} },
    { device_id: F.rt, stato: "errore", letture: {} },
  ]);
  getTenantDb(T).prepare("UPDATE scheduled_jobs SET last_run = '2026-10-22 08:00:00' WHERE id = ?").run(id);
  const r = rispostaScansioneApparato(String(F.sw), new Date("2026-10-22T08:30:00Z"));
  assert.equal(r.status, 200);
  const b = r.body as { jobs: Array<Record<string, unknown>> };
  const mio = b.jobs.find((j) => j.id === id)!;
  assert.deepEqual(Object.keys(mio).sort(), ["attivo", "esito", "frequenza", "id", "nome", "prossima", "ultima"]);
  assert.equal(mio.nome, "Testata");
  assert.equal(mio.frequenza, "ogni 4 ore");
  assert.equal(mio.attivo, true);
  assert.equal(mio.ultima, "2026-10-22T08:00:00.000Z");
  assert.equal(mio.prossima, "2026-10-22T10:00:00.000Z", "le 12:00 italiane");
  assert.deepEqual(mio.esito, { stato: "ok", giro_il: "2026-10-22 08:00:00" });
  const testo = JSON.stringify(r.body);
  assert.ok(!/192\.0\.2\.|198\.51\.100\./.test(testo), "nessun IP");
  assert.ok(!testo.includes("MK-PROVA"), "niente nomi d'altri apparati");

  // Sospeso: niente prossima.
  getTenantDb(T).prepare("UPDATE scheduled_jobs SET enabled = 0 WHERE id = ?").run(id);
  const sospeso = (rispostaScansioneApparato(String(F.sw)).body as { jobs: Array<Record<string, unknown>> }).jobs.find((j) => j.id === id)!;
  assert.equal(sospeso.attivo, false);
  assert.equal(sospeso.prossima, null);
  assert.equal(rispostaScansioneApparato("0").status, 400);
}));

test("elenco dei job: riassunto, nome, frequenza e prossima solo sulle righe apparati_scelti", () => withTenant(T, () => {
  const id = creaJob({ nome: "Elenco" });
  scriviEsitiGiro(id, "2026-10-22 08:00:00", [
    { device_id: F.sw, stato: "ok", letture: {} },
    { device_id: F.rt, stato: "escluso", letture: {}, motivo: "CREDENZIALE_NON_PROVATA" },
  ]);
  const jobs = [getScheduledJobById(F.fast)!, getScheduledJobById(id)!];
  const out = arricchisciJobs(jobs, new Date("2026-10-22T08:30:00Z")) as Array<Record<string, unknown>>;
  assert.equal(out[0].riassunto, undefined, "le altre righe restano come sono");
  assert.deepEqual(Object.keys(out[0]).sort(), Object.keys(jobs[0]).sort());
  assert.equal(out[1].nome, "Elenco");
  assert.equal(out[1].apparati, 2);
  assert.equal(out[1].frequenza, "ogni 4 ore");
  assert.equal(out[1].prossima, "2026-10-22T10:00:00.000Z");
  assert.deepEqual(out[1].riassunto, { letti: 1, totale: 2, esclusi: 1, giro_il: "2026-10-22 08:00:00" });
}));
