// I33 e R7 (spec topologia §13.5.7 «Chi legge che cosa», §13.12.3, §13.11.3 «Misure sulle copie»): accendere le letture in più
// non cambia la mappa di oggi né le classificazioni degli host, che sono dati di produzione. Il modello di T1 legge una sola
// cosa di ciò che T2 aggiunge: niente. Qui si prova sul DB, con ciò che T2 scrive davvero, in quattro modi:
//   1. a mano: tutto ciò che T2 sa scrivere (fatti di porta e di bridge di ogni lettore, MAC degli apparati, uplink per indice,
//      colonne nuove dei vicini, righe delle fonti nuove, anche verso un host) sopra un tenant, e l'ingresso del modello di
//      oggi, il modello e le classificazioni uguali a prima;
//   2. i giri veri (`runArpPoll`, `syncUnifiForTenant`) con le fixture dei lettori, a letture spente e a letture accese su due
//      tenant uguali: tutto ciò che il modello di T1 e l'attribuzione leggono è uguale, riga per riga; e le prove che la
//      lettura accesa ha scritto davvero (non è un confronto di due tenant vuoti);
//   3. la matrice delle righe di oggi: una fonte nuova sulla chiave di una riga `device`/`unifi` non la prende, non la rinfresca
//      e non la pota (piano di T2, «Scelte» 9), mentre una fonte di oggi pota come prima di T2;
//   4. le reti-campione delle famiglie 1 e 2 caricate nel DB, con le gemelle delle tre fonti nuove su ogni riga (stessa chiave
//      e chiave vicina) e i fatti di ogni apparato.
// Ogni confronto ha la sua controprova (la stessa riga con la fonte di oggi cambia l'attribuzione: così si vede che il confronto la
// vedrebbe) e i mutanti con cui è stata vista fallire sono nel resoconto del Task 13 (filtro del modello, filtro dell'attribuzione,
// WHERE dell'upsert, potatura, MAC noti, colonna di oggi scritta dall'uplink, freno del router).
// Il confronto con «prima di T2» sta in due posti: le impronte del modello su reti-campione e fixture in `cavi-ombra.test.ts`, e
// il giro vero, che il 15/10 (Task 13) è stato lanciato a letture spente sul commit 806319f2 e su T2 con lo stesso risultato in
// ogni parte confrontata qui (ingresso, modello, albero, MAC noti, apparati, porte, vicini, host, evidenze, segnali). Quel
// confronto è senza switch: prima di T2 il client dello switch non si poteva iniettare nel giro, e l'altra metà («spente = prima»
// per gli switch) la provano le spie di `arp-letture-snmp.test.ts` e `arp-letture-mikrotik.test.ts`.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { closeHubDb } from "@/lib/db-hub";
import {
  deleteTenantDatabase, getAttributionSignalsForHost, getIngressoCavi, getNetworkDeviceKnownMacs, getTenantDb, getTopologyModelInput,
  rileggiSchemaCavi, scriviFattiTopologia, setUplinkCavi, upsertNeighbors, withTenant,
} from "@/lib/db-tenant";
import { recomputeAttributionForDb } from "@/lib/attribution/recompute";
import { getActiveEvidence } from "@/lib/attribution/evidence";
import { runArpPoll } from "@/lib/cron/jobs";
import { syncUnifiForTenant, type UnifiDeviceSource } from "@/lib/integrations/unifi-sync";
import { parseStatDeviceResponse } from "@/lib/integrations/unifi-device";
import { COMANDI_MK, type ApriEsecutore } from "@/lib/devices/mikrotik-letture";
import { parseMikrotikNeighbors } from "@/lib/devices/mikrotik-vicini";
import { parseMikrotikInterfaceTypes } from "@/lib/devices/mikrotik-porte";
import type { RouterClient } from "@/lib/devices/router-client";
import type { PortInfo, SwitchClient } from "@/lib/devices/switch-client";
import { TABELLE_SNMP } from "@/lib/devices/snmp-topologia";
import type { LettoreSnmp, VoceSnmp } from "@/lib/devices/snmp-walk";
import {
  fattiMikrotik, parseBridge, parseFasci, parseInterfacce, parseMonitorBridge, parseMonitorFasci, parseMonitorPorte, parsePorteBridge,
} from "@/lib/devices/mikrotik-stp";
import { scriviInterruttore } from "@/lib/topology/letture/interruttori";
import { buildTopologyModel } from "@/lib/topology/model";
import { costruisciModelloCavi } from "@/lib/topology/cavi/modello";
import type { TopologyModelInput } from "@/lib/topology/model-types";
import { soloMikrotik, soloUnifi } from "@/lib/topology/__tests__/support/reti-campione";
import { autoVisible, buildTree, proposeHead } from "@/lib/topology/tree";
import { serializza } from "@/lib/topology/__tests__/support/impronta";
import type { NetworkDevice } from "@/types";

const TENANT_MANO = "TESTT2FRENOM", TENANT_SPENTE = "TESTT2FRENOS", TENANT_ACCESE = "TESTT2FRENOA", TENANT_RETI = "TESTT2FRENOR", TENANT_MATRICE = "TESTT2FRENOX";
const tutti = [TENANT_MANO, TENANT_SPENTE, TENANT_ACCESE, TENANT_RETI, TENANT_MATRICE];
for (const t of tutti) getTenantDb(t); // tutti e tre prima di ogni altra cosa: aprirne uno dopo la nascita del registro conta un «ripiego» nel log
after(() => { for (const t of tutti) deleteTenantDatabase(t); closeHubDb(); removeTestHubDb(); });

const FX = path.join(__dirname, "..", "devices", "__tests__", "fixtures");
const FXU = path.join(__dirname, "..", "integrations", "__tests__", "fixtures");
const F = (n: string): string => fs.readFileSync(path.join(FX, n), "utf8");

// ── L'orologio e il confronto ────────────────────────────────────────────────

