// I campi del controller per la mappa per cavo (spec topologia §13.5.3): già nella risposta di stat/device, finora letti e
// buttati (local_port_idx, uplink.port_idx, uplink_source) o non letti (stp_version, stp_priority, root_switch,
// ethernet_table, lag_idx, stp_pathcost). Si scrivono solo con `topologia.lettura.controller` accesa; spenta, la
// sincronizzazione scrive esattamente ciò che scriveva prima. Nessuna chiamata nuova al controller: una lettura per giro.
//
// Fixture: `unifi-stat-device.json` (cliente A, 12/10: tre switch, un AP, un Flex Mini offline) e
// `unifi-stat-device-gateway.json` (rete B, 15/10: il gateway del controller dell'hub, reso anonimo con lo script di P5).
import { removeTestHubDb } from "./support/hub-isolato";
import path from "node:path";
import fs from "node:fs";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, rileggiSchemaCavi, withTenant } from "@/lib/db-tenant";
import { parseStatDeviceResponse, type UnifiDevice } from "../unifi-device";
import { buildUnifiMacIndex, mapUnifiFattiCavi, mapUnifiLldp, mapUnifiLldpConIndici } from "../unifi-map";
import { syncUnifiForTenant, type UnifiDeviceSource } from "../unifi-sync";
import { leggiEsiti, scriviInterruttore } from "@/lib/topology/letture/interruttori";
import { LETTURE_SPENTE_SQL } from "@/lib/topology/letture/__tests__/letture-spente";

