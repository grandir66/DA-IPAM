import { test } from "node:test";
import assert from "node:assert/strict";
import { attachMacs } from "@/lib/topology/attach";
import { buildLinks } from "@/lib/topology/links";
import { buildNodeIndex } from "@/lib/topology/node-index";
import type { ModelMacPortRow, TopologyModelInput } from "@/lib/topology/model-types";
import { dev, host } from "./support/righe";

const NOW = Date.parse("2026-10-13T12:00:00Z");
const RECENTE = "2026-10-13 11:00:00";

function mp(device_id: number, mac: string, port_name: string, timestamp = RECENTE): ModelMacPortRow {
  return { device_id, mac, port_name, timestamp, source: "device" };
}
const mac = (n: number) => `02:00:00:00:${String(Math.floor(n / 256)).padStart(2, "0")}:${(n % 256).toString(16).padStart(2, "0")}`;

function input(over: Partial<TopologyModelInput> = {}): TopologyModelInput {
  return {
    devices: [
      dev(1, { name: "RTR-1", device_type: "router", host: "10.0.0.1" }),
      dev(2, { name: "SW-2", host: "10.0.0.2" }),
      dev(3, { name: "SW-3", host: "10.0.0.3" }),
    ],
    hosts: [],
    neighbors: [
      { device_id: 2, local_port: "Port 1", remote_device_name: "SW-3", remote_port: "Port 1", protocol: "lldp", remote_ip: "10.0.0.3", remote_mac: null, timestamp: RECENTE, source: "device" },
    ],
    uplinkPorts: [{ device_id: 3, port_index: 9, port_name: "Port 9" }],
    locations: [], networks: [], knownMacs: [], overrides: [], macPorts: [], nowMs: NOW, staleDays: 2, ...over,
  };
}
function run(i: TopologyModelInput) {
  const idx = buildNodeIndex(i.devices, i.hosts, i.knownMacs, i.neighbors);
  const { links } = buildLinks(i, idx);
  return { links, ...attachMacs(i, idx, links) };
}

test("porta di bordo: mai l'uplink né la porta di un collegamento fra apparati", () => {
  const m = mac(1);
  const r = run(input({ macPorts: [mp(2, m, "Port 1"), mp(3, m, "Port 9"), mp(3, m, "Port 5")] }));
  assert.deepEqual(r.portClients.map((p) => [p.nodeId, p.port, p.clients.length]), [["dev:3", "Port 5", 1]]);
  assert.deepEqual(r.clientCount, { "dev:3": 1 });
});

test("router scartato se uno switch vede il MAC; solo sul router non è un client", () => {
  const a = mac(1), b = mac(2);
  const r = run(input({ macPorts: [mp(1, a, "bridge"), mp(2, a, "Port 4"), mp(1, b, "bridge")] }));
  assert.deepEqual(r.portClients.map((p) => [p.nodeId, p.port]), [["dev:2", "Port 4"]]);
  assert.deepEqual(r.clientCount, { "dev:2": 1 });
  assert.deepEqual(r.attachLinks, []);
});

test("switch non gestito sotto: i 30 MAC sono della sua porta, non dello switch a monte", () => {
  const rows = Array.from({ length: 30 }, (_, k) => mp(3, mac(100 + k), "Port 7"));
  const r = run(input({ macPorts: [...rows, ...rows.map((x) => mp(2, x.mac, "Port 1"))] }));
  assert.equal(r.clientCount["dev:3"], 30);
  assert.equal(r.clientCount["dev:2"], undefined);
});

test("server attaccato: collegamento mac_table, non client; un LLDP già presente non si raddoppia; la workstation è client", () => {
  const srv = "02:00:00:00:aa:01", ws = "02:00:00:00:aa:02";
  const hosts = [
    host(10, { ip: "10.0.1.10", mac: srv, classification: "server_linux", hostname: "srv-10" }),
    host(11, { ip: "10.0.1.11", mac: ws, classification: "workstation", hostname: "pc-11" }),
  ];
  const r = run(input({ hosts, macPorts: [mp(2, srv, "Port 2"), mp(2, ws, "Port 3")] }));
  assert.equal(r.attachLinks.length, 1);
  const l = r.attachLinks[0];
  assert.equal(l.source, "mac_table");
  assert.equal(l.a, "dev:2");
  assert.equal(l.aPort, "Port 2");
  assert.equal(l.b, "host:10");
  assert.deepEqual(r.portClients.map((p) => [p.port, p.clients.map((c) => [c.mac.toLowerCase(), c.name, c.ip])]),
    [["Port 3", [[ws, "pc-11", "10.0.1.11"]]]]);

  // già collegato da LLDP: nessun collegamento in più
  const neighbors = [
    ...input().neighbors,
    { device_id: 2, local_port: "Port 2", remote_device_name: "srv-10", remote_port: "", protocol: "lldp", remote_ip: "10.0.1.10", remote_mac: null, timestamp: RECENTE, source: "device" },
  ];
  const r2 = run(input({ hosts, neighbors, macPorts: [mp(2, srv, "Port 6")] }));
  assert.deepEqual(r2.attachLinks, []);
});

test("apparato trovato per MAC: un AP censito diventa un collegamento mac_table", () => {
  const apMac = "02:00:00:00:bb:01";
  const devices = [...input().devices, dev(8, { name: "AP-8", device_type: "access_point", host: "10.0.0.8" })];
  const r = run(input({ devices, knownMacs: [{ device_id: 8, mac: apMac }], macPorts: [mp(2, apMac, "Port 8")] }));
  assert.deepEqual(r.attachLinks.map((l) => [l.a, l.aPort, l.b, l.source]), [["dev:2", "Port 8", "dev:8", "mac_table"]]);
  assert.deepEqual(r.portClients, []);
});

test("vecchio: oltre la soglia è stale ma conta", () => {
  const r = run(input({ macPorts: [mp(3, mac(5), "Port 5", "2026-10-10 12:00:00")] }));
  assert.equal(r.portClients[0].clients[0].stale, true);
  assert.equal(r.clientCount["dev:3"], 1);
  assert.equal(r.portClients[0].clients[0].lastSeen, "2026-10-10 12:00:00");
});

test("stessi dati, stesso risultato", () => {
  const i = input({ macPorts: [mp(2, mac(1), "Port 3"), mp(3, mac(2), "Port 5"), mp(1, mac(2), "bridge")] });
  assert.deepEqual(run(i), run(i));
});
