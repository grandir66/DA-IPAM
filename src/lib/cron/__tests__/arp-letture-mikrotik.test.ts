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
import { deleteTenantDatabase, getTenantDb, rileggiSchemaCavi, rileggiSchemaSchedaMk, withTenant } from "@/lib/db-tenant";
import { runArpPoll } from "@/lib/cron/jobs";
import type { RouterClient } from "@/lib/devices/router-client";
import { parseMikrotikNeighbors } from "@/lib/devices/mikrotik-vicini";
import { parseMikrotikInterfaceTypes } from "@/lib/devices/mikrotik-porte";
import { ComandoScaduto, SshError } from "@/lib/devices/ssh-transport";
import {
  COMANDI_MK, COMANDI_MK_SCHEDA, TEMPO_COMANDO_MS, codiceTrasporto, interpretaUscita, leggiMikrotikTopologia, type ApriEsecutore,
} from "@/lib/devices/mikrotik-letture";
import { leggiEsiti, scriviInterruttore } from "@/lib/topology/letture/interruttori";
import { DESCRIZIONE_LETTURE } from "@/lib/topology/letture/testi";
import { LETTURE_SPENTE_SQL } from "@/lib/topology/letture/__tests__/letture-spente";

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
    DELETE FROM mikrotik_bridge; DELETE FROM mikrotik_bridge_port; DELETE FROM mikrotik_bond;
    DELETE FROM mikrotik_bridge_vlan; DELETE FROM mikrotik_vlan; DELETE FROM mikrotik_dns; DELETE FROM mikrotik_user;
    DELETE FROM device_neighbors; DELETE FROM mac_port_entries; DELETE FROM network_devices; DELETE FROM networks;
    DELETE FROM tenant_settings WHERE key LIKE 'topologia.lettura.%';
    ${LETTURE_SPENTE_SQL}`);
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

// Revisione del Task 4 di T2 (rilievo 3, zona rossa): un'uscita non vuota da cui il lettore non ricava nessuna riga era
// «letta e vuota», e scriveva nel DB del cliente «nessun bridge», «nessun fascio». Adesso è «non so» (USCITA_NON_CAPITA),
// e i messaggi di RouterOS fuori elenco che si conoscono hanno il loro codice.
test("un'uscita che il lettore non capisce non è «letta e vuota»: USCITA_NON_CAPITA; i messaggi nuovi col loro codice", async () => {
  const r = await leggiMikrotikTopologia(async (cmd) => {
    if (cmd === COMANDI_MK.bridge) return "failure: not allowed for this bridge\r\n";
    if (cmd === COMANDI_MK.porteBridge) return "input does not match any value of interface\r\n";
    if (cmd === COMANDI_MK.monitorBridge) return "not enough permissions (9)\r\n";
    if (cmd === COMANDI_MK.fasci) return "una riga che nessun lettore conosce\r\n";
    if (cmd === COMANDI_MK.monitorFasci) return F("mikrotik-vuoto.txt");
    return USCITE[cmd];
  }, { uscitaInterfacce: null, conVicini: false });
  assert.deepEqual([r.lettura.bridge, r.lettura.porteBridge, r.lettura.monitorBridge, r.lettura.fasci], [null, null, null, null]);
  assert.deepEqual(r.lettura.monitorFasci, [], "uscita vuota: letta, e vuota");
  assert.deepEqual([r.comandi, r.riusciti, r.codice], [7, 3, "FAILURE"]);
  const soloStrana = await leggiMikrotikTopologia(async (cmd) => (cmd === COMANDI_MK.fasci ? "una riga che nessun lettore conosce\r\n" : USCITE[cmd]),
    { uscitaInterfacce: null, conVicini: false });
  assert.deepEqual([soloStrana.lettura.fasci, soloStrana.codice], [null, "USCITA_NON_CAPITA"]);
  const mk2Strana = await leggiMikrotikTopologia(async (cmd) => USCITE[cmd], { uscitaInterfacce: "uscita che non si capisce\r\n", conVicini: false });
  assert.ok(mk2Strana.lettura.interfacce && mk2Strana.lettura.interfacce.length > 0, "MK2 del giro che non si capisce: si rilegge");
});

// Revisione del Task 4 di T2 (B4): il contatore dei riusciti cresceva prima del lettore; un lettore che lancia contava come
// riuscito e dava il codice generico del trasporto. Adesso conta solo una lettura capita, e l'eccezione ha il suo codice.
test("un lettore che lancia: non riuscito, col codice LETTORE_IN_ERRORE", () => {
  assert.deepEqual(interpretaUscita("x=1\r\n", () => { throw new TypeError("rotto"); }), { codice: "LETTORE_IN_ERRORE" });
  assert.deepEqual(interpretaUscita("\r\n", () => []), { valore: [] });
  assert.deepEqual(interpretaUscita("x=1\r\n", () => []), { codice: "USCITA_NON_CAPITA" });
  assert.deepEqual(interpretaUscita("no such item (4)\r\n", () => [1]), { codice: "NO_SUCH_ITEM" });
  assert.deepEqual(interpretaUscita(" 0 name=a\r\n", () => [1]), { valore: [1] });
});

// Revisione del Task 4 di T2 (B5): se il giro del router si fermava prima (ARP che non risponde), le letture in più
// saltavano senza esito: nella pagina l'apparato restava «mai letto» invece di «non so» col suo codice.
test("il giro del router si ferma prima (ARP non letto): esito «non so» col codice, nessun comando nuovo", async () => {
  accendi();
  const s = spia();
  const rotto = async (): Promise<RouterClient> => ({ ...clientFinto(), async getArpTable() {
    throw new SshError({ kind: "connect_timeout", message: "x", raw: "x" });
  } });
  const r = await withTenant(T, () => runArpPoll(null, { skipDhcpLeases: true, creaClientRouter: rotto, apriEsecutore: s.apri, adesso: ora(8) }));
  const e = withTenant(T, () => leggiEsiti("mikrotik"));
  assert.deepEqual([e["1"]?.comandi, e["1"]?.riusciti, e["1"]?.codice], [0, 0, "SSH_CONNECT_TIMEOUT"]);
  assert.deepEqual(s.chiamate.map((c) => c.device), [2], "nessuna connessione nuova verso il router");
  assert.match(r.phase ?? "", /1 non riuscita; codici: SSH_CONNECT_TIMEOUT/);
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

// ── MK7 (Task 3b di T2): le istanze MSTP, solo dove un bridge è in MSTP ──────────────────────────────────────────────────────
// Livello completo: due comandi nuovi sui router dei clienti, dietro lo stesso interruttore (già acceso sul cliente A). Le
// uscite vere T2-a del router A; il suo `msti print` manca: quello di B ha la stessa forma e, nella stessa regione, la stessa
// mappa delle VLAN. Gli altri comandi rispondono con le fixture di oggi (RSTP): conta che cosa si manda e che cosa si scrive.
const MSTP: Record<string, () => Promise<string>> = {
  [COMANDI_MK.bridge]: async () => F("mikrotik-mk3-mstp-a.txt"), [COMANDI_MK.monitorBridge]: async () => F("mikrotik-mk5-mstp-a.txt"),
  [COMANDI_MK.msti]: async () => F("mikrotik-mk7-msti-b.txt"), [COMANDI_MK.monitorMsti]: async () => F("mikrotik-mk7-monitor-a.txt"),
};
const righeBridge = () => (db().prepare("SELECT device_id, instance, region_name, config_digest, vlans, root_port, regional_root_id FROM topology_bridge_facts ORDER BY device_id, instance")
  .all() as Array<Record<string, unknown>>).map((r) => [r.device_id, r.instance, r.region_name, r.config_digest, r.vlans, r.root_port, r.regional_root_id]);

test("MK7 con le fixture di oggi (RSTP): nessun comando `msti`, gli stessi comandi di prima", async () => {
  accendi();
  const s = spia();
  await giro(s);
  assert.deepEqual(s.chiamate.map((c) => [c.device, c.comandi.length]), [[1, 6], [2, 8]]);
  assert.equal(s.chiamate.flatMap((c) => c.comandi).some((c) => c.includes("msti")), false);
});

test("MK7 con un bridge in MSTP: i due comandi `msti` in coda, sulla stessa connessione; una riga per istanza, l'albero comune intero", async () => {
  accendi();
  const s = spia(MSTP);
  await giro(s);
  assert.deepEqual(s.chiamate.map((c) => [c.device, c.comandi.length]), [[1, 8], [2, 10]], "una connessione per apparato, due comandi in più");
  for (const c of s.chiamate) assert.deepEqual(c.comandi.slice(-2), [COMANDI_MK.msti, COMANDI_MK.monitorMsti]);
  const comune = (d: number) => [d, 0, "RGX", "a4c123b1612dd272d1371c17149d4395", "1-76,78-4094", null, "8192.02:00:00:00:00:10"];
  const istanza1 = (d: number) => [d, 1, null, null, "77", "eoip-tunnel-SEDA-SEDB", "4096.02:00:00:00:00:11"];
  assert.deepEqual(righeBridge(), [comune(1), istanza1(1), comune(2), istanza1(2)], "la riga D (istanza 0) non sovrascrive l'albero comune");
  const e = withTenant(T, () => leggiEsiti("mikrotik"));
  assert.deepEqual([e["1"].comandi, e["1"].riusciti, e["1"].codice], [8, 8, null]);
});

test("MK7 che non risponde: nessuna riga d'istanza (le istanze restano «non lette»), l'albero comune c'è, l'esito ha il codice", async () => {
  accendi();
  await giro(spia({ ...MSTP, [COMANDI_MK.monitorMsti]: async () => { throw new ComandoScaduto(TEMPO_COMANDO_MS); } }));
  assert.deepEqual(righeBridge().map((r) => [r[0], r[1], r[2]]), [[1, 0, "RGX"], [2, 0, "RGX"]]);
  const e = withTenant(T, () => leggiEsiti("mikrotik"));
  assert.deepEqual([e["1"].comandi, e["1"].riusciti, e["1"].codice], [8, 7, "TEMPO_SCADUTO"]);
});

test("MK7: `msti print` non riuscito → il monitor non parte (la sua uscita non si potrebbe attaccare a nessuna istanza)", async () => {
  accendi();
  const s = spia({ ...MSTP, [COMANDI_MK.msti]: async () => F("mikrotik-errore.txt") });
  await giro(s);
  assert.equal(s.chiamate[0].comandi.includes(COMANDI_MK.monitorMsti), false);
  const e = withTenant(T, () => leggiEsiti("mikrotik"));
  assert.deepEqual([e["1"].comandi, e["1"].riusciti, e["1"].codice], [7, 6, "NO_SUCH_ITEM"]);
  assert.deepEqual(righeBridge().map((r) => [r[0], r[1], r[4]]), [[1, 0, null], [2, 0, null]]);
});

test("MK7: ogni comando ha il suo tempo massimo, anche i due nuovi (10 comandi con MSTP e vicini)", async () => {
  const tempi: Array<[string, number]> = [];
  await leggiMikrotikTopologia(async (cmd, tempoMs) => { tempi.push([cmd, tempoMs]); return MSTP[cmd] ? MSTP[cmd]() : USCITE[cmd]; }, { uscitaInterfacce: null, conVicini: true });
  assert.equal(tempi.length, 10);
  assert.ok(tempi.every(([, t]) => t === TEMPO_COMANDO_MS));
});

test("MK7: la scheda «Letture in più» dice anche i due comandi nuovi e quando partono (l'interruttore è già acceso dal cliente)", () => {
  assert.ok(DESCRIZIONE_LETTURE.mikrotik.comandi.includes("/interface bridge msti print e monitor (2 in più dove un bridge è in MSTP)"));
  assert.ok(DESCRIZIONE_LETTURE.mikrotik.legge.includes("sui bridge in MSTP la porta radice e le VLAN di ogni istanza"));
});

// ── Scheda MikroTik (Task 3): interfacce dall'uscita già letta dal giro ──────

const righeInterfacce = (): number => conta("SELECT COUNT(*) AS n FROM device_interfaces");
function collegaFisico(): number {
  const r = db().prepare("INSERT INTO physical_devices (vendor, identity_confidence, identity_anchor) VALUES ('mikrotik', 1, 'prova')").run();
  const id = Number(r.lastInsertRowid);
  db().prepare("UPDATE network_devices SET physical_device_id = ? WHERE id = 1").run(id);
  db().exec("DELETE FROM device_interfaces");
  return id;
}

test("scheda MikroTik: con l'apparato fisico le interfacce si scrivono (tipo, MTU, commento, stato)", async () => {
  const pd = collegaFisico();
  await giro(spia());
  assert.equal(righeInterfacce(), 24);
  assert.deepEqual(db().prepare("SELECT type, mtu, alias, status, disabled FROM device_interfaces WHERE physical_device_id = ? AND ifname = 'bond1'").get(pd),
    { type: "bond", mtu: 1500, alias: "cavo-a", status: "up", disabled: 0 });
});

test("scheda MikroTik: senza apparato fisico non si scrive niente", async () => {
  db().exec("DELETE FROM device_interfaces");
  await giro(spia());
  assert.equal(righeInterfacce(), 0);
});

test("scheda MikroTik: un errore va in console.warn col solo codice e il giro continua (vicini scritti)", async () => {
  const avvisi: string[] = [];
  const originale = console.warn;
  console.warn = (...a: unknown[]) => { avvisi.push(a.map(String).join(" ")); };
  try {
    collegaFisico();
    db().exec("CREATE TRIGGER prova_scrittura_rifiutata BEFORE INSERT ON device_interfaces BEGIN SELECT RAISE(ABORT, 'rifiutata per prova'); END");
    await giro(spia());
  } finally {
    console.warn = originale;
    db().exec("DROP TRIGGER IF EXISTS prova_scrittura_rifiutata");
  }
  assert.ok(avvisi.some((a) => a.includes("apparato #1: interfacce non scritte")), avvisi.join("|"));
  assert.ok(!avvisi.some((a) => a.includes("bond1") || a.includes("cavo-a")), "niente nomi né commenti nel log");
  assert.equal(conta("SELECT COUNT(*) AS n FROM device_neighbors WHERE device_id = 1"), 9, "il giro è andato avanti");
});

// ── Task 8 (scheda MikroTik, P3): bridge, porte e bond nelle tabelle della scheda, dalle stesse uscite ──────────────

const righeScheda = (id: number): number[] => ["mikrotik_bridge", "mikrotik_bridge_port", "mikrotik_bond"]
  .map((t) => conta(`SELECT COUNT(*) AS n FROM ${t} WHERE device_id = ${id}`));

test("scheda: lettura accesa → le tre tabelle del router con le righe delle fixture; lo switch non le scrive; nessun comando in più", async () => {
  accendi();
  const s = spia();
  await giro(s);
  assert.deepEqual(righeScheda(1), [1, 10, 3]);
  assert.deepEqual(righeScheda(2), [0, 0, 0], "ramo degli switch: niente scheda");
  assert.deepEqual(s.chiamate.map((c) => [c.device, c.comandi.length]), [[1, 6], [2, 8]]);
  assert.equal(conta("SELECT COUNT(*) AS n FROM mikrotik_bridge_port WHERE device_id = 1 AND interface = 'sfp-sfpplus5' AND inactive = 1"), 1);
});

test("scheda: lettura spenta → nessuna riga e nessun comando", async () => {
  const s = spia();
  await giro(s);
  assert.deepEqual(s.chiamate, []);
  assert.deepEqual(righeScheda(1), [0, 0, 0]);
});

test("scheda: un «non so» non scrive una lista vuota, le righe dell'ultima lettura buona restano", async () => {
  accendi();
  await giro(spia());
  // Un'ora e mezza dopo: il bridge in errore dal testo, le porte senza risposta, i fasci letti e vuoti.
  await giro(spia({
    [COMANDI_MK.bridge]: async () => F("mikrotik-errore.txt"),
    [COMANDI_MK.porteBridge]: async () => { throw new ComandoScaduto(20_000); },
    [COMANDI_MK.fasci]: async () => "",
  }), ora(9, 30));
  assert.deepEqual(righeScheda(1), [1, 10, 0]);
  assert.equal(conta("SELECT COUNT(*) AS n FROM mikrotik_bridge WHERE device_id = 1 AND seen_at = '2026-10-15 08:00:00'"), 1, "il bridge resta con la sua età");
});

// ── Task 10 (scheda MikroTik, P4): lettura «VLAN, DNS e utenti dei MikroTik», spenta di default ──────────────
// Zona rossa: quattro comandi nuovi sui router dei clienti. Spenta = nessuno dei quattro parte, e il giro di oggi è identico
// (stessi comandi, stesse righe, stesso resoconto). Accesa: solo sui router, una connessione sua, al più una volta l'ora.

const USCITE_SCHEDA: Record<string, () => Promise<string>> = {
  [COMANDI_MK_SCHEDA.vlanBridge]: async () => F("mikrotik-bridge-vlan-terse.txt"), [COMANDI_MK_SCHEDA.vlan]: async () => F("mikrotik-vlan-terse.txt"),
  [COMANDI_MK_SCHEDA.dns]: async () => F("mikrotik-dns.txt"), [COMANDI_MK_SCHEDA.utenti]: async () => F("mikrotik-user-terse.txt"),
};
const SCHEDA = new Set<string>(Object.values(COMANDI_MK_SCHEDA));
const righeV3 = (id: number): number[] => ["mikrotik_bridge_vlan", "mikrotik_vlan", "mikrotik_dns", "mikrotik_user"]
  .map((t) => conta(`SELECT COUNT(*) AS n FROM ${t} WHERE device_id = ${id}`));
const accendiScheda = () => withTenant(T, () => scriviInterruttore("mikrotik_scheda", true, "admin"));

test("VLAN/DNS/utenti spenta (topologia accesa): nessuno dei quattro comandi; giro, righe e resoconto come prima", async () => {
  accendi();
  const s = spia(USCITE_SCHEDA);
  const r = await giro(s);
  assert.deepEqual(s.chiamate.map((c) => [c.device, c.comandi.length]), [[1, 6], [2, 8]], "le stesse connessioni e gli stessi comandi di prima");
  assert.equal(s.chiamate.flatMap((c) => c.comandi).filter((c) => SCHEDA.has(c)).length, 0);
  assert.deepEqual(righeV3(1), [0, 0, 0, 0]);
  assert.deepEqual(righeScheda(1), [1, 10, 3]);
  assert.match(r.phase ?? "", /letture in più: 2 lette(;|$|\s)/);
  assert.deepEqual(withTenant(T, () => leggiEsiti("mikrotik_scheda")), {});
});

test("VLAN/DNS/utenti accesa, topologia spenta: solo sul router, una connessione coi quattro comandi, righe ed esito", async () => {
  accendiScheda();
  const s = spia(USCITE_SCHEDA);
  const r = await giro(s);
  assert.deepEqual(s.chiamate.map((c) => [c.device, c.comandi]), [[1, Object.values(COMANDI_MK_SCHEDA)]], "lo switch no, la topologia no");
  assert.deepEqual(righeV3(1), [12, 11, 1, 4]);
  assert.deepEqual(righeV3(2), [0, 0, 0, 0]);
  const e = withTenant(T, () => leggiEsiti("mikrotik_scheda"));
  assert.deepEqual(Object.keys(e), ["1"]);
  assert.deepEqual([e["1"].comandi, e["1"].riusciti, e["1"].codice], [4, 4, null]);
  assert.match(r.phase ?? "", /letture in più: 1 lette/);
});

test("VLAN/DNS/utenti accesa con la topologia: due connessioni sul router (6 + 4), poi lo switch", async () => {
  accendi();
  accendiScheda();
  const s = spia(USCITE_SCHEDA);
  await giro(s);
  assert.deepEqual(s.chiamate.map((c) => [c.device, c.comandi.length]), [[1, 6], [1, 4], [2, 8]]);
  assert.deepEqual(righeScheda(1), [1, 10, 3]);
});

test("VLAN/DNS/utenti: al più una volta l'ora; un'ora e mezza dopo si rilegge, e un comando in errore non svuota la tabella", async () => {
  accendiScheda();
  await giro(spia(USCITE_SCHEDA));
  const s2 = spia(USCITE_SCHEDA);
  await giro(s2, ora(8, 30));
  assert.deepEqual(s2.chiamate, [], "nell'ora: saltato, nessun comando");
  await giro(spia({ ...USCITE_SCHEDA, [COMANDI_MK_SCHEDA.vlan]: async () => "bad command name vlan (line 1 column 12)", [COMANDI_MK_SCHEDA.utenti]: async () => "" }), ora(9, 30));
  assert.deepEqual(righeV3(1), [12, 11, 1, 0], "VLAN in errore restano, utenti letti e vuoti");
  const e = withTenant(T, () => leggiEsiti("mikrotik_scheda"))["1"];
  assert.deepEqual([e.comandi, e.riusciti, e.codice, e.il], [4, 3, "BAD_COMMAND", "2026-10-15 09:30:00"]);
});

test("VLAN/DNS/utenti accesa ma schema sotto il livello 3: nessun comando, esito SCHEMA_SCHEDA", async () => {
  accendiScheda();
  db().exec("ALTER TABLE mikrotik_user RENAME TO mikrotik_user_via");
  try {
    withTenant(T, () => rileggiSchemaSchedaMk());
    const s = spia(USCITE_SCHEDA);
    const r = await giro(s);
    assert.deepEqual(s.chiamate, []);
    const e = withTenant(T, () => leggiEsiti("mikrotik_scheda"))["1"];
    assert.deepEqual([e.comandi, e.riusciti, e.codice], [0, 0, "SCHEMA_SCHEDA"]);
    assert.match(r.phase ?? "", /SCHEMA_SCHEDA/);
  } finally {
    db().exec("ALTER TABLE mikrotik_user_via RENAME TO mikrotik_user");
    withTenant(T, () => rileggiSchemaSchedaMk());
  }
});

test("VLAN/DNS/utenti: il resoconto e i log del giro non portano i nomi degli utenti", async () => {
  accendiScheda();
  const scritti: string[] = [];
  const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  for (const k of ["log", "info", "warn", "error"] as const) console[k] = (...a: unknown[]) => { scritti.push(a.map(String).join(" ")); };
  let r;
  try {
    r = await giro(spia(USCITE_SCHEDA));
  } finally {
    Object.assign(console, orig);
  }
  const tutto = [...scritti, JSON.stringify(r)].join("\n");
  for (const n of ["utente01", "utente02", "utente03", "utente04", "commento 0"]) assert.equal(tutto.includes(n), false, n);
});
