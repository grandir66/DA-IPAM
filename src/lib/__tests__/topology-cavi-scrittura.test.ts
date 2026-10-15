// Scrittura dei fatti delle letture in più (spec §13.5.7, «Come si scrive»): INSERT … ON CONFLICT, `seen_at` si sposta,
// `first_seen` resta, le colonne che il lettore non conosce restano com'erano; niente DELETE del giro; potatura a 90
// giorni delle righe dell'apparato, nella stessa transazione. Le colonne nuove dei vicini con un'istruzione a parte, che
// non ferma mai la scrittura dei vicini (I34). I fatti non entrano in switch_ports (I35) né nei MAC noti che decidono
// l'abbinamento del controller (I55).
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import {
  deleteTenantDatabase, getNetworkDeviceKnownMacs, getTenantDb, getTopologyModelInput, rileggiSchemaCavi, schemaCaviPresente,
  scriviFattiTopologia, setUplinkCavi, upsertNeighbors, upsertSwitchPorts, withTenant,
} from "@/lib/db-tenant";
import { buildTopologyModel } from "@/lib/topology/model";

const T = "TESTTOPOCAVISCRIVE";
const db = () => getTenantDb(T);
const ORA = new Date("2026-10-15T10:00:00Z");

beforeEach(() => {
  db().exec(`DELETE FROM topology_port_facts; DELETE FROM topology_bridge_facts; DELETE FROM topology_device_macs;
    DELETE FROM device_neighbors; DELETE FROM switch_ports; DELETE FROM network_devices; DELETE FROM hosts;`);
  db().prepare("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol) VALUES (1, 'RTR-1', '10.0.0.1', 'router', 'mikrotik', 'ssh'), (2, 'SW-2', '10.0.0.2', 'switch', 'ubiquiti', 'api')").run();
  withTenant(T, () => rileggiSchemaCavi());
});
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

const porta = (over: Record<string, unknown> = {}) => ({ port_key: "n:ether2", port_name: "ether2", if_kind: "physical", running: 1, stp_state: "forwarding", ...over });

test("scrive, poi aggiorna: seen_at si sposta, first_seen resta; le colonne che il lettore non conosce restano", () => {
  withTenant(T, () => {
    assert.deepEqual(scriviFattiTopologia(1, "device", { porte: [porta({ stp_role: "designated" })], bridge: [], macs: [] }, ORA), { porte: 1, bridge: 0, macs: 0 });
    const dopo = new Date("2026-10-15T11:00:00Z");
    // Il secondo giro non conosce stp_role (assente da tutte le righe): resta; stp_state letto e vuoto (null): si scrive null.
    scriviFattiTopologia(1, "device", { porte: [{ port_key: "n:ether2", port_name: "ether2", stp_state: null }], bridge: [], macs: [] }, dopo);
  });
  const r = db().prepare("SELECT stp_role, stp_state, if_kind, first_seen, seen_at FROM topology_port_facts").get();
  assert.deepEqual(r, { stp_role: "designated", stp_state: null, if_kind: "physical", first_seen: "2026-10-15 10:00:00", seen_at: "2026-10-15 11:00:00" });
});

test("due lettori dello stesso apparato non si sovrascrivono (la fonte è nella chiave)", () => {
  withTenant(T, () => {
    scriviFattiTopologia(2, "controller", { porte: [porta({ port_key: "i:3", port_name: "Port 3", port_index: 3 })], bridge: [], macs: [] }, ORA);
    scriviFattiTopologia(2, "snmp", { porte: [porta({ port_key: "i:3", port_name: "Port 3", port_index: 3, stp_state: "discarding" })], bridge: [], macs: [] }, ORA);
  });
  assert.deepEqual(db().prepare("SELECT source, stp_state FROM topology_port_facts ORDER BY source").all(),
    [{ source: "controller", stp_state: "forwarding" }, { source: "snmp", stp_state: "discarding" }]);
});

test("potatura: le righe dell'apparato non viste da 90 giorni se ne vanno alla scrittura dopo; quelle di 30 restano", () => {
  db().prepare("INSERT INTO topology_port_facts (device_id, source, port_key, port_name, seen_at) VALUES (1, 'device', 'n:vecchia', 'vecchia', '2026-07-01 10:00:00'), (1, 'device', 'n:recente', 'recente', '2026-09-20 10:00:00')").run();
  db().prepare("INSERT INTO topology_device_macs (device_id, mac, source, seen_at) VALUES (1, '02:00:00:00:00:99', 'device', '2026-07-01 10:00:00')").run();
  withTenant(T, () => scriviFattiTopologia(1, "device", { porte: [porta()], bridge: [], macs: [{ mac: "02:00:00:00:00:01", port_key: "n:ether2" }] }, ORA));
  assert.deepEqual((db().prepare("SELECT port_key FROM topology_port_facts ORDER BY port_key").all() as Array<{ port_key: string }>).map((r) => r.port_key), ["n:ether2", "n:recente"]);
  assert.deepEqual((db().prepare("SELECT mac FROM topology_device_macs").all() as Array<{ mac: string }>).map((r) => r.mac), ["02:00:00:00:00:01"]);
});