/** Un solo «adesso» per tutta la prova: i due tenant del confronto si scrivono a secondi diversi, i dati non devono accorgersene. */
const ADESSO = Date.now();
const sql = (ms: number): string => new Date(ADESSO + ms).toISOString().slice(0, 19).replace("T", " ");
const giorniFa = (n: number): string => sql(-n * 86_400_000);
const DATA = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?$/;

/**
 * Le date scritte dal giro (`datetime('now')` di SQLite: secondi diversi da un tenant all'altro) diventano «adesso»; ogni altra
 * data resta com'è, e quindi una riga vecchia che un lettore rinfrescasse per errore si vedrebbe: da vecchia a «adesso».
 */
function normalizza<T>(x: T): T {
  return JSON.parse(JSON.stringify(x), (_k, v: unknown) => {
    if (typeof v !== "string" || !DATA.test(v)) return v;
    const t = Date.parse(v.includes("T") ? v : `${v.replace(" ", "T")}Z`);
    return Number.isFinite(t) && Math.abs(t - ADESSO) < 30 * 60_000 ? sql(0) : v;
  }) as T;
}

/** Le colonne che T2 aggiunge alle tabelle di oggi: il modello di T1 non le legge, quindi il confronto non le guarda. */
const COLONNE_NUOVE = new Set(["discovered_by", "local_port_index", "remote_port_index", "remote_caps", "uplink_local_port_idx", "uplink_source"]);
const senzaNuove = (r: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(r).filter(([k]) => !COLONNE_NUOVE.has(k)));

/**
 * Tutto ciò che la mappa di oggi e l'attribuzione degli host leggono, in una forma confrontabile: l'ingresso del modello (e non
 * solo il modello: un ingresso diverso che il modello non mostra è già una crepa), il modello, l'albero della mappa automatica,
 * i MAC noti che decidono l'abbinamento del controller (I55), le righe di oggi delle tabelle che T1 legge, e l'attribuzione di
 * ogni host dopo un ricalcolo completo (classificazione, colonne `attr_*`, evidenze attive, quante voci di storico).
 */
function fotografia(db: Database.Database) {
  const input = normalizza(getTopologyModelInput(2, ADESSO));
  const modello = buildTopologyModel(input);
  const testa = proposeHead(modello);
  const righe = (query: string): Array<Record<string, unknown>> =>
    (db.prepare(query).all() as Array<Record<string, unknown>>).map((r) => normalizza(senzaNuove(r)));
  for (const h of db.prepare("SELECT id FROM hosts ORDER BY id").all() as Array<{ id: number }>) recomputeAttributionForDb(db, h.id, "manual");
  return {
    input,
    modello: JSON.parse(serializza(modello)) as unknown,
    albero: JSON.parse(serializza(buildTree(modello, autoVisible(modello), testa ? [testa] : []))) as unknown,
    macNoti: getNetworkDeviceKnownMacs(),
    apparati: righe("SELECT * FROM network_devices ORDER BY id"),
    porte: righe("SELECT * FROM switch_ports ORDER BY device_id, port_index"),
    vicini: righe(`SELECT * FROM device_neighbors WHERE source IN ('device', 'unifi')
      ORDER BY device_id, local_port, remote_device_name, remote_port`),
    host: righe(`SELECT id, classification, classification_manual, inferred_device_type, inferred_vendor, inferred_os_family,
      inferred_confidence, attr_vendor, attr_vendor_name, attr_category, attr_os_family, attr_os_name, attr_confidence_vendor,
      attr_confidence_category, attr_confidence_os, attr_min_phase FROM hosts ORDER BY id`),
    evidenze: (db.prepare("SELECT id FROM hosts ORDER BY id").all() as Array<{ id: number }>).map((h) => [h.id,
      getActiveEvidence(db, h.id).map((e) => [e.source, e.dimension, e.claim, e.confidence, e.raw_value])]),
    segnali: (db.prepare("SELECT id FROM hosts ORDER BY id").all() as Array<{ id: number }>).map((h) => [h.id,
      getAttributionSignalsForHost(h.id)?.neighborSightings ?? null]),
    storico: (db.prepare("SELECT COUNT(*) AS n FROM host_classification_history").get() as { n: number }).n,
  };
}

const conta = (db: Database.Database, query: string): number => (db.prepare(query).get() as { n: number }).n;

// ── 1. A mano: tutto ciò che T2 sa scrivere ─────────────────────────────────

