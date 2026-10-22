// LibreNMS come fonte di dati: scrittura e giro (piano 2026-10-22 LibreNMS, task 4) e letture per le rotte (task 5), con
// un'API finta che restituisce le uscite vere anonimizzate (`fixtures/librenms/`). Regole: spento = zero chiamate; «non so»
// non cancella; 200 vuoto = fotografia vuota; una parte in errore non ferma le altre; cadenza di 15 minuti; nell'esito
// nessun IP né nome.
//
// Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/integrations/__tests__/librenms-fonte.test.ts
import { removeTestHubDb } from "./support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, getTenantSetting, withTenant } from "@/lib/db-tenant";
import { chiaveEsito, scriviInterruttore } from "@/lib/topology/letture/interruttori";
import type { RispostaGrezza } from "../librenms-api";
import {
  CADENZA_MINUTI,
  INVENTARIO_PER_GIRO,
  LetturaNonRiuscita,
  candidatiLibrenms,
  datiLibrenmsHost,
  giroLibrenms,
  scriviParteLibrenms,
  type DipendenzeGiro,
  type EsitoGiro,
} from "../librenms-fonte";
import type { EsitoAggiunta } from "../librenms-sync";

const T = "TESTLIBRENMSFONTE";
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

const FIX = path.join(__dirname, "fixtures", "librenms");
const vera = (f: string): unknown => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));

/** L'API finta: percorso → risposta; `sostituisci` cambia una parte per una prova. */
const chiamate: string[] = [];
let sostituisci: Record<string, () => RispostaGrezza> = {};
function rispostaVera(percorso: string): RispostaGrezza {
  const base = percorso.split("?")[0];
  const f: Record<string, string> = {
    "/devices": "devices.json", "/ports": "ports.json", "/resources/links": "links.json", "/resources/vlans": "vlans.json",
    "/resources/fdb": "fdb.json", "/resources/ip/arp/all": "arp-all.json", "/resources/sensors": "sensors.json",
    "/inventory/1/all": "inventory-2.json", "/inventory/5/all": "inventory-1.json",
  };
  if (f[base]) return { status: 200, corpo: vera(f[base]) };
  if (/^\/inventory\/\d+\/all$/.test(base)) return { status: 200, corpo: { status: "ok", inventory: [], count: 0 } };
  return { status: 404, corpo: { status: "error", message: "rotta non prevista" } };
}
const client: NonNullable<DipendenzeGiro["client"]> = {
  async getRisorsa(percorso: string) {
    chiamate.push(percorso);
    const base = percorso.split("?")[0];
    if (sostituisci[base]) return sostituisci[base]();
    return rispostaVera(percorso);
  },
};
const aggiunte: number[] = [];
let esitoAggiunta: (id: number) => EsitoAggiunta = (id) => ({ ok: true, librenms_device_id: 900 + id, aggiunto: true });
let orologio = new Date("2026-10-22T08:00:00Z");
const dip = (): DipendenzeGiro => ({
  client,
  adesso: () => orologio,
  aggiungiHost: async (id) => {
    aggiunte.push(id);
    return esitoAggiunta(id);
  },
});
const conti = (tabella: string): number => (getTenantDb(T).prepare(`SELECT COUNT(*) AS n FROM ${tabella}`).get() as { n: number }).n;
const giro = (opts: { ignoraCadenza?: boolean; aggiungiCandidati?: boolean } = {}): Promise<EsitoGiro> =>
  withTenant(T, () => giroLibrenms({ ignoraCadenza: opts.ignoraCadenza ?? true, aggiungiCandidati: opts.aggiungiCandidati, dip: dip() }));

beforeEach(() => {
  chiamate.length = 0;
  aggiunte.length = 0;
  sostituisci = {};
  esitoAggiunta = (id) => ({ ok: true, librenms_device_id: 900 + id, aggiunto: true });
});

test("spento (default): nessuna chiamata, nessuna scrittura", async () => {
  const e = await giro();
  assert.deepEqual(e, { saltato: "spento" });
  assert.deepEqual(chiamate, []);
  assert.equal(conti("librenms_apparato"), 0);
});

