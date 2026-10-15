// Le pagine di oggi (scheda «Neighbors» dell'apparato, vecchia mappa /topology,
// attribuzione) furono scritte quando di ogni apparato esisteva solo l'ultimo
// giro: upsertNeighbors cancellava tutto e riscriveva. Dalla topologia fase 1
// (ADR 0008) le righe restano 90 giorni e invecchiano: quei lettori devono
// vedere solo l'ultimo giro di ogni apparato per fonte, come prima. Il modello
// nuovo (getTopologyModelInput) invece le vede tutte, perché calcola «non visto».
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import {
  deleteTenantDatabase,
  getAttributionSignalsForHost,
  getNeighborsByDevice,
  getTenantDb,
  getTopologyData,
  getTopologyModelInput,
  NEIGHBORS_LATEST_ROUND_SQL,
  NEIGHBORS_MODEL_SOURCES_SQL,
  upsertNeighbors,
  withTenant,
} from "@/lib/db-tenant";
import {
  getAttributionSignalsForHost as facadeAttributionSignals,
  getNeighborsByDevice as facadeNeighborsByDevice,
} from "@/lib/db";
import {
  NEIGHBORS_LATEST_ROUND_SQL as RECOMPUTE_LATEST_ROUND_SQL,
  NEIGHBORS_MODEL_SOURCES_SQL as RECOMPUTE_SOURCES_SQL,
  recomputeAttributionForDb,
} from "@/lib/attribution/recompute";
import { getActiveEvidence } from "@/lib/attribution/evidence";

const T = "TESTNEIGHOLD";
const db = () => getTenantDb(T);
const HOST_MAC = "AA:BB:CC:00:00:01";

beforeEach(() => {
  db().exec("DELETE FROM device_neighbors; DELETE FROM network_devices; DELETE FROM hosts; DELETE FROM networks;");
  db().prepare("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol) VALUES (1, 'SW-1', '10.0.0.2', 'switch', 'ubiquiti', 'api'), (2, 'SW-2', '10.0.0.3', 'switch', 'hp', 'snmp_v2')").run();
  db().prepare("INSERT INTO networks (id, cidr, name, gateway) VALUES (1, '10.0.0.0/24', 'LAN', '10.0.0.1')").run();
  db().prepare("INSERT INTO hosts (id, network_id, ip, mac) VALUES (1, 1, '10.0.0.50', ?)").run(HOST_MAC);
});
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

const v = (remote: string, port: string, mac?: string) => ({
  localPort: port, remoteDevice: remote, remotePort: "Port 9", protocol: "lldp", ...(mac ? { remoteMac: mac } : {}),
});
const invecchia = () => db().prepare("UPDATE device_neighbors SET timestamp = datetime('now', '-3 days')").run();
const nomi = (rows: Array<{ remote_device_name: string }>) => rows.map((r) => r.remote_device_name).sort();

test("un giro più nuovo senza un vicino: le pagine di oggi vedono solo il giro nuovo, il modello nuovo li vede tutti", () => {
  withTenant(T, () => upsertNeighbors(1, [v("RTR-1", "Port 1"), v("AP-1", "Port 2")]));
  invecchia();
  withTenant(T, () => upsertNeighbors(1, [v("RTR-1", "Port 1")]));

  assert.deepEqual(nomi(withTenant(T, () => getNeighborsByDevice(1))), ["RTR-1"], "db-tenant getNeighborsByDevice");
  assert.deepEqual(nomi(withTenant(T, () => facadeNeighborsByDevice(1))), ["RTR-1"], "facade db.ts (lo usa la scheda dell'apparato)");
  const topo = withTenant(T, () => getTopologyData());
  assert.deepEqual(nomi(topo.neighbors.filter((n) => n.device_id === 1)), ["RTR-1"], "vecchia mappa /topology");

  const model = withTenant(T, () => getTopologyModelInput(7));
  assert.deepEqual(nomi(model.neighbors.filter((n) => n.device_id === 1)), ["AP-1", "RTR-1"], "il modello nuovo vede anche il vicino sparito");
});

test("due fonti sullo stesso apparato: ognuna tiene il suo ultimo giro", () => {
  withTenant(T, () => {
    upsertNeighbors(1, [v("U-OLD", "Port 3")], "unifi");
    upsertNeighbors(1, [v("D-1", "Port 4")], "device");
  });
  invecchia();
  withTenant(T, () => upsertNeighbors(1, [v("U-1", "Port 5")], "unifi"));

  // L'ultimo giro della fonte 'device' è quello di tre giorni fa: resta visibile,
  // come con la vecchia DELETE per giro (nessuno l'aveva cancellato).
  assert.deepEqual(nomi(withTenant(T, () => getNeighborsByDevice(1))), ["D-1", "U-1"]);
  assert.deepEqual(nomi(withTenant(T, () => facadeNeighborsByDevice(1))), ["D-1", "U-1"]);
  const topo = withTenant(T, () => getTopologyData());
  assert.deepEqual(nomi(topo.neighbors.filter((n) => n.device_id === 1)), ["D-1", "U-1"]);
  const model = withTenant(T, () => getTopologyModelInput(7));
  assert.deepEqual(nomi(model.neighbors.filter((n) => n.device_id === 1)), ["D-1", "U-1", "U-OLD"]);
});

test("apparati diversi non si influenzano: il giro nuovo di uno non nasconde l'altro", () => {
  withTenant(T, () => upsertNeighbors(2, [v("SRV-2", "Port 7")]));
  invecchia();
  withTenant(T, () => upsertNeighbors(1, [v("RTR-1", "Port 1")]));
  assert.deepEqual(nomi(withTenant(T, () => getNeighborsByDevice(2))), ["SRV-2"]);
  const topo = withTenant(T, () => getTopologyData());
  assert.deepEqual(nomi(topo.neighbors), ["RTR-1", "SRV-2"]);
});