test("I33: con tutto ciò che T2 scrive a mano, l'ingresso e il modello di oggi sono identici e le classificazioni non cambiano", () => {
  const db = getTenantDb(TENANT_MANO);
  db.exec(`INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, controller_mac) VALUES
    (1, 'RTR-1', '10.0.0.1', 'router', 'mikrotik', 'ssh', NULL), (2, 'SW-2', '10.0.0.2', 'switch', 'ubiquiti', 'api', '02:00:D0:00:02:00'),
    (3, 'SW-3', '10.0.0.3', 'switch', 'cisco', 'snmp_v2', NULL)`);
  db.exec(`INSERT INTO networks (id, cidr, name) VALUES (1, '10.0.0.0/24', 'lan');
    INSERT INTO hosts (id, network_id, ip, mac, hostname, classification, status) VALUES
      (10, 1, '10.0.0.50', '02:00:00:00:50:01', 'telefono-1', 'workstation', 'online'),
      (11, 1, '10.0.0.51', '02:00:00:00:51:01', 'pc-2', 'workstation', 'online'),
      (12, 1, '10.0.0.52', '02:00:00:00:52:01', 'pc-3', 'workstation', 'online')`);
  withTenant(TENANT_MANO, () => {
    rileggiSchemaCavi();
    upsertNeighbors(1, [{ localPort: "ether2,bridge", remoteDevice: "SW-2", remotePort: "Port 1", protocol: "lldp", remoteMac: "02:00:D0:00:02:00" }]);
    upsertNeighbors(2, [{ localPort: "Port 1", remoteDevice: "RTR-1", remotePort: "bridge/ether2", protocol: "lldp" }], "unifi");
    // Una riga di oggi che vede un host con una piattaforma: l'attribuzione la legge (è la controprova di sotto).
    upsertNeighbors(2, [{ localPort: "Port 9", remoteDevice: "PC-3", remotePort: "eth0", protocol: "lldp", remoteIp: "10.0.0.52", remotePlatform: "Cisco IOS Software" }], "unifi");
  });
  const prima = withTenant(TENANT_MANO, () => fotografia(db));
  assert.ok(prima.segnali.some(([id, s]) => id === 12 && (s as unknown[]).length === 1), "la riga di oggi arriva all'attribuzione");

  withTenant(TENANT_MANO, () => {
    scriviFattiTopologia(1, "device", fattiMikrotik({
      interfacce: parseInterfacce(F("mikrotik-mk2-testa.txt")), bridge: parseBridge(F("mikrotik-mk3-testa.txt")),
      porteBridge: parsePorteBridge(F("mikrotik-mk4-testa.txt")), monitorBridge: parseMonitorBridge(F("mikrotik-mk5-testa.txt")),
      monitorPorte: parseMonitorPorte(F("mikrotik-mk6-testa.txt")), fasci: parseFasci(F("mikrotik-mk8a-testa.txt")),
      monitorFasci: parseMonitorFasci(F("mikrotik-mk8b-testa.txt")),
    }));
    scriviFattiTopologia(2, "controller", {
      porte: [{ port_key: "i:1", port_name: "Port 1", port_index: 1, if_kind: "physical", running: 1, stp_state: "forwarding" }],
      bridge: [{ bridge_name: "", instance: 0, protocol: "rstp", priority: 32768, root_id: "02:00:d0:00:02:00" }],
      macs: [{ mac: "02:00:D0:00:02:01", port_key: null }],
    });
    scriviFattiTopologia(3, "snmp", { porte: [{ port_key: "i:10101", port_name: "Gi1/0/1", port_index: 10101, if_kind: "lag", stp_state: "discarding" }], bridge: [], macs: [] });
    scriviFattiTopologia(3, "host", { porte: [{ port_key: "n:nic0", port_name: "nic0", lag_state: "attivo" }], bridge: [], macs: [{ mac: "02:00:00:00:50:09", port_key: "n:nic0" }] });
    setUplinkCavi(2, 1, "lldp_uplink");
    // Le righe delle fonti nuove, anche verso gli host che una piattaforma «router» farebbe cambiare categoria se l'attribuzione le leggesse.
    upsertNeighbors(3, [{ localPort: "Gi1/0/1", remoteDevice: "telefono-1", remotePort: "Port 1", protocol: "cdp", remoteMac: "02:00:00:00:50:01",
      remotePlatform: "MikroTik RouterOS", localPortIndex: 10101, remoteCaps: "router" }], "snmp");
    upsertNeighbors(1, [{ localPort: "ether7", remoteDevice: "pc-2", remotePort: "Gi1/0/2", protocol: "lldp", remoteIp: "10.0.0.51",
      remotePlatform: "MikroTik RouterOS", discoveredBy: "lldp", remoteCaps: "router" }], "ssh");
    upsertNeighbors(3, [{ localPort: "nic0", remoteDevice: "SW-3", remotePort: "Gi1/0/3", protocol: "lldp", remoteIp: "10.0.0.50", remotePlatform: "MikroTik RouterOS" }], "host");
  });
  // Le colonne nuove sulle righe di oggi, con l'istruzione a parte del writer (non sposta il timestamp).
  db.exec("UPDATE device_neighbors SET discovered_by = 'cdp,lldp,mndp', remote_caps = 'bridge,router', local_port_index = 2, remote_port_index = 1 WHERE source IN ('device', 'unifi')");
  db.exec("UPDATE network_devices SET uplink_local_port_idx = 3, uplink_source = 'lldp_uplink'");

  // Non è un confronto di due tenant vuoti: T2 ha scritto, e il suo ingresso lo vede.
  const ing = withTenant(TENANT_MANO, () => getIngressoCavi(2, ADESSO));
  assert.ok(ing.fattiPorta.length > 20 && ing.fattiBridge.length >= 2 && ing.macApparati.length >= 2, "i fatti di T2 ci sono");
  assert.deepEqual([...new Set(ing.vicini.map((v) => v.source))].sort(), ["host", "snmp", "ssh", "unifi", "device"].sort());
  assert.equal(serializza(normalizza(ing.t1)), serializza(normalizza(withTenant(TENANT_MANO, () => getTopologyModelInput(2, ADESSO)))), "l'ingresso di T1 dentro quello di T2 è lo stesso");

  const dopo = withTenant(TENANT_MANO, () => fotografia(db));
  for (const parte of Object.keys(prima) as Array<keyof typeof prima>) assert.deepEqual(dopo[parte], prima[parte], `«${parte}» è cambiato`);

  // Controprova: la stessa riga con la fonte di oggi ha cambiato l'attribuzione (altrimenti il confronto non vedrebbe niente).
  db.exec("UPDATE device_neighbors SET source = 'device' WHERE source = 'snmp'");
  const contro = withTenant(TENANT_MANO, () => fotografia(db));
  assert.notDeepEqual(contro.evidenze, prima.evidenze, "con la fonte di oggi l'attribuzione cambia: il confronto sopra lo avrebbe visto");
});

// ── 2. I giri veri, a letture spente e accese ───────────────────────────────