test("acceso: ogni parte scritta dalle uscite vere; inventario sui 15 apparati di rete; esito senza IP né nomi", async () => {
  withTenant(T, () => scriviInterruttore("librenms", true, "prova"));
  const e = await giro({ aggiungiCandidati: false });
  assert.ok("parti" in e);
  assert.deepEqual(
    Object.fromEntries(Object.entries(e.parti).map(([p, v]) => [p, v.esito === "letto" ? v.righe : v.esito])),
    { apparati: 25, porte: 25, vicini: 25, vlan: 25, mac_porta: 25, arp: 25, sensori: 25, inventario: 11 },
  );
  assert.deepEqual(e.inventario, { apparati: 15, letti: 15, non_so: 0 }, "dsm, routeros, apc, dahua: sì; linux, generic, windows: no");
  assert.ok(chiamate.includes("/inventory/1/all"));
  assert.ok(!chiamate.includes("/inventory/2/all"), "linux: niente inventario");
  assert.ok(chiamate.some((c) => c.startsWith("/ports?columns=port_id,device_id,ifIndex")));
  assert.equal(conti("librenms_inventario"), 11);
  const esito = withTenant(T, () => getTenantSetting(chiaveEsito("librenms")));
  assert.ok(esito);
  assert.doesNotMatch(esito, /192\.0\.2\.|sysName-|remote_hostname-|02:00:00|020000/, "nell'esito solo numeri e codici");
  const d = getTenantDb(T);
  assert.deepEqual(d.prepare("SELECT esito, righe, codice FROM librenms_lettura WHERE parte = 'porte'").get(), { esito: "letto", righe: 25, codice: null });
  assert.equal((d.prepare("SELECT letto_il FROM librenms_porta LIMIT 1").get() as { letto_il: string }).letto_il, "2026-10-22 08:00:00");
});

test("«non so» non cancella: forma nuova delle porte, 500 dei sensori, rete giù per l'ARP → righe di prima intatte, le altre riscritte", async () => {
  orologio = new Date("2026-10-22T09:00:00Z");
  sostituisci = {
    "/ports": () => ({ status: 200, corpo: vera("forma-sconosciuta/ports.json") }),
    "/resources/sensors": () => ({ status: 500, corpo: { status: "error", message: "x" } }),
    "/resources/ip/arp/all": () => {
      throw new Error("fetch failed");
    },
  };
  const e = await giro({ aggiungiCandidati: false });
  assert.ok("parti" in e);
  assert.deepEqual(e.parti.porte, { esito: "non_so", codice: "campo_port_id" });
  assert.deepEqual(e.parti.sensori, { esito: "non_so", codice: "http_500" });
  assert.deepEqual(e.parti.arp, { esito: "non_so", codice: "rete" });
  assert.deepEqual(e.parti.vicini, { esito: "letto", righe: 25 });
  assert.equal(conti("librenms_porta"), 25);
  assert.equal(conti("librenms_sensore"), 25);
  assert.equal(conti("librenms_arp"), 25);
  const d = getTenantDb(T);
  assert.deepEqual(d.prepare("SELECT esito, righe, letto_il, tentato_il, codice FROM librenms_lettura WHERE parte = 'porte'").get(),
    { esito: "non_so", righe: 25, letto_il: "2026-10-22 08:00:00", tentato_il: "2026-10-22 09:00:00", codice: "campo_port_id" });
  assert.equal((d.prepare("SELECT letto_il FROM librenms_porta LIMIT 1").get() as { letto_il: string }).letto_il, "2026-10-22 08:00:00", "le righe restano della lettura buona");
  assert.equal((d.prepare("SELECT letto_il FROM librenms_vicino LIMIT 1").get() as { letto_il: string }).letto_il, "2026-10-22 09:00:00");
});

