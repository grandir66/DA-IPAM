// Le letture in più dei MikroTik nel giro (spec topologia §13.5.2, T2.2). Spente di default: con la chiave assente il
// giro non manda nessun comando nuovo (spia sull'esecutore, I33) e le colonne nuove dei vicini restano vuote. Accese: una
// connessione per apparato, un `exec` per comando col suo tempo massimo; il router non rimanda MK2 (l'uscita c'è già);
// al più una volta l'ora per apparato; due giri paralleli → una lettura; un comando che non risponde non ferma né la
// lettura né gli apparati dopo (I53); un errore si riconosce dal testo.
//
// In più (livello completo, zona rossa: comandi nuovi sui router dei clienti): solo `print` e `monitor … once`; tre
// esiti per comando (letto / errore dal testo / non so), e un errore di trasporto non diventa «uscita vuota»; a
// interruttore spento il giro manda al client del router le stesse chiamate di prima; ogni chiamante che scrive i vicini
// di un router con la fonte di oggi toglie le colonne nuove (I33 anche dall'interrogazione a mano).
//
// Hub isolato importato per primo (il perché sta in support/hub-isolato).
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, rileggiSchemaCavi, withTenant } from "@/lib/db-tenant";
import { runArpPoll } from "@/lib/cron/jobs";
import type { RouterClient } from "@/lib/devices/router-client";
import { parseMikrotikNeighbors } from "@/lib/devices/mikrotik-vicini";
import { parseMikrotikInterfaceTypes } from "@/lib/devices/mikrotik-porte";
import { ComandoScaduto, SshError } from "@/lib/devices/ssh-transport";
import {
  COMANDI_MK, TEMPO_COMANDO_MS, codiceTrasporto, leggiMikrotikTopologia, type ApriEsecutore,
} from "@/lib/devices/mikrotik-letture";
import { leggiEsiti, scriviInterruttore } from "@/lib/topology/letture/interruttori";

const T = "TESTARPLETTUREMK";
const db = () => getTenantDb(T);
const FX = path.join(__dirname, "..", "..", "devices", "__tests__", "fixtures");
const F = (n: string): string => fs.readFileSync(path.join(FX, n), "utf8");
const USCITE: Record<string, string> = {
  [COMANDI_MK.interfacce]: F("mikrotik-mk2-testa.txt"), [COMANDI_MK.vicini]: F("mikrotik-ip-neighbor-terse.txt"),
  [COMANDI_MK.bridge]: F("mikrotik-mk3-testa.txt"), [COMANDI_MK.porteBridge]: F("mikrotik-mk4-testa.txt"),
  [COMANDI_MK.monitorBridge]: F("mikrotik-mk5-testa.txt"), [COMANDI_MK.monitorPorte]: F("mikrotik-mk6-testa.txt"),
  [COMANDI_MK.fasci]: F("mikrotik-mk8a-testa.txt"), [COMANDI_MK.monitorFasci]: F("mikrotik-mk8b-testa.txt"),
};

function spia(diverse: Record<string, () => Promise<string>> = {}) {
  const chiamate: Array<{ device: number; comandi: string[] }> = [];
  const apri: ApriEsecutore = async (device, fn) => {
    const voce = { device: device.id, comandi: [] as string[] };
    chiamate.push(voce);
    return fn(async (cmd) => {
      voce.comandi.push(cmd);
      const d = diverse[cmd];
      if (d) return d();
      if (!(cmd in USCITE)) throw new Error(`comando inatteso: ${cmd}`);
      return USCITE[cmd];
    });
  };
  return { apri, chiamate };
}

function clientFinto(): RouterClient {
  const mk2 = F("mikrotik-mk2-testa.txt");
  return {
    async getArpTable() { return []; },
    async testConnection() { return true; },
    async getNeighbors() { return parseMikrotikNeighbors(F("mikrotik-ip-neighbor-terse.txt")); },
    async getBridgeHosts() { return []; },
    async getInterfaceTypes() { return parseMikrotikInterfaceTypes(mk2); },
    ultimaUscitaInterfacce() { return mk2; },
  };
}

beforeEach(() => {
  db().exec(`DELETE FROM topology_port_facts; DELETE FROM topology_bridge_facts; DELETE FROM topology_device_macs;
    DELETE FROM device_neighbors; DELETE FROM mac_port_entries; DELETE FROM network_devices; DELETE FROM networks;
    DELETE FROM tenant_settings WHERE key LIKE 'topologia.lettura.%';`);
  db().exec("INSERT INTO networks (id, cidr, name) VALUES (1, '192.0.2.0/24', 'LAN prova')");
  db().exec("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, enabled, use_for_arp_poll) "
    + "VALUES (1, 'RTR-1', '192.0.2.1', 'router', 'mikrotik', 'ssh', 1, 1), (2, 'SW-2', '192.0.2.2', 'switch', 'mikrotik', 'ssh', 1, 0)");
  withTenant(T, () => rileggiSchemaCavi());
});
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