const COMANDI_RISPOSTA: Record<string, string> = {
  [COMANDI_MK.interfacce]: F("mikrotik-mk2-testa.txt"), [COMANDI_MK.bridge]: F("mikrotik-mk3-testa.txt"),
  [COMANDI_MK.porteBridge]: F("mikrotik-mk4-testa.txt"), [COMANDI_MK.monitorBridge]: F("mikrotik-mk5-testa.txt"),
  [COMANDI_MK.monitorPorte]: F("mikrotik-mk6-testa.txt"), [COMANDI_MK.fasci]: F("mikrotik-mk8a-testa.txt"),
  [COMANDI_MK.monitorFasci]: F("mikrotik-mk8b-testa.txt"),
};
/** Un vicino che vede solo lo switch MikroTik (non il router): l'host che lo conferma è raggiungibile solo dalla fonte `ssh`. */
const VICINO_SOLO_SSH = " 9 interface=ether5 address=10.0.9.77 address4=10.0.9.77 mac-address=02:00:00:00:E7:01 identity=TELEFONO-1 platform=MikroTik version=7.21.3 (stable) unpack=none age=9s interface-name=bridge/ether5 system-caps= system-caps-enabled= discovered-by=lldp\r\n";
const VICINI_ROUTER = F("mikrotik-ip-neighbor-terse.txt");
const SNMP = TABELLE_SNMP;
const IP_SOLO_SNMP = [10, 0, 9, 78];

const vb = (oid: string, value: VoceSnmp["value"]): VoceSnmp => ({ oid, value });
/** Uno switch con una porta, un vicino LLDP e un annuncio CDP di un host che solo SNMP vede (forma delle MIB, valori inventati). */
const VOCI_SNMP: VoceSnmp[] = [
  vb(`${SNMP.interfacce}.2.3`, "GigabitEthernet1/0/3"), vb(`${SNMP.interfacce}.3.3`, 6), vb(`${SNMP.interfacce}.6.3`, Buffer.from([2, 0, 0xc, 0, 0, 3])), vb(`${SNMP.interfacce}.8.3`, 1),
  vb(`${SNMP.base}.1.0`, Buffer.from([2, 0, 0xc, 0, 0, 0x40])), vb(`${SNMP.base}.4.1.2.3`, 3),
  vb(`${SNMP.stp}.2.0`, 32768), vb(`${SNMP.stp}.5.0`, Buffer.from([0x10, 0, 2, 0, 0xc, 0, 0, 0x99])), vb(`${SNMP.stp}.6.0`, 4), vb(`${SNMP.stp}.7.0`, 3),
  vb(`${SNMP.stp}.16.0`, 2), vb(`${SNMP.stp}.15.1.3.3`, 5),
  vb(`${SNMP.lldpRemoti}.4.0.3.1`, 4), vb(`${SNMP.lldpRemoti}.5.0.3.1`, Buffer.from([2, 0, 0xc, 0, 0, 0x99])), vb(`${SNMP.lldpRemoti}.6.0.3.1`, 5),
  vb(`${SNMP.lldpRemoti}.7.0.3.1`, "Gi1/0/48"), vb(`${SNMP.lldpRemoti}.9.0.3.1`, "SW-CENTRO"),
  vb(`${SNMP.cdp}.6.3.1`, "TELEFONO-2"), vb(`${SNMP.cdp}.7.3.1`, "eth0"), vb(`${SNMP.cdp}.8.3.1`, "MikroTik RouterOS"), vb(`${SNMP.cdp}.4.3.1`, Buffer.from(IP_SOLO_SNMP)),
];

const PORTE_FINTE: Record<number, PortInfo[]> = {
  2: [1, 2, 3].map((i) => ({ port_index: i, port_name: `sfp-sfpplus${i}`, status: "up", speed: "10000 Mbps", duplex: null, vlan: null, poe_status: null, poe_power_mw: null,
    trunk_neighbor_name: null, trunk_neighbor_port: null, stp_state: null })),
  5: [1, 2, 3].map((i) => ({ port_index: i, port_name: `GigabitEthernet1/0/${i}`, status: "up", speed: "1000 Mbps", duplex: null, vlan: null, poe_status: null, poe_power_mw: null,
    trunk_neighbor_name: null, trunk_neighbor_port: null, stp_state: i === 3 ? "forwarding" : null })),
};

function routerFinto(): RouterClient {
  const mk2 = F("mikrotik-mk2-testa.txt");
  return {
    async getArpTable() { return []; },
    async testConnection() { return true; },
    async getNeighbors() { return parseMikrotikNeighbors(VICINI_ROUTER); },
    async getBridgeHosts() { return []; },
    async getInterfaceTypes() { return parseMikrotikInterfaceTypes(mk2); },
    ultimaUscitaInterfacce() { return mk2; },
    async getPortSchema() { return []; },
  };
}
const switchFinto = async (device: NetworkDevice): Promise<SwitchClient> => ({
  async getMacTable() { return []; },
  async getPortSchema() { return PORTE_FINTE[device.id] ?? []; },
  async testConnection() { return true; },
});
const apriFinto: ApriEsecutore = async (device, fn) => fn(async (cmd) => {
  if (cmd === COMANDI_MK.vicini) return device.id === 2 ? VICINI_ROUTER + VICINO_SOLO_SSH : VICINI_ROUTER;
  if (!(cmd in COMANDI_RISPOSTA)) throw new Error(`comando inatteso: ${cmd}`);
  return COMANDI_RISPOSTA[cmd];
});
const creaWalkFinto = async (): Promise<LettoreSnmp> => Object.assign(async (oid: string) => VOCI_SNMP.filter((v) => v.oid.startsWith(`${oid}.`)), {
  get: async (lista: string[]) => VOCI_SNMP.filter((v) => lista.includes(v.oid)),
});
const sorgenteUnifi = (): UnifiDeviceSource => ({ async listDevices() { return parseStatDeviceResponse(JSON.parse(fs.readFileSync(path.join(FXU, "unifi-stat-device.json"), "utf8")) as unknown); } });

/** Un vicino di oggi sulla stessa chiave di ciò che il lettore scrive (R7: la riga resta `device`, e vecchia). */
const CHIAVE_SSH = (() => {
  const n = parseMikrotikNeighbors(VICINI_ROUTER).find((x) => x.remoteDevice === "CORE-1" && x.localPort.startsWith("sfp-sfpplus1"));
  assert.ok(n, "la fixture ha il vicino");
  return n;
})();