test("bridge per istanza e MAC normalizzati; un MAC tutto zeri non si scrive", () => {
  withTenant(T, () => scriviFattiTopologia(1, "device", {
    porte: [],
    bridge: [{ bridge_name: "BR_RP", instance: 0, protocol: "rstp", priority: 0, bridge_id: "0.02:00:a0:10:0e:02", root_id: "0.02:00:a0:10:0e:02", root_port: null }],
    macs: [{ mac: "02-00-a0-10-0e-02", port_key: "n:sfp-sfpplus1" }, { mac: "00:00:00:00:00:00", port_key: "n:lo" }],
  }, ORA));
  assert.deepEqual(db().prepare("SELECT bridge_name, instance, protocol, priority, root_port FROM topology_bridge_facts").all(),
    [{ bridge_name: "BR_RP", instance: 0, protocol: "rstp", priority: 0, root_port: null }]);
  assert.deepEqual((db().prepare("SELECT mac FROM topology_device_macs").all() as Array<{ mac: string }>).map((r) => r.mac), ["02:00:A0:10:0E:02"]);
});

test("I35: upsertSwitchPorts riscrive switch_ports e lascia stare i fatti", () => {
  withTenant(T, () => {
    scriviFattiTopologia(2, "controller", { porte: [porta({ port_key: "i:3", port_name: "Port 3", port_index: 3 })], bridge: [], macs: [] }, ORA);
    upsertSwitchPorts(2, []);
  });
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM topology_port_facts").get() as { n: number }).n, 1);
});

test("I55: i MAC dei lettori nuovi non entrano nei MAC noti (la sincronizzazione del controller li usa per abbinare)", () => {
  const prima = withTenant(T, () => getNetworkDeviceKnownMacs());
  withTenant(T, () => scriviFattiTopologia(1, "device", { porte: [], bridge: [], macs: [{ mac: "02:00:00:00:00:77", port_key: null }] }, ORA));
  assert.deepEqual(withTenant(T, () => getNetworkDeviceKnownMacs()), prima);
});

test("colonne nuove dei vicini: scritte a parte quando ci sono, lasciate stare quando mancano", () => {
  withTenant(T, () => {
    upsertNeighbors(1, [{ localPort: "ether2", remoteDevice: "SW-2", remotePort: "Port 3", protocol: "lldp", discoveredBy: "cdp,lldp,mndp", remoteCaps: "bridge" }]);
    upsertNeighbors(1, [{ localPort: "ether2", remoteDevice: "SW-2", remotePort: "Port 3", protocol: "lldp" }]);
  });
  assert.deepEqual(db().prepare("SELECT discovered_by, remote_caps, local_port_index FROM device_neighbors").get(),
    { discovered_by: "cdp,lldp,mndp", remote_caps: "bridge", local_port_index: null });
});

test("le fonti nuove (ssh, snmp, host) non entrano nell'ingresso del modello di oggi", () => {
  withTenant(T, () => {
    upsertNeighbors(2, [{ localPort: "Port 3", remoteDevice: "RTR-1", remotePort: "ether2", protocol: "lldp" }], "snmp");
    upsertNeighbors(1, [{ localPort: "ether2", remoteDevice: "SW-2", remotePort: "Port 3", protocol: "lldp" }], "ssh");
  });
  assert.equal(withTenant(T, () => getTopologyModelInput(2)).neighbors.length, 0);
});

test("I34: una migrazione non riuscita non ferma i vicini, e il modello si calcola", () => {
  db().exec("ALTER TABLE device_neighbors DROP COLUMN remote_caps"); // simula lo schema a metà
  withTenant(T, () => {
    assert.equal(schemaCaviPresente(), true, "l'annotazione di prima dice ancora «presente»: l'istruzione a parte fallirà");
    upsertNeighbors(1, [{ localPort: "ether2", remoteDevice: "SW-2", remotePort: "Port 3", protocol: "lldp", remoteCaps: "bridge" }]);
    assert.equal(rileggiSchemaCavi(), false);
    assert.equal(scriviFattiTopologia(1, "device", { porte: [porta()], bridge: [], macs: [] }, ORA), null, "senza schema non si scrive");
    assert.equal(setUplinkCavi(2, 3, "lldp_uplink"), false);
    assert.equal(buildTopologyModel(getTopologyModelInput(2)).counts.devices, 2);
  });
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM device_neighbors").get() as { n: number }).n, 1, "il vicino c'è");
  db().exec("ALTER TABLE device_neighbors ADD COLUMN remote_caps TEXT");
});