test("scriviParteLibrenms lancia su «non so» e non tocca le righe", () => {
  withTenant(T, () => {
    assert.throws(() => scriviParteLibrenms("vicini", { esito: "non_so", codice: "forma" }, "2026-10-22 09:30:00"), LetturaNonRiuscita);
  });
  assert.equal(conti("librenms_vicino"), 25);
});

test("200 con lista vuota è un fatto: la fotografia si svuota", async () => {
  orologio = new Date("2026-10-22T10:00:00Z");
  sostituisci = { "/resources/links": () => ({ status: 200, corpo: { status: "ok", links: [], count: 0 } }) };
  const e = await giro({ aggiungiCandidati: false });
  assert.ok("parti" in e);
  assert.deepEqual(e.parti.vicini, { esito: "letto", righe: 0 });
  assert.equal(conti("librenms_vicino"), 0);
});

test("cadenza: un giro dentro i 15 minuti si salta, senza chiamate; ignoraCadenza lo fa partire", async () => {
  orologio = new Date(Date.parse("2026-10-22T10:00:00Z") + (CADENZA_MINUTI - 1) * 60_000);
  assert.deepEqual(await giro({ ignoraCadenza: false }), { saltato: "cadenza" });
  assert.deepEqual(chiamate, []);
  orologio = new Date(Date.parse("2026-10-22T10:00:00Z") + CADENZA_MINUTI * 60_000);
  const e = await giro({ ignoraCadenza: false, aggiungiCandidati: false });
  assert.ok("parti" in e);
});

test("un apparato tolto da LibreNMS sparisce dalla fotografia e dal suo inventario", async () => {
  const corpo = vera("devices.json") as { status: string; devices: Array<{ device_id: number }> };
  sostituisci = { "/devices": () => ({ status: 200, corpo: { ...corpo, devices: corpo.devices.filter((x) => x.device_id !== 1) } }) };
  await giro({ aggiungiCandidati: false });
  const d = getTenantDb(T);
  assert.equal(conti("librenms_apparato"), 24);
  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM librenms_inventario WHERE librenms_device_id = 1").get() as { n: number }).n, 0);
  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM librenms_inventario WHERE librenms_device_id = 5").get() as { n: number }).n, 1);
});

test("inventario: al più 20 apparati per giro, gli altri al giro dopo", async () => {
  const molti = { status: "ok", devices: Array.from({ length: 25 }, (_, i) => ({ device_id: 100 + i, os: "routeros", ip: null })) };
  sostituisci = { "/devices": () => ({ status: 200, corpo: molti }) };
  await giro({ aggiungiCandidati: false });
  const primo = chiamate.filter((c) => c.startsWith("/inventory/")).map((c) => Number(c.split("/")[2]));
  assert.equal(primo.length, INVENTARIO_PER_GIRO);
  assert.deepEqual(primo.slice(0, 2), [100, 101]);
  chiamate.length = 0;
  await giro({ aggiungiCandidati: false });
  const secondo = chiamate.filter((c) => c.startsWith("/inventory/")).map((c) => Number(c.split("/")[2]));
  assert.deepEqual(secondo.slice(0, 5), [120, 121, 122, 123, 124], "riparte dal punto");
  assert.equal(secondo[5], 100, "poi ricomincia");
});

// ── Letture per le rotte e candidati ─────────────────────────────────────────

function preparaHost(ip: string, nome: string): number {
  const d = getTenantDb(T);
  d.prepare("INSERT OR IGNORE INTO networks (id, cidr, name) VALUES (1, '192.0.2.0/24', 'rete-a')").run();
  return Number(d.prepare("INSERT INTO hosts (network_id, ip, hostname, status) VALUES (1, ?, ?, 'online')").run(ip, nome).lastInsertRowid);
}