/**
 * La stessa rete in un tenant, con le letture spente o accese. Router MikroTik via SSH (1), switch MikroTik via SSH (2), switch
 * Cisco via SNMP (5), gli apparati del controller (dalla fixture) e quattro host: uno visto solo dalla fonte `ssh`, uno solo
 * da `snmp`, uno da una fonte di oggi, uno da nessuno. Dopo i giri, un ricalcolo completo dell'attribuzione e la fotografia.
 */
async function giri(tenant: string, accese: boolean): Promise<ReturnType<typeof fotografia>> {
  const db = getTenantDb(tenant);
  db.exec(`INSERT INTO networks (id, cidr, name) VALUES (1, '10.0.9.0/24', 'LAN prova');
    INSERT INTO hosts (id, network_id, ip, mac, hostname, classification, status) VALUES
      (50, 1, '10.0.9.77', '02:00:00:00:E7:01', 'telefono-1', 'workstation', 'online'),
      (51, 1, '10.0.9.78', NULL, 'telefono-2', 'workstation', 'online'),
      (52, 1, '10.0.9.2', '02:00:00:00:B2:01', 'rtr-riserva', 'workstation', 'online'),
      (53, 1, '10.0.9.99', '02:00:00:00:E9:01', 'pc-solo', 'workstation', 'online')`);
  db.exec(`INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, enabled, use_for_arp_poll) VALUES
      (1, 'RTR-1', '192.0.2.1', 'router', 'mikrotik', 'ssh', 1, 1), (2, 'SW-2', '192.0.2.2', 'switch', 'mikrotik', 'ssh', 1, 0)`);
  db.exec(`INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, enabled, use_for_arp_poll, community_string)
    VALUES (5, 'SW-5', '192.0.2.5', 'switch', 'cisco', 'snmp_v2', 1, 0, 'public')`);
  // Le righe di oggi già nel DB, vecchie, sulla stessa chiave di ciò che i lettori nuovi scrivono, e quelle da potare.
  const vicino = db.prepare(`INSERT INTO device_neighbors (device_id, local_port, remote_device_name, remote_port, protocol, remote_ip, remote_mac, remote_platform, source, first_seen, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  vicino.run(2, CHIAVE_SSH.localPort, CHIAVE_SSH.remoteDevice, CHIAVE_SSH.remotePort, "lldp", null, null, null, "device", giorniFa(5), giorniFa(3));
  vicino.run(5, "GigabitEthernet1/0/3", "SW-CENTRO", "Gi1/0/48", "lldp", null, null, null, "device", giorniFa(5), giorniFa(3));
  vicino.run(2, "ether1", "VECCHIO-A", "Port 1", "lldp", null, null, null, "device", giorniFa(120), giorniFa(91));
  vicino.run(5, "Gi1/0/1", "VECCHIO-B", "Port 1", "lldp", null, null, null, "device", giorniFa(120), giorniFa(91));
  vicino.run(2, "ether2", "VECCHIO-C", "Port 1", "lldp", null, null, null, "ssh", giorniFa(120), giorniFa(91));
  vicino.run(5, "Gi1/0/2", "VECCHIO-D", "Port 1", "lldp", null, null, null, "snmp", giorniFa(120), giorniFa(91));
  if (accese) withTenant(tenant, () => { for (const l of ["mikrotik", "controller", "snmp"] as const) scriviInterruttore(l, true, "admin"); });

  await withTenant(tenant, () => syncUnifiForTenant({ source: sorgenteUnifi() }));
  const ora = new Date(ADESSO);
  await withTenant(tenant, () => runArpPoll(null, { skipDhcpLeases: true, creaClientRouter: async () => routerFinto(), creaClientSwitch: switchFinto,
    apriEsecutore: apriFinto, creaWalkSnmp: creaWalkFinto, adesso: () => ora }));
  return withTenant(tenant, () => fotografia(db));
}

/** I due giri si fanno una volta sola, nell'ordine: le prove che seguono li leggono (e una prova sola, con `--test-name-pattern`, funziona). */
let giriFatti: Promise<{ spente: ReturnType<typeof fotografia>; accese: ReturnType<typeof fotografia> }> | null = null;
const dueGiri = (): NonNullable<typeof giriFatti> =>
  (giriFatti ??= (async () => ({ spente: await giri(TENANT_SPENTE, false), accese: await giri(TENANT_ACCESE, true) }))());

test("giri veri: a letture accese tutto ciò che la mappa di oggi e l'attribuzione leggono è uguale alle letture spente", async () => {
  const { spente, accese } = await dueGiri();
  const ds = getTenantDb(TENANT_SPENTE), da = getTenantDb(TENANT_ACCESE);

  // Non sono due tenant vuoti: a letture spente T2 non scrive niente, a letture accese sì, dalle tre vie.
  const tabelleNuove = "(SELECT COUNT(*) FROM topology_port_facts) + (SELECT COUNT(*) FROM topology_bridge_facts) + (SELECT COUNT(*) FROM topology_device_macs)";
  assert.equal(conta(ds, `SELECT ${tabelleNuove} AS n`), 0);
  assert.equal(conta(ds, "SELECT COUNT(*) AS n FROM device_neighbors WHERE source NOT IN ('device', 'unifi') AND timestamp > datetime('now', '-1 day')"), 0);
  assert.equal(conta(ds, "SELECT COUNT(discovered_by) + COUNT(remote_caps) + COUNT(local_port_index) + COUNT(remote_port_index) AS n FROM device_neighbors"), 0);
  assert.equal(conta(ds, "SELECT COUNT(uplink_local_port_idx) + COUNT(uplink_source) AS n FROM network_devices"), 0);
  for (const fonte of ["device", "snmp", "controller"]) assert.ok(conta(da, `SELECT COUNT(*) AS n FROM topology_port_facts WHERE source = '${fonte}'`) > 0, `fatti di porta ${fonte}`);
  assert.ok(conta(da, "SELECT COUNT(*) AS n FROM topology_bridge_facts") > 0 && conta(da, "SELECT COUNT(*) AS n FROM topology_device_macs") > 0);
  for (const fonte of ["ssh", "snmp"]) {
    assert.ok(conta(da, `SELECT COUNT(*) AS n FROM device_neighbors WHERE source = '${fonte}' AND timestamp > datetime('now', '-1 day')`) > 0, `vicini ${fonte}`);
  }
  assert.ok(conta(da, "SELECT COUNT(discovered_by) AS n FROM device_neighbors WHERE source IN ('device', 'unifi')") > 0, "colonne nuove sulle righe di oggi");
  assert.ok(conta(da, "SELECT COUNT(local_port_index) AS n FROM device_neighbors WHERE source = 'unifi'") > 0, "indici dei vicini del controller");
  assert.ok(conta(da, "SELECT COUNT(uplink_source) AS n FROM network_devices") > 0, "uplink per indice del controller");

  for (const parte of Object.keys(spente) as Array<keyof typeof spente>) assert.deepEqual(accese[parte], spente[parte], `«${parte}»: le letture accese l'hanno cambiato`);

  // Le righe di oggi sulla stessa chiave non cambiano né fonte né data, e la potatura di una fonte nuova tocca solo le sue.
  const riga = (db: Database.Database, dev: number, porta: string, remoto: string) => db.prepare(
    "SELECT source, timestamp FROM device_neighbors WHERE device_id = ? AND local_port = ? AND remote_device_name = ?").get(dev, porta, remoto);
  assert.deepEqual(riga(da, 2, CHIAVE_SSH.localPort, CHIAVE_SSH.remoteDevice), { source: "device", timestamp: giorniFa(3) }, "ssh sulla chiave di una riga device: resta device, e vecchia");
  assert.deepEqual(riga(da, 5, "GigabitEthernet1/0/3", "SW-CENTRO"), { source: "device", timestamp: giorniFa(3) }, "snmp sulla chiave di una riga device: resta device, e vecchia");
  assert.deepEqual(riga(da, 2, "ether1", "VECCHIO-A"), { source: "device", timestamp: giorniFa(91) }, "la lettura ssh non pota il vicino device di 91 giorni");
  assert.deepEqual(riga(da, 5, "Gi1/0/1", "VECCHIO-B"), { source: "device", timestamp: giorniFa(91) }, "la lettura snmp non pota il vicino device di 91 giorni");
  assert.equal(riga(da, 2, "ether2", "VECCHIO-C"), undefined, "la lettura ssh pota le sue righe vecchie");
  assert.equal(riga(da, 5, "Gi1/0/2", "VECCHIO-D"), undefined, "la lettura snmp pota le sue righe vecchie");
  assert.deepEqual(riga(ds, 2, "ether2", "VECCHIO-C"), { source: "ssh", timestamp: giorniFa(91) }, "a letture spente nessuno pota");
});

