import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTopologyGraph } from "@/lib/topology/graph";
import type { DeviceRow, HostRow, NeighborRow, TopologyStatus } from "@/lib/topology/types";

const dev = (o: Partial<DeviceRow>): DeviceRow => ({
  id: 1, name: "SW1", device_type: "switch", model: "US8P60", host: "172.16.3.1", enabled: 1, ...o,
});
const host = (o: Partial<HostRow>): HostRow => ({
  id: 1, ip: "172.17.16.5", hostname: "px-up", custom_name: null, classification: "hypervisor",
  status: "online", last_response_time_ms: 5, last_seen: null, model: null, network_id: 1, ...o,
});
const nb = (o: Partial<NeighborRow>): NeighborRow => ({
  device_id: 1, local_port: "1", remote_device_name: "SW2", remote_port: "2", protocol: "lldp", remote_ip: null, ...o,
});
const noStatus = new Map<string, TopologyStatus>();

test("device + host (hypervisor) diventano nodi; PC esclusi", () => {
  const g = buildTopologyGraph({
    devices: [dev({ id: 1, name: "SW1" })],
    hosts: [host({ id: 1, classification: "hypervisor" }), host({ id: 2, classification: "workstation" })],
    neighbors: [], statusByNode: noStatus,
  });
  const ids = g.nodes.map((n) => n.id).sort();
  assert.deepEqual(ids, ["dev:1", "host:1"]);
});

test("vicino verso device noto → arco dev→dev", () => {
  const g = buildTopologyGraph({
    devices: [dev({ id: 1, name: "SW1" }), dev({ id: 2, name: "SW2" })],
    hosts: [], neighbors: [nb({ device_id: 1, remote_device_name: "SW2" })], statusByNode: noStatus,
  });
  assert.equal(g.edges.length, 1);
  assert.equal(g.edges[0].source, "dev:1");
  assert.equal(g.edges[0].target, "dev:2");
});

test("vicino non risolvibile → nodo esterno placeholder", () => {
  const g = buildTopologyGraph({
    devices: [dev({ id: 1, name: "SW1" })],
    hosts: [], neighbors: [nb({ device_id: 1, remote_device_name: "ISP-GW" })], statusByNode: noStatus,
  });
  assert.ok(g.nodes.some((n) => n.kind === "external" && n.id === "ext:isp-gw"));
  assert.equal(g.edges.length, 1);
  assert.equal(g.edges[0].target, "ext:isp-gw");
});

test("archi bidirezionali deduplicati", () => {
  const g = buildTopologyGraph({
    devices: [dev({ id: 1, name: "SW1" }), dev({ id: 2, name: "SW2" })],
    hosts: [],
    neighbors: [
      nb({ device_id: 1, remote_device_name: "SW2" }),
      nb({ device_id: 2, remote_device_name: "SW1", local_port: "2", remote_port: "1" }),
    ],
    statusByNode: noStatus,
  });
  assert.equal(g.edges.length, 1);
});

test("nodo orfano (senza archi) resta nel grafo", () => {
  const g = buildTopologyGraph({ devices: [dev({ id: 7, name: "ORPH" })], hosts: [], neighbors: [], statusByNode: noStatus });
  assert.ok(g.nodes.some((n) => n.id === "dev:7"));
});

test("status applicato ai nodi, default unknown", () => {
  const g = buildTopologyGraph({
    devices: [dev({ id: 1 })], hosts: [], neighbors: [],
    statusByNode: new Map<string, TopologyStatus>([["dev:1", "ok"]]),
  });
  assert.equal(g.nodes.find((n) => n.id === "dev:1")!.status, "ok");
});