const ora = (h: number, m = 0) => () => new Date(Date.UTC(2026, 9, 15, h, m));
const giro = (s: ReturnType<typeof spia>, adesso = ora(8)) =>
  withTenant(T, () => runArpPoll(null, { skipDhcpLeases: true, creaClientRouter: async () => clientFinto(), apriEsecutore: s.apri, adesso }));
const conta = (sql: string): number => (db().prepare(sql).get() as { n: number }).n;
const accendi = () => withTenant(T, () => scriviInterruttore("mikrotik", true, "admin"));

test("I33: letture spente → nessun comando nuovo, nessun fatto, vicini senza le colonne nuove", async () => {
  const s = spia();
  await giro(s);
  assert.deepEqual(s.chiamate, []);
  assert.equal(conta("SELECT COUNT(*) AS n FROM topology_port_facts"), 0);
  assert.equal(conta("SELECT COUNT(*) AS n FROM device_neighbors WHERE device_id = 1"), 9, "i vicini di oggi ci sono");
  assert.equal(conta("SELECT COUNT(discovered_by) + COUNT(remote_caps) AS n FROM device_neighbors"), 0);
});

test("accese: una connessione per apparato; il router non rimanda MK2; fatti, esito, vicini dello switch con la fonte ssh", async () => {
  accendi();
  const s = spia();
  const r = await giro(s);
  assert.deepEqual(s.chiamate.map((c) => [c.device, c.comandi.length]), [[1, 6], [2, 8]]);
  assert.equal(s.chiamate[0].comandi.includes(COMANDI_MK.interfacce), false, "MK2 dall'uscita già letta dal giro");
  assert.ok(conta("SELECT COUNT(*) AS n FROM topology_port_facts WHERE device_id = 1 AND source = 'device'") > 20);
  assert.equal(conta("SELECT COUNT(*) AS n FROM topology_bridge_facts"), 2);
  assert.ok(conta("SELECT COUNT(*) AS n FROM device_neighbors WHERE device_id = 2 AND source = 'ssh'") > 0);
  assert.ok(conta("SELECT COUNT(discovered_by) AS n FROM device_neighbors WHERE device_id = 1") > 0);
  assert.deepEqual(Object.keys(withTenant(T, () => leggiEsiti("mikrotik"))).sort(), ["1", "2"]);
  assert.match(r.phase ?? "", /letture in più: 2 lette/);
});

test("cadenza e lucchetto: due giri paralleli → una lettura per apparato; mezz'ora dopo nessun comando", async () => {
  accendi();
  const s1 = spia();
  await Promise.all([giro(s1, ora(8)), giro(s1, ora(8))]);
  assert.equal(s1.chiamate.length, 2);
  const s2 = spia();
  await giro(s2, ora(8, 30));
  assert.deepEqual(s2.chiamate, []);
});

test("I53: un comando che non risponde non ferma la lettura né gli apparati dopo", async () => {
  accendi();
  const s = spia({ [COMANDI_MK.monitorBridge]: async () => { throw new ComandoScaduto(20_000); } });
  await giro(s);
  const e = withTenant(T, () => leggiEsiti("mikrotik"));
  assert.deepEqual([e["1"].comandi, e["1"].riusciti, e["1"].codice], [6, 5, "TEMPO_SCADUTO"]);
  assert.equal(s.chiamate.length, 2, "lo switch dopo si legge lo stesso");
  assert.equal(conta("SELECT COUNT(*) AS n FROM topology_bridge_facts WHERE device_id = 1 AND root_id IS NULL"), 1, "il bridge c'è, la radice non è letta");
});

test("un errore riconosciuto dal testo conta come non riuscito (ssh uscito con 0)", async () => {
  accendi();
  await giro(spia({ [COMANDI_MK.fasci]: async () => F("mikrotik-errore.txt") }));
  assert.equal(withTenant(T, () => leggiEsiti("mikrotik"))["1"].codice, "NO_SUCH_ITEM");
});

// ── Livello completo: le garanzie in più ─────────────────────────────────────

test("sola lettura: ogni comando è un `print` o un `monitor [find] once`, e il giro non ne manda altri", async () => {
  const LETTURA = /^\/[a-z][a-z /-]* (?:print terse(?: without-paging)?|monitor \[find\] once)$/;
  for (const c of Object.values(COMANDI_MK)) assert.match(c, LETTURA, `comando non in sola lettura: ${c}`);
  accendi();
  const s = spia();
  await giro(s);
  const mandati = s.chiamate.flatMap((c) => c.comandi);
  assert.equal(mandati.length, 14);
  for (const c of mandati) assert.ok((Object.values(COMANDI_MK) as string[]).includes(c), `comando fuori elenco: ${c}`);
});

test("ogni comando nuovo ha il suo tempo massimo, 20 secondi", async () => {
  const tempi: number[] = [];
  await leggiMikrotikTopologia(async (cmd, tempoMs) => { tempi.push(tempoMs); return USCITE[cmd]; }, { uscitaInterfacce: null, conVicini: true });
  assert.equal(TEMPO_COMANDO_MS, 20_000);
  assert.deepEqual(tempi, Array(8).fill(20_000));
});

