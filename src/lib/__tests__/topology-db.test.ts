import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import {
  addLinkOverride, deleteLinkOverride, deleteTenantDatabase, getSiteTopology, getTenantDb, getTopologyModelInput,
  listLinkOverrides, setDeviceLocation, setSiteTopology, upsertMacPortEntries, withTenant,
} from "@/lib/db-tenant";
import { getLinkStaleDays, setLinkStaleDays } from "@/lib/topology/settings";

const T = "TESTTOPODB";
const db = () => getTenantDb(T);
const w = <R>(fn: () => R): R => withTenant(T, fn);

beforeEach(() => {
  db().exec("DELETE FROM mac_port_entries; DELETE FROM topology_link_overrides; DELETE FROM switch_ports; DELETE FROM device_neighbors; DELETE FROM network_devices; DELETE FROM hosts; DELETE FROM networks; DELETE FROM locations;");
  db().exec(`
    INSERT INTO locations (id, name, parent_id) VALUES (1, 'Sede A', NULL), (2, 'Armadio 1', 1), (3, 'Sede B', NULL);
    INSERT INTO networks (id, cidr, name, gateway) VALUES (1, '10.0.0.0/24', 'LAN', '10.0.0.1'), (2, '10.0.1.0/24', 'VOIP', '10.0.1.1'), (3, '10.0.2.0/24', 'OSPITI', NULL);
    INSERT INTO network_devices (id, name, host, device_type, vendor, protocol) VALUES (1, 'RTR-1', '10.0.0.1', 'router', 'mikrotik', 'ssh'), (2, 'SW-2', '10.0.0.2', 'switch', 'ubiquiti', 'api');
    INSERT INTO switch_ports (device_id, port_index, port_name, is_uplink) VALUES (2, 1, 'Port 1', 1), (2, 2, 'Port 2', 0);
  `);
});
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

test("getTopologyModelInput: righe nella forma del modello", () => {
  const i = w(() => getTopologyModelInput(2, 1_000));
  assert.equal(i.staleDays, 2);
  assert.equal(i.nowMs, 1_000);
  assert.deepEqual(i.devices.map((d) => [d.id, d.port_count, d.topology_hidden, d.location_id]), [[1, 0, 0, null], [2, 2, 0, null]]);
  assert.deepEqual(i.uplinkPorts, [{ device_id: 2, port_index: 1, port_name: "Port 1" }]);
  assert.equal(i.locations.length, 3);
});

