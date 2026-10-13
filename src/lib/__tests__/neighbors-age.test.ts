// I vicini non si cancellano a ogni giro (topologia fase 1): un collegamento
// sparito invecchia e diventa «non visto»; due fonti sullo stesso apparato non
// si cancellano a vicenda; pulizia dopo 90 giorni fatta dall'app.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, upsertNeighbors, withTenant } from "@/lib/db-tenant";

const T = "TESTNEIGHAGE";
const db = () => getTenantDb(T);

beforeEach(() => {
  db().exec("DELETE FROM device_neighbors; DELETE FROM network_devices;");
  db().prepare("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol) VALUES (1, 'SW-1', '10.0.0.2', 'switch', 'ubiquiti', 'api'), (2, 'SW-2', '10.0.0.3', 'switch', 'hp', 'snmp_v2')").run();
});
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

const v = (remote: string, port = "Port 1") => ({ localPort: port, remoteDevice: remote, remotePort: "Port 9", protocol: "lldp" });
const righe = (id: number) =>
  db().prepare("SELECT remote_device_name, source, first_seen, timestamp FROM device_neighbors WHERE device_id = ? ORDER BY remote_device_name").all(id) as Array<Record<string, string>>;

test("un vicino che il giro non riporta resta, con la sua data", () => {
  withTenant(T, () => upsertNeighbors(1, [v("RTR-1"), v("AP-1", "Port 2")]));
  db().prepare("UPDATE device_neighbors SET timestamp = '2026-10-01 03:00:00', first_seen = '2026-09-01 03:00:00'").run();
  withTenant(T, () => upsertNeighbors(1, [v("RTR-1")]));
  const r = righe(1);
  assert.equal(r.length, 2);
  const ap = r.find((x) => x.remote_device_name === "AP-1")!;
  const rtr = r.find((x) => x.remote_device_name === "RTR-1")!;
  assert.equal(ap.timestamp, "2026-10-01 03:00:00", "il vicino sparito tiene la data dell'ultima volta");
  assert.notEqual(rtr.timestamp, "2026-10-01 03:00:00", "il vicino rivisto prende la data di adesso");
  assert.equal(rtr.first_seen, "2026-09-01 03:00:00", "first_seen non si sposta");
});

test("due fonti sullo stesso apparato non si cancellano a vicenda", () => {
  withTenant(T, () => upsertNeighbors(1, [v("RTR-1")], "unifi"));
  withTenant(T, () => upsertNeighbors(1, [v("SRV-1", "Port 5")]));
  const r = righe(1);
  assert.deepEqual(r.map((x) => [x.remote_device_name, x.source]), [["RTR-1", "unifi"], ["SRV-1", "device"]]);
});

test("pulizia: oltre 90 giorni si toglie, solo per l'apparato scritto", () => {
  withTenant(T, () => { upsertNeighbors(1, [v("OLD-1")]); upsertNeighbors(2, [v("OLD-2")]); });
  db().prepare("UPDATE device_neighbors SET timestamp = datetime('now', '-91 days')").run();
  withTenant(T, () => upsertNeighbors(1, [v("RTR-1")]));
  assert.deepEqual(righe(1).map((x) => x.remote_device_name), ["RTR-1"]);
  assert.deepEqual(righe(2).map((x) => x.remote_device_name), ["OLD-2"]);
});

test("stessa chiave due volte nello stesso giro: una riga, nessun errore", () => {
  withTenant(T, () => upsertNeighbors(1, [v("RTR-1"), { ...v("RTR-1"), protocol: "cdp" }]));
  assert.equal(righe(1).length, 1);
});