test("dati di un host: abbinato per IP all'apparato di LibreNMS, con porte, vicini, sensori e inventario", async () => {
  orologio = new Date("2026-10-22T12:00:00Z");
  await giro({ aggiungiCandidati: false });
  // Nelle fixture l'apparato 1 (routeros, tutte le porte) non ha un IP: l'aggancio passa da librenms_host_map.
  const ccr = withTenant(T, () => preparaHost("192.0.2.3", "ccr"));
  const switchMappato = withTenant(T, () => preparaHost("192.0.2.250", "sw-mappato"));
  getTenantDb(T).prepare("INSERT INTO librenms_host_map (network_id, host_ip, librenms_device_id) VALUES (1, '192.0.2.250', 1)").run();
  const a = withTenant(T, () => datiLibrenmsHost(ccr));
  assert.equal(a.abbinato, true);
  assert.equal(a.abbinato && a.librenms_device_id, 5);
  assert.equal(a.abbinato && a.inventario.length, 1);
  const b = withTenant(T, () => datiLibrenmsHost(switchMappato));
  assert.ok(b.abbinato);
  assert.equal(b.porte.length, 25);
  assert.equal(b.apparato?.os, "routeros");
  assert.equal(b.letture.porte.esito, "letto");
  const nessuno = withTenant(T, () => datiLibrenmsHost(preparaHost("192.0.2.251", "senza")));
  assert.equal(nessuno.abbinato, false);
});

test("candidati: non interrogati, rifiutati col motivo, vicini risolti a un host per nome; aggiunti da soli al più 5 per giro", async () => {
  orologio = new Date("2026-10-22T13:00:00Z");
  // Due vicini «non interrogati» delle fixture corrispondono a host di DA-IPAM per nome (con dominio: si confronta il primo pezzo).
  const h1 = withTenant(T, () => preparaHost("192.0.2.201", "remote_hostname-152.esempio.local"));
  const h2 = withTenant(T, () => preparaHost("192.0.2.202", "REMOTE_HOSTNAME-185"));
  getTenantDb(T).prepare("INSERT INTO librenms_rifiuto (ip, host_id, codice, motivo, il) VALUES ('192.0.2.202', ?, 'snmp_non_risponde', 'Could not connect', '2026-10-22 12:30:00')").run(h2);
  const c = withTenant(T, () => candidatiLibrenms());
  assert.equal(c.non_interrogati.length, 3, "i tre apparati con last_polled nullo");
  assert.deepEqual(c.rifiutati.map((r) => [r.host_id, r.codice]), [[h2, "snmp_non_risponde"]]);
  assert.deepEqual(c.dai_vicini.map((v) => v.host_id).sort(), [h1, h2].sort());
  assert.ok(c.dai_vicini.every((v) => v.porta !== ""));

  const e = await giro();
  assert.ok("parti" in e);
  assert.deepEqual(aggiunte, [h1], "il rifiutato da meno di 24 ore non si riprova");
  assert.deepEqual(e.candidati, { provati: 1, aggiunti: 1, rifiutati: 0 });

  // Il giorno dopo si riprova; LibreNMS rifiuta ancora: conta come rifiutato.
  orologio = new Date("2026-10-23T13:00:00Z");
  esitoAggiunta = () => ({ ok: false, codice: "snmp_non_risponde", messaggio: "Could not connect" });
  const e2 = await giro();
  assert.ok("parti" in e2);
  assert.ok(aggiunte.includes(h2));
});

