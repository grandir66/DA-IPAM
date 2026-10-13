import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTopologyModel } from "@/lib/topology/model";
import type { TopologyModelInput } from "@/lib/topology/model-types";
import { dev, host } from "./support/righe";

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
    knownMacs: [], overrides: [], nowMs: Date.parse("2026-10-13T12:00:00Z"), staleDays: 2, ...over,
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