test("giri veri, attribuzione: l'host che solo una fonte nuova vede non cambia classificazione; con la fonte di oggi sì", async () => {
  await dueGiri();
  const db = getTenantDb(TENANT_ACCESE);
  const sighting = (hostId: number): unknown[] => withTenant(TENANT_ACCESE, () => getAttributionSignalsForHost(hostId)?.neighborSightings ?? []);
  const cdpLldp = (hostId: number) => getActiveEvidence(db, hostId).filter((e) => e.source === "lldp" || e.source === "cdp");

  // 50 lo vede solo la fonte ssh dello switch MikroTik, 51 solo la fonte snmp; 52 lo vede il router (fonte device).
  assert.equal(conta(db, "SELECT COUNT(*) AS n FROM device_neighbors WHERE source = 'ssh' AND remote_ip = '10.0.9.77'"), 1, "la riga ssh c'è");
  assert.equal(conta(db, "SELECT COUNT(*) AS n FROM device_neighbors WHERE source = 'snmp' AND remote_ip = '10.0.9.78'"), 1, "la riga snmp c'è");
  assert.equal(conta(db, "SELECT COUNT(*) AS n FROM device_neighbors WHERE source IN ('device', 'unifi') AND (remote_ip IN ('10.0.9.77', '10.0.9.78') OR remote_mac = '02:00:00:00:E7:01')"), 0);
  const classi = (): unknown => db.prepare("SELECT id, classification FROM hosts ORDER BY id").all();
  const prima = classi();
  assert.deepEqual([sighting(50), sighting(51), cdpLldp(50), cdpLldp(51)], [[], [], [], []], "le fonti nuove non arrivano all'attribuzione");
  assert.ok(sighting(52).length > 0 && cdpLldp(52).length > 0, "la fonte di oggi sì: il router vede 52");
  assert.deepEqual((prima as Array<{ id: number; classification: string }>).filter((h) => h.id === 50 || h.id === 51).map((h) => h.classification), ["workstation", "workstation"]);

  // Controprova: le stesse due righe con la fonte di oggi, e le due classificazioni cambiano. Il confronto le vedrebbe.
  db.exec("UPDATE device_neighbors SET source = 'device' WHERE source IN ('ssh', 'snmp') AND remote_ip IN ('10.0.9.77', '10.0.9.78')");
  for (const id of [50, 51]) recomputeAttributionForDb(db, id, "manual");
  assert.ok(sighting(50).length > 0 && sighting(51).length > 0 && cdpLldp(50).length > 0 && cdpLldp(51).length > 0);
  assert.notDeepEqual(classi(), prima, "con la fonte di oggi la classificazione dei due host cambia");
});

// ── 3. La matrice delle righe di oggi: stessa chiave e potatura ─────────────

const NUOVE_FONTI = ["ssh", "snmp", "host"] as const;
const FONTI_DI_OGGI = ["device", "unifi"] as const;