test("attribuzione: un avvistamento uscito dall'ultimo giro non è più evidenza", () => {
  withTenant(T, () => upsertNeighbors(1, [v("PC-50", "Port 8", HOST_MAC), v("RTR-1", "Port 1")]));
  invecchia();
  withTenant(T, () => upsertNeighbors(1, [v("RTR-1", "Port 1")]));
  assert.deepEqual(withTenant(T, () => getAttributionSignalsForHost(1))?.neighborSightings, []);
  assert.deepEqual(withTenant(T, () => facadeAttributionSignals(1))?.neighborSightings, []);

  withTenant(T, () => upsertNeighbors(1, [v("PC-50", "Port 8", HOST_MAC), v("RTR-1", "Port 1")]));
  assert.equal(withTenant(T, () => getAttributionSignalsForHost(1))?.neighborSightings.length, 1, "rivisto: torna evidenza");
});

test("la copia del frammento in recompute.ts è identica all'originale di db-tenant.ts", () => {
  // recompute.ts non può importare db-tenant staticamente (ciclo db-tenant ↔
  // attribution) né dinamicamente (ADR 0002): tiene una copia, che deve restare uguale.
  assert.equal(RECOMPUTE_LATEST_ROUND_SQL, NEIGHBORS_LATEST_ROUND_SQL);
});

// Spec topologia §13.5.7, «Chi legge che cosa» (R7): il modello di T1 e l'attribuzione degli host leggono solo le fonti
// di oggi. Da T2 le letture in più scrivono fonti nuove (snmp, host, ssh): accenderle non deve cambiare né la mappa né
// le classificazioni, che sono dati di produzione. Oggi le fonti sono solo device e unifi: il filtro non cambia niente.
test("fonti nuove: non entrano nel modello di T1 né nell'attribuzione (db-tenant e facciata)", () => {
  withTenant(T, () => upsertNeighbors(1, [v("PC-50", "Port 8", HOST_MAC)]));
  db().prepare(`INSERT INTO device_neighbors (device_id, local_port, remote_device_name, remote_port, protocol, remote_mac, source, first_seen, timestamp)
    VALUES (1, 'Port 9', 'SNMP-X', 'Port 1', 'lldp', ?, 'snmp', datetime('now'), datetime('now'))`).run(HOST_MAC);
  assert.deepEqual(nomi(withTenant(T, () => getTopologyModelInput(7)).neighbors), ["PC-50"]);
  assert.equal(withTenant(T, () => getAttributionSignalsForHost(1))?.neighborSightings.length, 1);
  assert.equal(withTenant(T, () => facadeAttributionSignals(1))?.neighborSightings.length, 1);
});

// Revisione finale di T1: la terza copia della query, quella del ricalcolo da handle (recompute.ts), non aveva una prova sua:
// togliendo il filtro sulle fonti passavano tutte. Da T2, con le fonti snmp, host e ssh, il ricalcolo dell'attribuzione
// leggerebbe righe nuove e cambierebbe la categoria di host di produzione. La riga della fonte nuova ha la piattaforma che
// darebbe una categoria; quella della fonte di oggi no: con il filtro nessuna evidenza dai vicini.
test("fonti nuove: non entrano nemmeno nel ricalcolo dell'attribuzione da handle (recompute.ts)", () => {
  withTenant(T, () => upsertNeighbors(1, [v("PC-50", "Port 8", HOST_MAC)]));
  db().prepare(`INSERT INTO device_neighbors (device_id, local_port, remote_device_name, remote_port, protocol, remote_mac, remote_platform, source, first_seen, timestamp)
    VALUES (1, 'Port 9', 'SNMP-X', 'Port 1', 'lldp', ?, 'MikroTik RouterOS 7.16', 'snmp', datetime('now'), datetime('now'))`).run(HOST_MAC);
  assert.notEqual(recomputeAttributionForDb(db(), 1, "manual"), null);
  const daiVicini = getActiveEvidence(db(), 1).filter((e) => e.source === "lldp" || e.source === "cdp");
  assert.deepEqual(daiVicini.map((e) => e.claim), []);
});

test("la copia del filtro sulle fonti in recompute.ts è identica all'originale di db-tenant.ts", () => {
  assert.equal(RECOMPUTE_SOURCES_SQL, NEIGHBORS_MODEL_SOURCES_SQL);
});

test("ingresso del modello (spec §13.6.1): tutte le porte con l'indice, anche giù; la via di lettura; la piattaforma remota", () => {
  db().exec("DELETE FROM switch_ports");
  db().prepare(`INSERT INTO switch_ports (device_id, port_index, port_name, status, speed, stp_state)
    VALUES (1, 49, 'SFP+ 1', 'up', '10000 Mbps', 'forwarding'), (1, 5, 'Port 5', 'down', NULL, NULL)`).run();
  withTenant(T, () => upsertNeighbors(1, [{ ...v("RTR-1", "Port 1"), remotePlatform: "MikroTik" }]));
  const i = withTenant(T, () => getTopologyModelInput(2));
  assert.deepEqual(i.ports, [
    { device_id: 1, port_index: 5, port_name: "Port 5", speed: null, status: "down", stp_state: null },
    { device_id: 1, port_index: 49, port_name: "SFP+ 1", speed: "10000 Mbps", status: "up", stp_state: "forwarding" },
  ]);
  assert.deepEqual(i.devices.map((d) => [d.id, d.via, d.topology_role]), [[1, "api", null], [2, "snmp_v2", null]]);
  assert.equal(i.neighbors[0].remote_platform, "MikroTik");
});