// Riccardo 22/10 sera: l'aggiunta automatica prende tutti gli oggetti con l'SNMP verificato, non solo i vicini LLDP. Sulla
// sede di prova i candidati dai vicini erano zero e 76 oggetti avevano una SNMP validata (16 apparati, 60 host); dei 16
// apparati solo 4 col binding «riuscito», gli altri «non provati» ma letti in SNMP ogni ora.
test("candidati SNMP verificati: apparati (binding riuscito o SNMP validata sull'host) e host; esclusi, già dentro e chi non ha SNMP restano fuori", async () => {
  orologio = new Date("2026-10-24T09:00:00Z");
  const d = getTenantDb(T);
  d.prepare("DELETE FROM librenms_rifiuto").run();
  const cred = Number(d.prepare("INSERT INTO credentials (name, credential_type) VALUES ('community', 'snmp')").run().lastInsertRowid);
  const validaSnmp = (hostId: number) =>
    d.prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated) VALUES (?, ?, 'snmp', 161, 1)").run(hostId, cred);
  const apparato = (ip: string, nome: string, hostId: number | null) =>
    Number(d.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol, host_id) VALUES (?, ?, 'switch', 'mikrotik', 'snmp_v2', ?)").run(nome, ip, hostId).lastInsertRowid);

  const hSw = withTenant(T, () => preparaHost("192.0.2.31", "sw-validato"));
  validaSnmp(hSw);
  const swValidato = apparato("192.0.2.31", "sw-validato", hSw);
  const swBinding = apparato("192.0.2.32", "sw-binding", null);
  d.prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, test_status) VALUES (?, ?, 'snmp', 161, 'success')").run(swBinding, cred);
  apparato("192.0.2.33", "sw-non-provato", null); // binding assente e host senza SNMP validata: fuori
  const hStampante = withTenant(T, () => preparaHost("192.0.2.34", "stampante"));
  validaSnmp(hStampante);
  const hEscluso = withTenant(T, () => preparaHost("192.0.2.35", "escluso"));
  validaSnmp(hEscluso);
  d.prepare("INSERT INTO librenms_esclusione (ip, host_id, il) VALUES ('192.0.2.35', ?, '2026-10-24 08:00:00')").run(hEscluso);
  const hDentro = withTenant(T, () => preparaHost("192.0.2.36", "gia-dentro"));
  validaSnmp(hDentro);
  d.prepare("INSERT INTO librenms_host_map (network_id, host_ip, librenms_device_id) VALUES (1, '192.0.2.36', 77)").run();

  const c = withTenant(T, () => candidatiLibrenms());
  const snmp = c.snmp_verificati.filter((x) => x.ip.startsWith("192.0.2.3"));
  assert.deepEqual(snmp.map((x) => [x.tipo, x.ip]), [
    ["apparato", "192.0.2.31"], ["apparato", "192.0.2.32"], ["host", "192.0.2.34"],
  ], "prima gli apparati; fuori il non provato, l'escluso e chi è già in LibreNMS");
  assert.deepEqual(c.esclusi.map((x) => [x.host_id, x.ip]), [[hEscluso, "192.0.2.35"]]);

  const apparatiAggiunti: number[] = [];
  const e = await withTenant(T, () => giroLibrenms({
    ignoraCadenza: true,
    dip: { ...dip(), aggiungiApparato: async (id) => { apparatiAggiunti.push(id); return { ok: true, librenms_device_id: 500 + id, aggiunto: true }; } },
  }));
  assert.ok("parti" in e);
  assert.deepEqual(apparatiAggiunti, [swValidato, swBinding]);
  assert.ok(aggiunte.includes(hStampante), "l'host senza apparato passa dall'aggiunta di un host");
  assert.ok(!aggiunte.includes(hEscluso) && !aggiunte.includes(hDentro));
  assert.ok(e.candidati.provati <= 5);
});

test("candidati SNMP: senza la fotografia degli apparati (LibreNMS non risponde) nessun oggetto SNMP si aggiunge", async () => {
  orologio = new Date("2026-10-25T09:00:00Z");
  sostituisci["/devices"] = () => ({ status: 500, corpo: {} });
  const apparatiAggiunti: number[] = [];
  const e = await withTenant(T, () => giroLibrenms({
    ignoraCadenza: true,
    dip: { ...dip(), aggiungiApparato: async (id) => { apparatiAggiunti.push(id); return { ok: true, librenms_device_id: 1, aggiunto: true }; } },
  }));
  assert.ok("parti" in e);
  assert.equal(e.parti.apparati.esito, "non_so");
  assert.deepEqual(apparatiAggiunti, []);
  const ipSnmp = new Set(["192.0.2.31", "192.0.2.32", "192.0.2.34"]);
  const hostSnmp = (getTenantDb(T).prepare("SELECT id, ip FROM hosts").all() as Array<{ id: number; ip: string }>).filter((h) => ipSnmp.has(h.ip)).map((h) => h.id);
  assert.ok(aggiunte.every((id) => !hostSnmp.includes(id)));
});
