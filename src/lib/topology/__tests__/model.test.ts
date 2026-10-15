import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTopologyModel } from "@/lib/topology/model";
import type { TopologyModelInput } from "@/lib/topology/model-types";
import { baseInput, dev, host } from "./support/righe";

function input(over: Partial<TopologyModelInput> = {}): TopologyModelInput {
  return {
    devices: [
      dev(1, { name: "RTR-1", device_type: "router", host: "10.0.0.1" }),
      dev(2, { name: "SW-2", host: "10.0.0.2" }),
      dev(3, { name: "SW-FALSO", host: "10.0.0.3", port_count: 0 }),
    ],
    hosts: [
      host(40, { ip: "10.0.0.40", classification: "switch", hostname: "sw-solo-host" }),
      host(41, { ip: "10.0.0.41", classification: "hypervisor", hostname: "pve-1" }),
    ],
    neighbors: [
      { device_id: 2, local_port: "Port 1", remote_device_name: "", remote_port: "ether2", protocol: "lldp", remote_ip: "10.0.0.1", remote_mac: null, timestamp: "2026-10-13 03:00:00", source: "device" },
      { device_id: 2, local_port: "Port 5", remote_device_name: "sw-solo-host", remote_port: "", protocol: "lldp", remote_ip: null, remote_mac: null, timestamp: "2026-10-13 03:00:00", source: "device" },
      { device_id: 2, local_port: "Port 6", remote_device_name: "pve-1", remote_port: "", protocol: "lldp", remote_ip: null, remote_mac: null, timestamp: "2026-10-01 03:00:00", source: "device" },
    ],
    uplinkPorts: [],
    locations: [{ id: 1, name: "Sede A", parent_id: null, head_device_id: null }],
    networks: [{ id: 1, cidr: "10.0.0.0/24", name: "LAN", gateway: "10.0.0.1", location_id: 1 }],
    knownMacs: [], overrides: [], macPorts: [], primaries: [], portInfo: [], vms: [], scanHosts: [], nowMs: Date.parse("2026-10-13T12:00:00Z"), staleDays: 2, ...over,
  };
}

test("conteggi, proposte e «da sistemare»", () => {
  const m = buildTopologyModel(input());
  assert.deepEqual(m.promote.map((p) => [p.hostId, p.links]), [[40, 1]]);
  assert.deepEqual(m.isolated, ["dev:3"]);
  assert.deepEqual(m.suspicious, ["dev:3"]);
  assert.deepEqual(m.withoutSite, []);
  assert.equal(m.sites[0].headNodeId, "dev:1");
  assert.equal(m.counts.deviceLinks, 1);
  assert.equal(m.counts.attachedLinks, 2);
  assert.equal(m.counts.staleLinks, 1);
  assert.equal(m.counts.sitesWithHead, 1);
  assert.equal(m.counts.linksBySource.lldp, 3);
});

test("l'host promosso (ora apparato con host_id) esce dalle proposte", () => {
  const i = input();
  i.devices.push(dev(9, { name: "SW-PROMOSSO", host: "10.0.0.40", host_id: 40 }));
  assert.deepEqual(buildTopologyModel(i).promote, []);
});

test("stessi dati, stesso modello; un AP in più non cambia sedi e collegamenti degli altri", () => {
  const a = buildTopologyModel(input());
  assert.equal(JSON.stringify(a), JSON.stringify(buildTopologyModel(input())));
  const i = input();
  i.devices.push(dev(20, { name: "AP-1", device_type: "access_point", host: "10.0.0.20" }));
  i.neighbors.push({ device_id: 20, local_port: "eth0", remote_device_name: "SW-2", remote_port: "Port 8", protocol: "lldp", remote_ip: null, remote_mac: null, timestamp: "2026-10-13 03:00:00", source: "unifi" });
  const b = buildTopologyModel(i);
  for (const l of a.links) assert.deepEqual(b.links.find((x) => x.id === l.id), l);
  for (const n of a.nodes) assert.deepEqual(b.nodes.find((x) => x.id === n.id), n);
});

test("un host promosso (apparato con host_id = N) ha l'id canonico dell'apparato; un host fuso con un altro host quello del gruppo (I5)", () => {
  const m = buildTopologyModel(input({
    devices: [...input().devices, dev(9, { name: "SW-NUOVO", host: "10.0.0.40", host_id: 40 })],
    hosts: [
      ...input().hosts,
      host(50, { ip: "10.0.0.50", mac: "02:00:00:00:00:50", classification: "switch", hostname: "sw-50" }),
      host(51, { ip: "10.0.5.51", mac: "02:00:00:00:00:50", classification: "switch" }),
    ],
  }));
  assert.equal(m.canonical["host:40"], "dev:9");
  assert.equal(m.canonical["host:51"], "host:50");
  assert.equal(m.canonical["host:41"], undefined, "un host non fuso non ha alias");
  assert.ok(m.nodes.some((n) => n.id === "dev:9"));
});

// I63 (spec §13.8.1): il modello conta di quante reti ogni apparato è il gateway, come la testa proposta di una sede
// (sites.ts: il suo IP, quelli degli host fusi e degli host col suo MAC). Spenta la regola (misura C19), il conto non c'è.
test("gatewayDi: le reti di cui ogni apparato è gateway; assente con la regola «testa-per-reti» spenta", () => {
  const i = baseInput({
    devices: [dev(1, { name: "RTR-1", device_type: "router", host: "10.0.0.1" }), dev(5, { name: "GW-5", device_type: "router", host: "10.0.5.1" })],
    hosts: [host(9, { ip: "10.0.9.1", mac: "02:00:00:00:00:05" })],
    knownMacs: [{ device_id: 5, mac: "02:00:00:00:00:05" }],
    networks: [
      { id: 1, cidr: "10.0.0.0/24", name: "a", gateway: "10.0.0.1", location_id: null },
      { id: 2, cidr: "10.0.5.0/24", name: "b", gateway: "10.0.5.1", location_id: null },
      { id: 3, cidr: "10.0.9.0/24", name: "c", gateway: "10.0.9.1", location_id: null },
      { id: 4, cidr: "10.0.7.0/24", name: "d", gateway: null, location_id: null },
    ],
  });
  assert.deepEqual(buildTopologyModel(i).gatewayDi, { "dev:1": 1, "dev:5": 2 });
  assert.equal(buildTopologyModel(i, new Set()).gatewayDi, undefined);
});
