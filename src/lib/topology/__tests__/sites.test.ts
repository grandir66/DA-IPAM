import { test } from "node:test";
import assert from "node:assert/strict";
import { assignSites } from "@/lib/topology/sites";
import { buildLinks } from "@/lib/topology/links";
import { buildNodeIndex } from "@/lib/topology/node-index";
import type { ModelNetworkRow, TopologyModelInput } from "@/lib/topology/model-types";
import { dev, host } from "./support/righe";

const SEDE_A = { id: 1, name: "Sede A", parent_id: null, head_device_id: null };
const SEDE_B = { id: 2, name: "Sede B", parent_id: null, head_device_id: null };
const ARMADIO_A = { id: 3, name: "Armadio 1", parent_id: 1, head_device_id: null };

function net(id: number, cidr: string, location_id: number | null, gateway: string | null = null): ModelNetworkRow {
  return { id, cidr, name: `Rete ${id}`, gateway, location_id };
}
function run(over: Partial<TopologyModelInput>) {
  const input: TopologyModelInput = {
    devices: [], hosts: [], neighbors: [], uplinkPorts: [], locations: [SEDE_A, SEDE_B, ARMADIO_A],
    networks: [], knownMacs: [], overrides: [], nowMs: Date.parse("2026-10-13T12:00:00Z"), staleDays: 2, ...over,
  };
  const idx = buildNodeIndex(input.devices, input.hosts, input.knownMacs);
  const { links } = buildLinks(input, idx);
  const sites = assignSites(input, idx, links);
  return { idx, sites, node: (id: string) => idx.nodes.get(id)! };
}

test("manuale nell'armadio: sede = l'antenato, armadio = l'ubicazione, confermato", () => {
  const { node } = run({ devices: [dev(1, { location_id: 3 })] });
  assert.deepEqual([node("dev:1").siteId, node("dev:1").rackId, node("dev:1").siteProposed], [1, 3, false]);
});

test("dalla subnet: proposta; la scelta manuale vince", () => {
  const { node } = run({
    devices: [dev(1, { host: "10.0.0.1" }), dev(2, { host: "10.0.0.2", location_id: 2 })],
    networks: [net(1, "10.0.0.0/24", 1)],
  });
  assert.deepEqual([node("dev:1").siteId, node("dev:1").siteProposed], [1, true]);
  assert.deepEqual([node("dev:2").siteId, node("dev:2").siteProposed], [2, false]);
});

test("subnet sovrapposte: vince il prefisso più lungo (Review Focus 5)", () => {
  const { node } = run({
    devices: [dev(1, { host: "10.0.5.10" }), dev(2, { host: "10.0.6.10" })],
    networks: [net(1, "10.0.0.0/16", 1), net(2, "10.0.5.0/24", 2)],
  });
  assert.equal(node("dev:1").siteId, 2);
  assert.equal(node("dev:2").siteId, 1);
});

test("dall'albero: lo switch senza subnet prende la sede del suo uplink", () => {
  const { node } = run({
    devices: [
      dev(1, { host: "10.0.0.1", controller_mac: "aa:bb:cc:00:00:01", device_type: "router" }),
      dev(2, { host: "192.168.99.2", uplink_mac: "aa:bb:cc:00:00:01", uplink_seen_at: "2026-10-13 03:00:00" }),
    ],
    networks: [net(1, "10.0.0.0/24", 1)],
  });
  assert.deepEqual([node("dev:2").siteId, node("dev:2").siteProposed], [1, true]);
});

test("vicini in due sedi diverse: resta senza sede", () => {
  const { node } = run({
    devices: [dev(1, { location_id: 1 }), dev(2, { location_id: 2 }), dev(3, { host: "192.168.99.3" })],
    neighbors: [
      { device_id: 3, local_port: "Port 1", remote_device_name: "", remote_port: "", protocol: "lldp", remote_ip: "10.0.0.1", remote_mac: null, timestamp: "2026-10-13 03:00:00", source: "device" },
      { device_id: 3, local_port: "Port 2", remote_device_name: "", remote_port: "", protocol: "lldp", remote_ip: "10.0.0.2", remote_mac: null, timestamp: "2026-10-13 03:00:00", source: "device" },
    ],
  });
  assert.equal(node("dev:3").siteId, null);
});

test("testa proposta: il router gateway di più subnet; a pari merito nessuna; la manuale vince", () => {
  const devices = [
    dev(1, { name: "MK-RTR-CORE", host: "10.0.0.1", device_type: "router" }),
    dev(2, { name: "UDM", host: "10.0.0.254", device_type: "router" }),
  ];
  const hosts = [host(10, { ip: "10.0.1.1", mac: "aa:bb:cc:00:00:01", network_id: 2 }), host(11, { ip: "10.0.0.1", mac: "aa:bb:cc:00:00:01" })];
  const networks = [net(1, "10.0.0.0/24", 1, "10.0.0.1"), net(2, "10.0.1.0/24", 1, "10.0.1.1"), net(3, "10.0.2.0/24", 1, "10.0.0.254")];
  const proposta = run({ devices, hosts, networks }).sites.find((s) => s.locationId === 1)!;
  assert.deepEqual([proposta.headNodeId, proposta.headProposed], ["dev:1", true]);

  const pari = run({ devices, networks: [net(1, "10.0.0.0/24", 1, "10.0.0.1"), net(3, "10.0.2.0/24", 1, "10.0.0.254")] }).sites.find((s) => s.locationId === 1)!;
  assert.equal(pari.headNodeId, null);

  const manuale = run({ devices, hosts, networks, locations: [{ ...SEDE_A, head_device_id: 2 }, SEDE_B, ARMADIO_A] }).sites.find((s) => s.locationId === 1)!;
  assert.deepEqual([manuale.headNodeId, manuale.headProposed], ["dev:2", false]);
});

test("ubicazioni in cerchio (dato sporco): nessun blocco", () => {
  const { node } = run({
    locations: [{ id: 5, name: "X", parent_id: 6, head_device_id: null }, { id: 6, name: "Y", parent_id: 5, head_device_id: null }],
    devices: [dev(1, { location_id: 5 })],
  });
  assert.ok(node("dev:1").siteId === 5 || node("dev:1").siteId === 6);
});
