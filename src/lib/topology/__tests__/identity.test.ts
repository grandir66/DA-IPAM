import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNodeIndex } from "@/lib/topology/node-index";
import { isVirtualMac, nodeClass } from "@/lib/topology/identity";
import type { ModelDeviceRow, ModelHostRow, ModelNeighborRow } from "@/lib/topology/model-types";

const dev = (id: number, name: string, host: string): ModelDeviceRow => ({
  id, name, host, device_type: "router", vendor: "mikrotik", model: null, enabled: 1, host_id: null, physical_device_id: null,
  location_id: null, controller_mac: null, uplink_mac: null, uplink_remote_port: null, uplink_seen_at: null, uplink_type: null, topology_hidden: 0, port_count: 0,
});
const host = (id: number, ip: string, mac: string | null, hostname: string | null, classification = "router"): ModelHostRow => ({
  id, network_id: 1, ip, mac, hostname, custom_name: null, classification, status: "online", physical_device_id: null,
});
const vicino = (ip: string, name: string, mac: string): ModelNeighborRow => ({
  device_id: 9, local_port: "ether1", remote_device_name: name, remote_port: "bridge", protocol: "mndp",
  remote_ip: ip, remote_mac: mac, timestamp: "2026-10-13 10:00:00", source: "device",
});

test("MAC virtuali VRRP/HSRP riconosciuti", () => {
  assert.equal(isVirtualMac("00:00:5E:00:01:65"), true);
  assert.equal(isVirtualMac("00:00:5e:00:02:0a"), true);
  assert.equal(isVirtualMac("00:00:0C:07:AC:01"), true);
  assert.equal(isVirtualMac("02:00:00:00:00:01"), false);
  assert.equal(isVirtualMac(null), false);
});

test("nodeClass: ruolo nella mappa", () => {
  assert.equal(nodeClass({ type: "switch" }), "infra");
  assert.equal(nodeClass({ type: "access_point" }), "ap");
  assert.equal(nodeClass({ type: "nas" }), "att");
  assert.equal(nodeClass({ type: "voip" }), "client");
});

test("il router assorbe gli host col suo nome annunciato, anche con MAC virtuale; gli IP virtuali sono segnati", () => {
  const devices = [dev(1, "RTR-SEDE1", "192.0.2.11")];
  const hosts = [
    host(10, "192.0.2.11", "02:00:00:00:00:98", "CORE-ID"),
    host(11, "198.51.100.254", "00:00:5E:00:01:65", "CORE-ID"),
    host(12, "198.51.100.253", null, "CORE-ID"),
    host(13, "203.0.113.254", "00:00:5E:00:01:6E", null),
  ];
  const idx = buildNodeIndex(devices, hosts, [], [vicino("203.0.113.254", "CORE-ID", "00:00:5E:00:01:6E")]);
  const n = idx.nodes.get("dev:1")!;
  assert.deepEqual(n.fusedHostIds, [10, 11, 12, 13]);
  assert.deepEqual(n.aliases, ["CORE-ID"]);
  assert.deepEqual(n.addresses.filter((a) => a.virtual).map((a) => a.ip).sort(), ["198.51.100.254", "203.0.113.254"]);
  assert.equal([...idx.nodes.keys()].filter((k) => k.startsWith("host:")).length, 0);
});

test("quattro host con lo stesso MAC vero diventano un oggetto solo, col nome che c'è", () => {
  const hosts = [
    host(20, "192.0.2.12", "02:00:00:00:BA:C6", "RTR-BACKUP"),
    host(21, "198.51.100.252", "02:00:00:00:BA:C6", null),
    host(22, "203.0.113.252", "02:00:00:00:BA:C6", null),
    host(23, "192.0.2.252", "02:00:00:00:BA:C6", null),
  ];
  const idx = buildNodeIndex([], hosts, [], []);
  const hostNodes = [...idx.nodes.values()].filter((n) => n.kind === "host");
  assert.equal(hostNodes.length, 1);
  assert.equal(hostNodes[0].name, "RTR-BACKUP");
  assert.equal(hostNodes[0].addresses.length, 4);
  assert.equal(idx.mergedHosts, 3);
});