test("R7, matrice: una fonte nuova sulla chiave di una riga di oggi non la prende né la rinfresca, e non la pota; una fonte di oggi pota come prima", () => {
  const db = getTenantDb(TENANT_MATRICE);
  db.exec("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol) VALUES (1, 'SW-1', '10.0.0.1', 'switch', 'cisco', 'snmp_v2')");
  const inserisci = db.prepare(`INSERT INTO device_neighbors (device_id, local_port, remote_device_name, remote_port, protocol, source, first_seen, timestamp)
    VALUES (1, ?, ?, ?, 'lldp', ?, ?, ?)`);
  // Per ogni fonte di oggi: una riga di 3 giorni (sulla chiave che le fonti nuove riscrivono) e una di 91 (da potare, per chi può).
  for (const f of FONTI_DI_OGGI) {
    inserisci.run(`${f}-p3`, `VICINO-${f}`, "Port 1", f, giorniFa(5), giorniFa(3));
    inserisci.run(`${f}-p91`, `VECCHIO-${f}`, "Port 1", f, giorniFa(120), giorniFa(91));
  }
  const oggi = (): unknown => db.prepare(`SELECT local_port, source, timestamp FROM device_neighbors
    WHERE source IN ('device', 'unifi') ORDER BY local_port`).all();
  const input = (): unknown => normalizza(withTenant(TENANT_MATRICE, () => getTopologyModelInput(2, ADESSO)));
  const prima = { righe: oggi(), input: input() };
  for (const nuova of NUOVE_FONTI) {
    withTenant(TENANT_MATRICE, () => {
      rileggiSchemaCavi();
      upsertNeighbors(1, FONTI_DI_OGGI.flatMap((f) => [
        { localPort: `${f}-p3`, remoteDevice: `VICINO-${f}`, remotePort: "Port 1", protocol: "lldp", localPortIndex: 3, remoteCaps: "bridge" },
        { localPort: `${nuova}-mia`, remoteDevice: "NUOVO", remotePort: "Port 1", protocol: "lldp", localPortIndex: 4 },
      ]), nuova);
    });
    assert.deepEqual(oggi(), prima.righe, `${nuova}: le righe di oggi (fonte, data) sono cambiate`);
    assert.deepEqual(input(), prima.input, `${nuova}: l'ingresso del modello di oggi è cambiato`);
    assert.equal(conta(db, `SELECT COUNT(*) AS n FROM device_neighbors WHERE source = '${nuova}'`), 1, `${nuova}: scrive le sue righe (una sola chiave: ${nuova}-mia)`);
    // ...e neanche le colonne nuove: l'istruzione a parte guarda la fonte come l'INSERT (revisione del Task 7 di T2).
    assert.equal(conta(db, "SELECT COUNT(*) AS n FROM device_neighbors WHERE source IN ('device', 'unifi') AND (local_port_index IS NOT NULL OR remote_caps IS NOT NULL)"), 0);
    db.exec(`DELETE FROM device_neighbors WHERE source = '${nuova}'`);
  }
  // Una fonte nuova pota solo le sue righe di 91 giorni.
  for (const nuova of NUOVE_FONTI) db.prepare(`INSERT INTO device_neighbors (device_id, local_port, remote_device_name, remote_port, protocol, source, first_seen, timestamp)
    VALUES (1, ?, 'VECCHIO-NUOVA', 'Port 1', 'lldp', ?, ?, ?)`).run(`${nuova}-p91`, nuova, giorniFa(120), giorniFa(91));
  for (const nuova of NUOVE_FONTI) {
    withTenant(TENANT_MATRICE, () => upsertNeighbors(1, [{ localPort: `${nuova}-mia`, remoteDevice: "NUOVO", remotePort: "Port 1", protocol: "lldp" }], nuova));
    assert.equal(conta(db, `SELECT COUNT(*) AS n FROM device_neighbors WHERE source = '${nuova}' AND local_port = '${nuova}-p91'`), 0, `${nuova}: pota la sua riga di 91 giorni`);
  }
  assert.equal(conta(db, "SELECT COUNT(*) AS n FROM device_neighbors WHERE source IN ('device', 'unifi') AND local_port LIKE '%-p91'"), 2, "e non quelle di oggi di 91 giorni");
  assert.deepEqual(oggi(), prima.righe);
  // Contrasto, com'era prima di T2: una fonte di oggi pota tutte le righe vecchie dell'apparato, anche dell'altra fonte di oggi.
  withTenant(TENANT_MATRICE, () => upsertNeighbors(1, [{ localPort: "device-p3", remoteDevice: "VICINO-device", remotePort: "Port 1", protocol: "lldp" }], "device"));
  assert.equal(conta(db, "SELECT COUNT(*) AS n FROM device_neighbors WHERE local_port LIKE '%-p91'"), 0, "una fonte di oggi pota come prima di T2");
});

// ── 4. Le reti-campione sul DB: ogni riga di oggi ha le sue gemelle delle fonti nuove ─────────────