const T = "TESTUNIFICAVI";
const db = () => getTenantDb(T);
const leggi = (f: string) => parseStatDeviceResponse(JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", f), "utf8")) as unknown);
const devs = () => leggi("unifi-stat-device.json");
const gateway = () => leggi("unifi-stat-device-gateway.json");
/** Il Flex Mini: `USMINI` nella fixture del cliente A, `USF5P` sul controller dell'hub (misurato il 15/10). */
const eFlexMini = (d: UnifiDevice) => /^(USMINI|USF5P)/.test(d.model ?? "");
const conta = (sql: string) => (db().prepare(sql).get() as { n: number }).n;

/** Una sorgente finta che conta le letture del controller: la lettura accesa non ne aggiunge. */
function sorgente(devices: UnifiDevice[]): UnifiDeviceSource & { chiamate: number } {
  const s = { chiamate: 0, async listDevices() { s.chiamate++; return devices; } };
  return s;
}

/** Le colonne di oggi delle tabelle che la sincronizzazione scrive, senza id, ore e colonne nuove: per confrontare due giri. */
function fotografia(): string[] {
  const nomi = new Map((db().prepare("SELECT id, name FROM network_devices").all() as Array<{ id: number; name: string }>).map((r) => [r.id, r.name]));
  const nuove = new Set(["uplink_local_port_idx", "uplink_source", "discovered_by", "local_port_index", "remote_port_index", "remote_caps"]);
  const pulisci = (tab: string, r: Record<string, unknown>) => JSON.stringify([tab, Object.fromEntries(Object.entries(r)
    .filter(([k]) => k !== "id" && !nuove.has(k) && !/(_at|timestamp|first_seen)$/.test(k))
    .map(([k, v]) => [k, k === "device_id" ? nomi.get(v as number) : v]))]);
  return ["network_devices", "switch_ports", "device_neighbors"]
    .flatMap((tab) => (db().prepare(`SELECT * FROM ${tab}`).all() as Array<Record<string, unknown>>).map((r) => pulisci(tab, r)))
    .sort();
}

beforeEach(() => {
  db().exec(`DELETE FROM topology_port_facts; DELETE FROM topology_bridge_facts; DELETE FROM topology_device_macs;
    DELETE FROM device_neighbors; DELETE FROM switch_ports; DELETE FROM network_devices; DELETE FROM hosts;
    DELETE FROM tenant_settings WHERE key LIKE 'topologia.lettura.%';
    ${LETTURE_SPENTE_SQL}`);
  withTenant(T, () => rileggiSchemaCavi());
});
after(() => { deleteTenantDatabase(T); closeHubDb(); removeTestHubDb(); });

test("il parser legge i campi nuovi dalla fixture vera", () => {
  const sw = devs().find((d) => d.model === "US8P60");
  assert.ok(sw);
  assert.deepEqual([sw.stp_version, sw.stp_priority, sw.root_switch, sw.ethernet_table?.length], ["rstp", 32768, "02:00:00:00:00:0a", 2]);
  assert.deepEqual([sw.port_table[0].lag_idx, sw.port_table[0].stp_pathcost], [null, 0]);
  const mini = devs().find(eFlexMini);
  assert.deepEqual([mini?.stp_version, mini?.port_table[0].stp_state], [null, null], "il Flex Mini senza spanning tree");
});

test("i fatti di uno switch del controller: porte per indice, stato, bridge, tutti i MAC", () => {
  const sw = devs().find((d) => d.model === "US8P60");
  assert.ok(sw);
  const f = mapUnifiFattiCavi(sw);
  assert.equal(f.porte.length, sw.port_table.length);
  assert.deepEqual([f.porte[0].port_key, f.porte[0].port_index, f.porte[0].if_kind, f.porte[0].stp_state], ["i:1", 1, "physical", "disabled"]);
  assert.equal(f.bridge.length, 1);
  assert.deepEqual([f.bridge[0].protocol, f.bridge[0].priority, f.bridge[0].root_id], ["rstp", 32768, "02:00:00:00:00:0a"]);
  assert.equal("root_port" in f.bridge[0], false, "il controller non dice la porta radice");
  assert.ok(f.macs.length >= 2);
  assert.deepEqual(mapUnifiFattiCavi(devs().find(eFlexMini)!).bridge, [], "senza spanning tree nessun bridge");
});

test("piano, Scelte punto 8: ogni riga porta le stesse colonne; quelle che il controller non legge mancano da tutte", () => {
  for (const d of [...devs(), ...gateway()]) {
    const f = mapUnifiFattiCavi(d);
    const chiavi = new Set(f.porte.map((p) => Object.keys(p).sort().join(",")));
    assert.ok(chiavi.size <= 1, `${d.model}: righe delle porte con colonne diverse`);
    for (const p of f.porte) for (const c of ["lag_partner", "in_bridge", "bridge", "stp_role", "designated_bridge", "bpdu_rx"]) {
      assert.equal(c in p, false, `${d.model}: «${c}» non è un campo del controller`);
    }
    for (const b of f.bridge) assert.equal("root_port" in b, false);
  }
});

test("un fascio: la porta che aggrega e il membro hanno lo stesso gruppo", () => {
  const sw = devs().find((d) => d.model === "USL24P");
  assert.ok(sw);
  const f = mapUnifiFattiCavi(sw);
  const g = (i: number) => f.porte.find((p) => p.port_index === i)?.lag_group;
  assert.deepEqual([g(23), g(24), g(1)], ["lag:1", "lag:1", null]);
});

test("i vicini con gli indici: la porta locale sempre, la remota quando il vicino è nella risposta e ha quella porta", () => {
  const d = devs();
  const idx = buildUnifiMacIndex(d);
  const sw = d.find((x) => x.model === "US8P60")!;
  const con = mapUnifiLldpConIndici(sw, idx);
  const senza = mapUnifiLldp(sw, idx);
  const senzaIndici = con.map((n) => { const c = { ...n }; delete c.localPortIndex; delete c.remotePortIndex; return c; });
  assert.deepEqual(senzaIndici, senza, "stessi vicini, solo gli indici in più");
  const p6 = con.find((n) => n.localPort === "Port 6");
  assert.deepEqual([p6?.localPortIndex, p6?.remotePortIndex], [6, 14]);
  const p7 = con.find((n) => n.localPort === "Port 7");
  assert.deepEqual([p7?.localPortIndex, "remotePortIndex" in (p7 ?? {})], [7, false], "il vicino annuncia «eth0»: nessun indice remoto");
});

test("la fixture del gateway (P5) si legge: porte, LLDP per indice, uplink e la sua origine", () => {
  const g = gateway();
  const gw = g.find((x) => x.type === "udm" || x.type === "ugw" || x.type === "uxg");
  assert.ok(gw, "c'è il gateway");
  assert.ok(gw.port_table.length > 0);
  // H11: il gateway scrive le sue porte come «ethN», un nome che il suo elenco non ha; l'indice c'è su ogni riga LLDP.
  assert.ok(gw.lldp_table.length > 0 && gw.lldp_table.every((e) => e.local_port_idx !== null), "local_port_idx su ogni riga");
  const vicini = mapUnifiLldpConIndici(gw, buildUnifiMacIndex(g));
  for (const v of vicini) {
    assert.equal(gw.port_table.some((p) => p.name === v.localPort), false, "il nome della porta locale non è nell'elenco");
    assert.ok(gw.port_table.some((p) => p.port_idx === v.localPortIndex), "l'indice sì");
    assert.equal("remotePortIndex" in v, false, "il vicino non è nella risposta");
  }
  assert.deepEqual([gw.uplink?.port_idx !== null, gw.uplink?.uplink_source !== null], [true, true]);
  const f = mapUnifiFattiCavi(gw);
  assert.deepEqual([f.bridge, f.porte.every((p) => p.stp_state === null)], [[], true], "il gateway non dice lo spanning tree");
  assert.equal(new Set(f.macs.map((m) => m.mac)).size, gw.ethernet_table?.length, "i MAC di ethernet_table (il primo è quello dell'apparato)");
  assert.equal(g.some(eFlexMini), false, "il Flex Mini dell'hub non è nella fixture (vedi il resoconto del Task 5)");
});

test("spenta: la sincronizzazione scrive ciò che scriveva prima, niente di nuovo, una lettura del controller", async () => {
  const s = sorgente(devs());
  await withTenant(T, () => syncUnifiForTenant({ source: s }));
  assert.equal(s.chiamate, 1);
  assert.equal(conta("SELECT COUNT(*) AS n FROM topology_port_facts"), 0);
  assert.equal(conta("SELECT COUNT(*) AS n FROM topology_bridge_facts"), 0);
  assert.equal(conta("SELECT COUNT(*) AS n FROM topology_device_macs"), 0);
  assert.equal(conta("SELECT COUNT(local_port_index) AS n FROM device_neighbors"), 0);
  assert.equal(conta("SELECT COUNT(remote_port_index) AS n FROM device_neighbors"), 0);
  assert.equal(conta("SELECT COUNT(uplink_local_port_idx) AS n FROM network_devices"), 0);
  assert.equal(conta("SELECT COUNT(uplink_source) AS n FROM network_devices"), 0);
  assert.deepEqual(withTenant(T, () => leggiEsiti("controller")), {});
});

test("accesa: fatti di fonte controller, indici dei vicini, uplink per indice, esito per apparato connesso", async () => {
  withTenant(T, () => scriviInterruttore("controller", true, "admin"));
  const s = sorgente(devs());
  const r = await withTenant(T, () => syncUnifiForTenant({ source: s }));
  assert.equal(s.chiamate, 1, "nessuna chiamata nuova al controller");
  assert.deepEqual(r.errors, []);
  assert.ok(conta("SELECT COUNT(*) AS n FROM topology_port_facts WHERE source = 'controller'") > 0);
  assert.equal(conta("SELECT COUNT(*) AS n FROM topology_port_facts WHERE source <> 'controller'"), 0);
  assert.ok(conta("SELECT COUNT(*) AS n FROM topology_bridge_facts WHERE source = 'controller' AND root_port IS NULL") > 0);
  assert.ok(conta("SELECT COUNT(*) AS n FROM topology_device_macs WHERE source = 'controller'") > 0);
  assert.ok(conta("SELECT COUNT(local_port_index) AS n FROM device_neighbors") > 0);
  assert.ok(conta("SELECT COUNT(remote_port_index) AS n FROM device_neighbors") > 0);
  assert.ok(conta("SELECT COUNT(uplink_source) AS n FROM network_devices") > 0);
  const esiti = withTenant(T, () => leggiEsiti("controller"));
  const ids = new Map((db().prepare("SELECT id, model FROM network_devices").all() as Array<{ id: number; model: string }>).map((x) => [String(x.id), x.model]));
  assert.ok(Object.keys(esiti).length > 0 && Object.keys(esiti).every((k) => ids.has(k)), "un esito per apparato, e solo per apparati del DB");
  assert.ok(Object.values(esiti).every((e) => e.comandi === 1 && e.riusciti === 1 && e.codice === null));
  const mini = [...ids].find(([, m]) => m === "USMINI")?.[0];
  assert.ok(mini, "il Flex Mini offline è nel DB");
  assert.equal(mini in esiti, false, "offline: niente esito");
  assert.equal(conta(`SELECT COUNT(*) AS n FROM topology_port_facts WHERE device_id = ${Number(mini)}`), 0, "offline: niente fatti");
});

test("accesa aggiunge e basta: le colonne di oggi sono quelle della sincronizzazione spenta", async () => {
  await withTenant(T, () => syncUnifiForTenant({ source: sorgente(devs()) }));
  const spenta = fotografia();
  db().exec("DELETE FROM device_neighbors; DELETE FROM switch_ports; DELETE FROM network_devices;");
  withTenant(T, () => scriviInterruttore("controller", true, "admin"));
  await withTenant(T, () => syncUnifiForTenant({ source: sorgente(devs()) }));
  assert.ok(conta("SELECT COUNT(*) AS n FROM topology_port_facts") > 0, "la lettura accesa ha scritto");
  assert.deepEqual(fotografia(), spenta);
});

test("il gateway con la lettura accesa: uplink per indice e la sua origine, vicini con la porta locale per indice", async () => {
  withTenant(T, () => scriviInterruttore("controller", true, "admin"));
  const g = gateway();
  const gw = g.find((x) => x.type === "udm")!;
  await withTenant(T, () => syncUnifiForTenant({ source: sorgente(g) }));
  const nd = db().prepare("SELECT id, uplink_local_port_idx AS p, uplink_source AS s FROM network_devices").get() as { id: number; p: number; s: string };
  assert.deepEqual([nd.p, nd.s], [gw.uplink?.port_idx, gw.uplink?.uplink_source]);
  const indici = (db().prepare("SELECT local_port_index AS i FROM device_neighbors WHERE device_id = ? ORDER BY 1").all(nd.id) as Array<{ i: number }>).map((x) => x.i);
  assert.deepEqual(indici, gw.lldp_table.map((e) => e.local_port_idx).sort((a, b) => (a ?? 0) - (b ?? 0)));
  assert.equal(conta("SELECT COUNT(*) AS n FROM topology_port_facts"), gw.port_table.length);
  assert.equal(conta("SELECT COUNT(*) AS n FROM topology_bridge_facts"), 0);
});

test("accesa senza lo schema nuovo: niente fatti, la sincronizzazione di oggi passa, e il resoconto lo dice", async () => {
  db().exec("ALTER TABLE device_neighbors DROP COLUMN remote_caps"); // simula lo schema a metà (come I34)
  try {
    withTenant(T, () => { assert.equal(rileggiSchemaCavi(), false); scriviInterruttore("controller", true, "admin"); });
    const r = await withTenant(T, () => syncUnifiForTenant({ source: sorgente(devs()) }));
    assert.ok(r.added > 0);
    assert.equal(conta("SELECT COUNT(*) AS n FROM topology_port_facts"), 0);
    assert.equal(conta("SELECT COUNT(local_port_index) AS n FROM device_neighbors"), 0);
    assert.deepEqual(withTenant(T, () => leggiEsiti("controller")), {});
    assert.ok(r.errors.some((e) => /schema di questo cliente non è aggiornato/.test(e)), "non è un ripiego muto");
  } finally {
    db().exec("ALTER TABLE device_neighbors ADD COLUMN remote_caps TEXT");
  }
});

test("accesa, scrittura dei fatti che fallisce: la sincronizzazione di oggi passa, l'esito porta il codice, il resoconto solo id e codice", async () => {
  await withTenant(T, () => syncUnifiForTenant({ source: sorgente(devs()) }));
  const spenta = fotografia();
  db().exec("DELETE FROM device_neighbors; DELETE FROM switch_ports; DELETE FROM network_devices;");
  db().exec("CREATE TRIGGER prova_t5 BEFORE INSERT ON topology_port_facts BEGIN SELECT RAISE(ABORT, 'prova'); END;");
  try {
    withTenant(T, () => scriviInterruttore("controller", true, "admin"));
    const r = await withTenant(T, () => syncUnifiForTenant({ source: sorgente(devs()) }));
    assert.deepEqual(fotografia(), spenta, "porte, vicini e apparati scritti come a lettura spenta");
    // Il trigger scatta solo dove ci sono porte da scrivere: l'AP della fixture non ne ha, e i suoi fatti passano.
    const esiti = Object.entries(withTenant(T, () => leggiEsiti("controller")));
    const falliti = esiti.filter(([, e]) => e.codice !== null);
    assert.ok(falliti.length > 0 && falliti.length < esiti.length);
    assert.ok(falliti.every(([, e]) => e.riusciti === 0 && e.codice === "SQLITE_CONSTRAINT_TRIGGER"));
    for (const [id] of falliti) {
      assert.equal(conta(`SELECT COUNT(uplink_source) AS n FROM network_devices WHERE id = ${Number(id)}`), 0, "fatti e uplink insieme: tutto o niente");
      assert.equal(conta(`SELECT COUNT(*) AS n FROM topology_device_macs WHERE device_id = ${Number(id)}`), 0);
    }
    const avvisi = r.errors.filter((e) => /mappa per cavo/.test(e));
    assert.equal(avvisi.length, falliti.length);
    assert.ok(avvisi.every((e) => /^apparato #\d+: .*\(SQLITE_CONSTRAINT_TRIGGER\)$/.test(e)), "solo id e codice, niente nomi né IP");
  } finally {
    db().exec("DROP TRIGGER IF EXISTS prova_t5");
  }
});