test("getTopologyModelInput: i MAC per porta degli ultimi 30 giorni, con la fonte", () => {
  w(() => upsertMacPortEntries(2, [{ mac: "02:00:00:00:00:0a", port_name: "Port 2", vlan: null, port_status: null, speed: null }], "device"));
  // Una riga di 40 giorni fa non entra: il modello vede solo gli ultimi 30.
  db().prepare(`INSERT INTO mac_port_entries (device_id, mac, port_name, timestamp, first_seen, source)
                VALUES (2, '02:00:00:00:00:0b', 'Port 2', datetime('now', '-40 days'), datetime('now', '-40 days'), 'unifi')`).run();
  const i = w(() => getTopologyModelInput(2, 1_000));
  assert.equal(i.macPorts.length, 1);
  const [r] = i.macPorts;
  assert.deepEqual({ device_id: r.device_id, mac: r.mac, port_name: r.port_name, source: r.source },
    { device_id: 2, mac: "02:00:00:00:00:0a", port_name: "Port 2", source: "device" });
  assert.match(r.timestamp, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test("sede dell'apparato: scritta con autore e data; ubicazione inesistente rifiutata", () => {
  assert.deepEqual(w(() => setDeviceLocation(2, 2, "riccardo")), { ok: true });
  const r = db().prepare("SELECT location_id, location_set_by, location_set_at FROM network_devices WHERE id = 2").get() as Record<string, unknown>;
  assert.equal(r.location_id, 2);
  assert.equal(r.location_set_by, "riccardo");
  assert.ok(r.location_set_at);
  assert.equal(w(() => setDeviceLocation(2, 99, "riccardo")).ok, false);
  assert.deepEqual(w(() => setDeviceLocation(2, null, "riccardo")), { ok: true });
});

test("testa e subnet: solo su una sede; l'elenco delle subnet si sostituisce", () => {
  assert.equal(w(() => setSiteTopology(2, { headDeviceId: 1 }, "riccardo")).ok, false, "un armadio non ha testa");
  assert.deepEqual(w(() => setSiteTopology(1, { headDeviceId: 1, networkIds: [1, 2] }, "riccardo")), { ok: true });
  assert.deepEqual(w(() => getSiteTopology(1))?.network_ids, [1, 2]);
  assert.deepEqual(w(() => setSiteTopology(1, { networkIds: [2, 3] }, "riccardo")), { ok: true });
  assert.deepEqual(w(() => getSiteTopology(1))?.network_ids, [2, 3]);
  assert.equal(w(() => getSiteTopology(1))?.head_device_id, 1, "la testa resta se non la si tocca");
  assert.equal(w(() => setSiteTopology(1, { networkIds: [99] }, "riccardo")).ok, false);
  assert.equal(w(() => setSiteTopology(1, { headDeviceId: 99 }, "riccardo")).ok, false);
  const net1 = db().prepare("SELECT location_id, location_set_by FROM networks WHERE id = 1").get() as Record<string, unknown>;
  assert.deepEqual(net1, { location_id: null, location_set_by: "riccardo" });
});

test("correzioni ai collegamenti: aggiungi, elenca, togli", () => {
  const id = w(() => addLinkOverride({ action: "ignore", a_node: "dev:1", a_port: "", b_node: "host:5", b_port: "", note: "doppio" }, "riccardo"));
  const lista = w(() => listLinkOverrides());
  assert.equal(lista.length, 1);
  assert.equal(lista[0].created_by, "riccardo");
  assert.equal(w(() => deleteLinkOverride(id)), true);
  assert.equal(w(() => deleteLinkOverride(id)), false);
});

test("soglia «non visto»: 2 di partenza, limiti 1-30", () => {
  assert.equal(getLinkStaleDays(), 2);
  setLinkStaleDays(5);
  assert.equal(getLinkStaleDays(), 5);
  assert.throws(() => setLinkStaleDays(0));
  assert.throws(() => setLinkStaleDays(31));
  setLinkStaleDays(2);
});

test("getTopologyModelInput: VM dalle scansioni Proxmox (JSON rovinato = nessuna VM), velocità delle porte e ripieghi della fase 2b", () => {
  const scan = JSON.stringify({
    scanned_at: "2026-10-13T06:00:00.000Z",
    hosts: [{ hostname: "pve-a", network_interfaces: [{ name: "vmbr0", mac_address: null, ip_addresses: "192.0.2.11" }] }],
    vms: [{ node: "pve-a", vmid: 100, name: "vm-100", status: "running", type: "qemu", ip_addresses: [], networks_details: [{ id: "net0", mac: "02:00:00:aa:00:01" }] }],
  });
  db().prepare("UPDATE network_devices SET last_proxmox_scan_result = ? WHERE id = 1").run(scan);
  db().prepare("UPDATE network_devices SET last_proxmox_scan_result = ? WHERE id = 2").run("{rovinato");
  db().prepare("UPDATE switch_ports SET speed = '1000 Mbps', poe_power_mw = 4500 WHERE device_id = 2 AND port_index = 2").run();
  w(() => addLinkOverride({ action: "add", a_node: "dev:1", a_port: "ether1", b_node: "dev:2", b_port: "Port 2", note: null }, "prova"));
  const i = w(() => getTopologyModelInput(2, 1_000));
  assert.deepEqual(i.vms.map((v) => [v.scannedDeviceId, v.vmid, v.macs]), [[1, 100, ["02:00:00:AA:00:01"]]]);
  assert.deepEqual(i.scanHosts.map((h) => [h.scannedDeviceId, h.hostname, h.ips]), [[1, "pve-a", ["192.0.2.11"]]]);
  assert.deepEqual(i.portInfo.map((p) => [p.device_id, p.port_name, p.speed, p.poe_power_mw]), [[2, "Port 2", "1000 Mbps", 4500]]);
  assert.ok(i.overrides.length >= 1 && i.overrides.every((o) => o.medium === null), "medium si legge null anche se la colonna non c'è");
  assert.deepEqual(i.primaries, []);
  assert.ok(i.devices.every((d) => d.uplink_type === null));
});