test("tre esiti per comando: letto, errore dal testo (no), non so (tempo, trasporto); nessuno dei due diventa «vuoto»", async () => {
  const r = await leggiMikrotikTopologia(async (cmd) => {
    if (cmd === COMANDI_MK.bridge) return F("mikrotik-errore.txt");
    if (cmd === COMANDI_MK.porteBridge) throw new ComandoScaduto(TEMPO_COMANDO_MS);
    if (cmd === COMANDI_MK.fasci) throw Object.assign(new Error("read ECONNRESET 192.0.2.1:22"), { code: "ECONNRESET" });
    if (cmd === COMANDI_MK.monitorFasci) return F("mikrotik-vuoto.txt");
    return USCITE[cmd];
  }, { uscitaInterfacce: null, conVicini: false });
  assert.equal(r.lettura.bridge, null, "errore dal testo: non letto, non una lista vuota");
  assert.equal(r.lettura.porteBridge, null, "tempo scaduto: non letto");
  assert.equal(r.lettura.fasci, null, "errore di trasporto: non letto");
  assert.deepEqual(r.lettura.monitorFasci, [], "uscita vuota: letta, e vuota");
  assert.ok(r.lettura.interfacce && r.lettura.interfacce.length > 0);
  assert.deepEqual([r.comandi, r.riusciti, r.codice], [7, 4, "NO_SUCH_ITEM"], "il primo errore, col solo codice");
});

test("la connessione che non si apre: esito col codice del trasporto, nessun fatto, l'apparato dopo si legge", async () => {
  accendi();
  const s = spia();
  const apri: ApriEsecutore = async (device, fn) => {
    if (device.id === 1) throw Object.assign(new Error("connessione SSH non riuscita"), { code: codiceTrasporto(new SshError({ kind: "connect_timeout", message: "x", raw: "x" })) });
    return s.apri(device, fn);
  };
  await withTenant(T, () => runArpPoll(null, { skipDhcpLeases: true, creaClientRouter: async () => clientFinto(), apriEsecutore: apri, adesso: ora(8) }));
  const e = withTenant(T, () => leggiEsiti("mikrotik"));
  assert.deepEqual([e["1"].comandi, e["1"].riusciti, e["1"].codice], [0, 0, "SSH_CONNECT_TIMEOUT"]);
  assert.equal(conta("SELECT COUNT(*) AS n FROM topology_port_facts WHERE device_id = 1"), 0);
  assert.deepEqual(s.chiamate.map((c) => c.device), [2]);
  assert.equal(codiceTrasporto(new Error("senza codice")), "errore");
});

test("spenta: il client del router riceve le stesse chiamate di prima di T2, e nessuna connessione in più", async () => {
  const chiamate: string[] = [];
  const base = clientFinto();
  const registra = <K extends keyof RouterClient>(k: K): RouterClient[K] => {
    const f = base[k] as unknown as (...a: unknown[]) => unknown;
    return ((...a: unknown[]) => { chiamate.push(String(k)); return f(...a); }) as unknown as RouterClient[K];
  };
  const client: RouterClient = {
    getArpTable: registra("getArpTable"), testConnection: registra("testConnection"), getNeighbors: registra("getNeighbors"),
    getBridgeHosts: registra("getBridgeHosts"), getInterfaceTypes: registra("getInterfaceTypes"),
    async getRoutingTable() { chiamate.push("getRoutingTable"); return []; },
  };
  const s = spia();
  await withTenant(T, () => runArpPoll(null, { skipDhcpLeases: true, creaClientRouter: async () => client, apriEsecutore: s.apri, adesso: ora(8) }));
  assert.deepEqual(chiamate, ["getArpTable", "getBridgeHosts", "getInterfaceTypes", "getNeighbors", "getRoutingTable"]);
  assert.deepEqual(s.chiamate, []);
});

test("I33 fuori dal giro: chi scrive i vicini di un router con la fonte di oggi toglie le colonne nuove", () => {
  const radice = path.join(__dirname, "..", "..", "..");
  const file = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === "__tests__" ? [] : file(p);
    return /\.tsx?$/.test(d.name) && !/^db(-tenant)?\.ts$/.test(d.name) ? [p] : [];
  });
  const scoperte: string[] = [];
  for (const f of file(radice)) {
    fs.readFileSync(f, "utf8").split("\n").forEach((riga, i) => {
      if (!/\bupsertNeighbors\(/.test(riga) || /^\s*(\*|\/\/)/.test(riga) || /\bfunction upsertNeighbors\b/.test(riga)) return;
      // Fonte dichiarata (unifi, ssh, snmp, host): la decide la lettura che la scrive. Fonte di oggi: col freno.
      if (/,\s*"(unifi|ssh|snmp|host)"\s*\)/.test(riga) || /senzaCampiCavi/.test(riga)) return;
      scoperte.push(`${path.relative(radice, f)}:${i + 1}`);
    });
  }
  assert.deepEqual(scoperte, []);
});
