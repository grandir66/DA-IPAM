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
  upsertNeighbors,
  withTenant,
} from "@/lib/db-tenant";
import {
  getAttributionSignalsForHost as facadeAttributionSignals,
  getNeighborsByDevice as facadeNeighborsByDevice,
} from "@/lib/db";
import { NEIGHBORS_LATEST_ROUND_SQL as RECOMPUTE_LATEST_ROUND_SQL } from "@/lib/attribution/recompute";

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