/** Scrive nel tenant le parti di un ingresso del modello che T2 non cambia e che le fonti nuove possono toccare: apparati, reti, host, vicini, porte. */
function caricaRete(db: Database.Database, rete: TopologyModelInput): void {
  db.exec(`DELETE FROM topology_port_facts; DELETE FROM topology_bridge_facts; DELETE FROM topology_device_macs; DELETE FROM device_neighbors;
    DELETE FROM attribution_evidence; DELETE FROM host_classification_history; DELETE FROM switch_ports; DELETE FROM hosts; DELETE FROM networks;
    DELETE FROM network_devices;`);
  for (const n of rete.networks) db.prepare("INSERT INTO networks (id, cidr, name, gateway) VALUES (?, ?, ?, ?)").run(n.id, n.cidr, n.name, n.gateway);
  // Gli host delle reti-campione stanno nella rete 1 se non ne dichiarano nessuna.
  db.exec("INSERT OR IGNORE INTO networks (id, cidr, name) VALUES (1, '10.0.0.0/8', 'rete di prova')");
  for (const d of rete.devices) {
    db.prepare(`INSERT INTO network_devices (id, name, host, device_type, vendor, model, protocol, enabled, controller_mac, uplink_mac, uplink_remote_port, uplink_type, uplink_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(d.id, d.name, d.host, d.device_type, d.vendor, d.model, d.via ?? "ssh", d.enabled, d.controller_mac, d.uplink_mac,
      d.uplink_remote_port, d.uplink_type, d.uplink_seen_at);
  }
  for (const h of rete.hosts) {
    db.prepare("INSERT INTO hosts (id, network_id, ip, mac, hostname, classification, status) VALUES (?, ?, ?, ?, ?, ?, ?)").run(h.id, h.network_id, h.ip, h.mac, h.hostname, h.classification, h.status);
  }
  for (const p of rete.ports ?? []) {
    db.prepare("INSERT INTO switch_ports (device_id, port_index, port_name, status, speed, stp_state) VALUES (?, ?, ?, ?, ?, ?)").run(p.device_id, p.port_index, p.port_name, p.status, p.speed, p.stp_state);
  }
  for (const u of rete.uplinkPorts) db.prepare("UPDATE switch_ports SET is_uplink = 1 WHERE device_id = ? AND port_index = ?").run(u.device_id, u.port_index);
  // I vicini come li scrivono i lettori di oggi (la fonte è quella della riga), una ora fa: freschi.
  const insVicino = db.prepare(`INSERT INTO device_neighbors (device_id, local_port, remote_device_name, remote_port, protocol, remote_ip, remote_mac, remote_platform, source, first_seen, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const n of rete.neighbors) {
    insVicino.run(n.device_id, n.local_port, n.remote_device_name, n.remote_port, n.protocol, n.remote_ip, n.remote_mac, n.remote_platform ?? null, n.source, sql(-7_200_000), sql(-3_600_000));
  }
}

for (const [nome, rete] of [["famiglia 1 · solo MikroTik", soloMikrotik], ["famiglia 2 · solo UniFi", soloUnifi]] as const) {
  test(`${nome}, letture accese sul DB: ogni riga ha le gemelle delle tre fonti nuove sulla stessa chiave, i fatti di ogni apparato; la mappa di oggi è quella di prima`, () => {
    const input = rete();
    const db = getTenantDb(TENANT_RETI);
    caricaRete(db, input);
    const prima = withTenant(TENANT_RETI, () => fotografia(db));
    assert.ok(prima.vicini.length === input.neighbors.length && prima.apparati.length === input.devices.length, "la rete è nel DB");

    withTenant(TENANT_RETI, () => {
      rileggiSchemaCavi();
      for (const d of input.devices) {
        const porte = (input.ports ?? []).filter((p) => p.device_id === d.id);
        scriviFattiTopologia(d.id, d.controller_mac ? "controller" : "device", {
          porte: porte.map((p) => ({ port_key: `i:${p.port_index}`, port_name: p.port_name, port_index: p.port_index, if_kind: "physical", running: 1, stp_state: "forwarding", stp_role: "designated" })),
          bridge: [{ bridge_name: "", instance: 0, protocol: "rstp", priority: 32768, bridge_id: `32768.02:00:fe:00:${String(d.id).padStart(2, "0")}:00`, root_id: "0.02:00:fe:00:03:00" }],
          macs: [{ mac: `02:00:FE:00:${String(d.id).padStart(2, "0")}:01`, port_key: null }],
        });
        if (d.uplink_mac) setUplinkCavi(d.id, d.uplink_remote_port ?? 1, "lldp_uplink");
      }
      for (const nuova of NUOVE_FONTI) {
        for (const d of input.devices) {
          const righe = input.neighbors.filter((n) => n.device_id === d.id);
          if (righe.length === 0) continue;
          // Per ogni riga di oggi, due gemelle con una piattaforma che farebbe cambiare la categoria di un host e le colonne nuove:
          // sulla STESSA chiave (la riga di oggi resta, e prende solo le colonne nuove) e su una chiave vicina, una per fonte (una riga nuova della
          // fonte nuova, che l'attribuzione leggerebbe se la leggesse; la chiave non contiene la fonte, due fonti non la dividono).
          const gemella = (n: (typeof righe)[number], remotePort: string) => ({ localPort: n.local_port, remoteDevice: n.remote_device_name, remotePort,
            protocol: "cdp", remoteIp: n.remote_ip ?? undefined, remoteMac: n.remote_mac ?? undefined, remotePlatform: "Cisco IOS Software",
            discoveredBy: "cdp,lldp", localPortIndex: 3, remotePortIndex: 4, remoteCaps: "router" });
          upsertNeighbors(d.id, righe.flatMap((n) => [gemella(n, n.remote_port), gemella(n, `${n.remote_port}~${nuova}`)]), nuova);
        }
      }
    });
    // T2 ha scritto davvero: il suo ingresso vede i fatti, e il modello per cavo in ombra si costruisce sul DB.
    const ing = withTenant(TENANT_RETI, () => getIngressoCavi(2, ADESSO));
    assert.ok(ing.fattiPorta.length > 0 && ing.fattiBridge.length === input.devices.length && ing.macApparati.length >= input.devices.length);
    for (const nuova of NUOVE_FONTI) assert.ok(ing.vicini.filter((v) => v.source === nuova).length >= input.neighbors.length / 2, `${nuova}: le righe nuove ci sono`);
    assert.ok(ing.vicini.filter((v) => FONTI_DI_OGGI.some((f) => f === v.source)).every((v) => v.remote_caps == null), "le colonne nuove non sono arrivate sulle righe di oggi (R7)");
    const modello = withTenant(TENANT_RETI, () => buildTopologyModel(getTopologyModelInput(2, ADESSO)));
    assert.ok(costruisciModelloCavi(ing, modello, { testaScelta: null }).collegamenti.length > 0);

    const dopo = withTenant(TENANT_RETI, () => fotografia(db));
    for (const parte of Object.keys(prima) as Array<keyof typeof prima>) assert.deepEqual(dopo[parte], prima[parte], `«${parte}» è cambiato`);
  });
}