test("due client con lo stesso nome non si fondono; due host col MAC virtuale e senza nome nemmeno", () => {
  const hosts = [
    host(30, "192.0.2.47", "02:00:00:00:00:47", "iPhone", "voip"),
    host(31, "192.0.2.48", "02:00:00:00:00:48", "iPhone", "voip"),
    host(32, "192.0.2.1", "00:00:5E:00:01:01", null),
    host(33, "192.0.2.2", "00:00:5E:00:01:01", null),
  ];
  const idx = buildNodeIndex([], hosts, [], []);
  assert.equal(idx.mergedHosts, 0);
});

test("un nome annunciato non porta via un host il cui MAC vero è di un altro apparato", () => {
  const devices = [dev(1, "RTR-A", "192.0.2.11"), { ...dev(2, "RTR-B", "192.0.2.21"), controller_mac: "02:00:00:00:00:B0" }];
  const hosts = [host(10, "192.0.2.11", "02:00:00:00:00:A0", "ID-A"), host(40, "192.0.2.99", "02:00:00:00:00:B0", "ID-A")];
  const idx = buildNodeIndex(devices, hosts, [], []);
  assert.ok(idx.nodes.get("dev:2")!.fusedHostIds.includes(40));
  assert.ok(!idx.nodes.get("dev:1")!.fusedHostIds.includes(40));
});

test("due host «MikroTik» con MAC veri diversi restano due; un apparato «MikroTik» non li assorbe (I3)", () => {
  const hosts = [
    host(50, "192.0.2.50", "02:00:00:00:00:50", "MikroTik"),
    host(51, "192.0.2.51", "02:00:00:00:00:51", "MikroTik"),
  ];
  const idx = buildNodeIndex([], hosts, [], []);
  assert.equal(idx.mergedHosts, 0);
  const idx2 = buildNodeIndex([dev(1, "MikroTik", "192.0.2.1")], hosts, [], []);
  assert.deepEqual(idx2.nodes.get("dev:1")!.fusedHostIds, []);
  assert.equal(idx2.fusedHosts, 0);
});

test("altri nomi di fabbrica e chiavi corte non fondono (I3)", () => {
  for (const nome of ["localhost", "UBNT", "router", "Gateway", "unknown", "ap", "sw1", "12345"]) {
    const idx = buildNodeIndex([], [host(60, "192.0.2.60", null, nome), host(61, "192.0.2.61", null, nome)], [], []);
    assert.equal(idx.mergedHosts, 0, nome);
  }
});

test("due ponti radio con nomi diversi e la stessa identità annunciata: OUI diversi non si fondono, stesso OUI sì (I3)", () => {
  const vicini = [vicino("192.0.2.70", "PTP-LINK", "02:00:00:00:00:70"), vicino("192.0.2.71", "PTP-LINK", "06:00:00:00:00:71")];
  const diversi = [host(70, "192.0.2.70", "02:00:00:00:00:70", "PONTE-NORD"), host(71, "192.0.2.71", "06:00:00:00:00:71", "PONTE-SUD")];
  assert.equal(buildNodeIndex([], diversi, [], vicini).mergedHosts, 0);
  const stessoOui = [host(70, "192.0.2.70", "02:00:00:00:00:70", "PONTE-NORD"), host(71, "192.0.2.71", "02:00:00:00:00:71", "PONTE-SUD")];
  assert.equal(buildNodeIndex([], stessoOui, [], vicini).mergedHosts, 1);
});

test("un nome-chassis a punti (MAC Cisco) non diventa la chiave del suo prefisso (I3)", () => {
  const hosts = [host(80, "192.0.2.80", null, "0050.56ab.0001"), host(81, "192.0.2.81", null, "0050.56ab.0002")];
  assert.equal(buildNodeIndex([], hosts, [], []).mergedHosts, 0);
  const lettere = [host(82, "192.0.2.82", null, "a0b1.c2d3.e4f5"), host(83, "192.0.2.83", null, "a0b1.c2d3.e4f6")];
  assert.equal(buildNodeIndex([], lettere, [], []).mergedHosts, 0);
});
