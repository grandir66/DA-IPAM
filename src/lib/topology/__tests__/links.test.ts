import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLinks, isPhysicalPort } from "@/lib/topology/links";
import { buildNodeIndex } from "@/lib/topology/node-index";
import type { ModelNeighborRow, TopologyModelInput } from "@/lib/topology/model-types";
import { dev, host } from "./support/righe";

const ADESSO = Date.parse("2026-10-13T12:00:00Z");

function input(over: Partial<TopologyModelInput>): TopologyModelInput {
  return {
    devices: [], hosts: [], neighbors: [], uplinkPorts: [], locations: [], networks: [], knownMacs: [],
    overrides: [], macPorts: [], primaries: [], portInfo: [], vms: [], scanHosts: [], nowMs: ADESSO, staleDays: 2, ...over,
  };
}
function nb(device_id: number, over: Partial<ModelNeighborRow> = {}): ModelNeighborRow {
  return {
    device_id, local_port: "Port 1", remote_device_name: "", remote_port: "", protocol: "lldp",
    remote_ip: null, remote_mac: null, timestamp: "2026-10-13 03:00:00", source: "device", ...over,
  };
}
function run(i: TopologyModelInput) {
  return buildLinks(i, buildNodeIndex(i.devices, i.hosts, i.knownMacs));
}

test("vicino abbinato per MAC quando IP e nome non bastano", () => {
  const i = input({
    devices: [dev(1), dev(2, { name: "USW-AGG", controller_mac: "aa:bb:cc:00:00:02" })],
    neighbors: [nb(1, { remote_device_name: "aggregation", remote_mac: "AA:BB:CC:00:00:02", remote_port: "Port 3" })],
  });
  const { links, unmatched } = run(i);
  assert.equal(unmatched.length, 0);
  assert.deepEqual(links.map((l) => [l.a, l.aPort, l.b, l.bPort, l.source]), [["dev:1", "Port 1", "dev:2", "Port 3", "lldp"]]);
});

test("vicino che non si abbina a niente: contato, non inventato", () => {
  const { links, unmatched } = run(input({ devices: [dev(1)], neighbors: [nb(1, { remote_device_name: "sconosciuto", remote_ip: "10.9.9.9" })] }));
  assert.equal(links.length, 0);
  assert.deepEqual(unmatched, [{ deviceNodeId: "dev:1", localPort: "Port 1", remoteName: "sconosciuto", remoteIp: "10.9.9.9", remoteMac: null }]);
});

test("uplink UniFi: collegamento dal figlio al padre con le porte; con LLDP sulla stessa coppia vince l'uplink", () => {
  const i = input({
    devices: [
      dev(1, { controller_mac: "aa:bb:cc:00:00:01" }),
      dev(2, { uplink_mac: "aa:bb:cc:00:00:01", uplink_remote_port: 7, uplink_seen_at: "2026-10-13 03:00:00" }),
    ],
    uplinkPorts: [{ device_id: 2, port_index: 25, port_name: "SFP+ 1" }],
    neighbors: [nb(1, { local_port: "Port 7", remote_ip: "10.0.0.2", remote_port: "", timestamp: "2026-10-10 03:00:00" })],
  });
  const [l] = run(i).links;
  assert.equal(l.source, "unifi_uplink");
  assert.deepEqual(l.sources, ["unifi_uplink", "lldp"]);
  assert.equal(l.uplinkFrom, "dev:2");
  assert.deepEqual([l.a, l.aPort, l.b, l.bPort], ["dev:2", "SFP+ 1", "dev:1", "Port 7"]);
  assert.equal(l.lastSeen, "2026-10-13 03:00:00", "l'ultima volta è la più recente fra le fonti");
  assert.equal(l.stale, false);
});

test("uplink verso un MAC che il DB non conosce: nessun collegamento, nessun errore", () => {
  assert.equal(run(input({ devices: [dev(2, { uplink_mac: "de:ad:00:00:00:01", uplink_seen_at: "2026-10-13 03:00:00" })] })).links.length, 0);
});

test("la correzione manuale vince su LLDP: «ignora» toglie, «aggiungi» non invecchia mai", () => {
  const base = { devices: [dev(1), dev(2), dev(3)], neighbors: [nb(1, { remote_ip: "10.0.0.2", timestamp: "2026-09-01 03:00:00" })] };
  const ignorato = run(input({ ...base, overrides: [{ id: 1, action: "ignore", a_node: "dev:2", a_port: "", b_node: "dev:1", b_port: "", medium: null }] }));
  assert.equal(ignorato.links.length, 0);
  const aggiunto = run(input({ ...base, overrides: [{ id: 2, action: "add", a_node: "dev:1", a_port: "Port 9", b_node: "dev:3", b_port: "Port 1", medium: null }] }));
  const man = aggiunto.links.find((l) => l.source === "manual")!;
  assert.deepEqual([man.a, man.aPort, man.b, man.bPort, man.stale, man.daysUnseen], ["dev:1", "Port 9", "dev:3", "Port 1", false, null]);
});

test("una correzione su un host poi promosso segue il nodo (Review Focus 4)", () => {
  const i = input({
    devices: [dev(1), dev(2, { host_id: 40, host: "10.0.1.40" })],
    hosts: [host(40, { ip: "10.0.1.40" })],
    overrides: [{ id: 1, action: "add", a_node: "dev:1", a_port: "", b_node: "host:40", b_port: "", medium: null }],
  });
  assert.deepEqual(run(i).links.map((l) => [l.a, l.b]), [["dev:1", "dev:2"]]);
});

test("un collegamento sparito diventa «non visto», non scompare; date in due formati (Review Focus 6)", () => {
  const i = input({
    devices: [dev(1), dev(2), dev(3), dev(4)],
    neighbors: [
      nb(1, { remote_ip: "10.0.0.2", timestamp: "2026-10-10 11:00:00" }),
      nb(1, { local_port: "Port 2", remote_ip: "10.0.0.3", timestamp: "2026-10-12T12:00:00Z" }),
      nb(1, { local_port: "Port 3", remote_ip: "10.0.0.4", timestamp: null }),
    ],
  });
  const per = new Map(run(i).links.map((l) => [l.b, l]));
  assert.deepEqual([per.get("dev:2")?.stale, per.get("dev:2")?.daysUnseen], [true, 3]);
  assert.deepEqual([per.get("dev:3")?.stale, per.get("dev:3")?.daysUnseen], [false, 1]);
  assert.deepEqual([per.get("dev:4")?.stale, per.get("dev:4")?.daysUnseen], [false, null]);
});

test("stessi dati in ordine diverso: stesso risultato", () => {
  const neighbors = [
    nb(1, { remote_ip: "10.0.0.2" }), nb(2, { remote_ip: "10.0.0.1", local_port: "Port 5", remote_port: "Port 1" }),
    nb(3, { remote_ip: "10.0.0.1", local_port: "Port 2" }),
  ];
  const devices = [dev(1), dev(2), dev(3)];
  const a = run(input({ devices, neighbors }));
  const b = run(input({ devices: [...devices].reverse(), neighbors: [...neighbors].reverse() }));
  assert.deepEqual(a, b);
});

// Spec §11.1: un router aggiunge solo gli apparati direttamente collegati.
const rtr = (id: number) => dev(id, { name: `RTR-${id}`, device_type: "router", vendor: "mikrotik" });
const via = (n: number, over: Partial<ModelNeighborRow> = {}) => nb(1, { remote_ip: `10.0.0.${n}`, remote_device_name: `SW-${n}`, protocol: "mndp", ...over });

test("router: cinque vicini MNDP sul bridge non creano collegamenti", () => {
  const i = input({
    devices: [rtr(1), dev(2), dev(3), dev(4), dev(5), dev(6)],
    neighbors: [2, 3, 4, 5, 6].map((n) => via(n, { local_port: "bridge" })),
  });
  const { links, unmatched } = run(i);
  assert.deepEqual(links, []);
  assert.equal(unmatched.length, 0, "i vicini abbinati restano abbinati: non diventano «non abbinati»");
});

test("router: un solo vicino LLDP su una porta fisica è diretto", () => {
  const i = input({ devices: [rtr(1), dev(2)], neighbors: [via(2, { local_port: "ether3", protocol: "lldp" })] });
  assert.deepEqual(run(i).links.map((l) => [l.a, l.aPort, l.b, l.source]), [["dev:1", "ether3", "dev:2", "lldp"]]);
});

test("router: porte logiche (VLAN, VRRP, sottointerfacce, tunnel, bridge in testa a una lista) non sono dirette", () => {
  for (const porta of ["vlan10", "vrrp1", "ether1.20", "eoip-tunnel1", "wlan1", "bridge,ether3"]) {
    const i = input({ devices: [rtr(1), dev(2)], neighbors: [via(2, { local_port: porta })] });
    assert.deepEqual(run(i).links, [], porta);
  }
});

test("router: tre vicini su ether1, solo lo switch che vede il router sulla sua Port 24 è collegato", () => {
  const i = input({
    devices: [rtr(1), dev(2), dev(3), dev(4)],
    neighbors: [
      via(2, { local_port: "ether1" }), via(3, { local_port: "ether1" }), via(4, { local_port: "ether1" }),
      nb(3, { local_port: "Port 24", remote_ip: "10.0.0.1", remote_device_name: "RTR-1", remote_port: "ether1" }),
    ],
  });
  assert.deepEqual(run(i).links.map((l) => [l.a, l.b]), [["dev:1", "dev:3"]]);
});

test("router: due vicini su una porta fisica, confermati dall'uplink UniFi dell'altro lato", () => {
  const i = input({
    devices: [rtr(1), dev(2, { uplink_mac: "aa:bb:cc:00:00:01", uplink_seen_at: "2026-10-13 03:00:00" }), dev(3)],
    neighbors: [via(2, { local_port: "ether1" }), via(3, { local_port: "ether1" })],
  });
  i.devices[0].controller_mac = "aa:bb:cc:00:00:01";
  assert.deepEqual(run(i).links.map((l) => [l.a, l.b, l.source]).sort(), [["dev:2", "dev:1", "unifi_uplink"]].sort());
});

test("switch (non router) con più vicini su una porta: comportamento invariato", () => {
  const i = input({
    devices: [dev(1), dev(2), dev(3)],
    neighbors: [via(2, { local_port: "bridge" }), via(3, { local_port: "bridge" })],
  });
  assert.deepEqual(run(i).links.map((l) => [l.a, l.b]), [["dev:1", "dev:2"], ["dev:1", "dev:3"]]);
});

// Task 1b: `ether1-2.5` è una porta da 2,5G rinominata (su tutti e tre i router del cliente A), e MNDP
// riporta la porta di un bridge come «ether3,bridge»: sono porte fisiche. Si decide dal prefisso.
test("porta fisica: ether1-2.5 e «ether3,bridge» sì; VLAN, sottointerfacce, tunnel e wlan no", () => {
  for (const p of ["ether1-2.5", "ether3,bridge", "ether7", "sfp-sfpplus1", "sfp1", "sfp28-1", "combo1", "qsfp28-1-1", "bond1", "Port 24", "GigabitEthernet0/1"]) {
    assert.equal(isPhysicalPort(p), true, p);
  }
  for (const p of ["", "bridge", "bridge,ether3", "vlan10", "vrrp_vlan10", "ether1.20", "eoip-tunnel1", "wlan1", "wifi1", "wg0", "lo", "pppoe-out1", "Gi0/1.10"]) {
    assert.equal(isPhysicalPort(p), false, p);
  }
});

test("router: un solo vicino MNDP su «ether3,bridge» è diretto, sulla porta ether3", () => {
  const i = input({ devices: [rtr(1), dev(2)], neighbors: [via(2, { local_port: "ether3,bridge" })] });
  assert.deepEqual(run(i).links.map((l) => [l.a, l.aPort, l.b, l.source]), [["dev:1", "ether3", "dev:2", "mndp"]]);
});

// Task 1b: MNDP è un broadcast UDP e attraversa gli switch: «ti vedo e mi vedi» via MNDP non prova un cavo.
// Sul cliente A il router 1 sentiva il router 2 su ether1-2.5, che invece va allo switch 112 (LLDP).
function dueRouter(protocollo: "mndp" | "lldp") {
  return input({
    devices: [rtr(1), rtr(2), dev(3), dev(4)],
    neighbors: [
      nb(1, { local_port: "ether1-2.5", remote_ip: "10.0.0.3", remote_device_name: "SW-3", protocol: "lldp" }),
      nb(1, { local_port: "ether1-2.5", remote_ip: "10.0.0.2", remote_device_name: "RTR-2", protocol: protocollo }),
      nb(2, { local_port: "ether3", remote_ip: "10.0.0.1", remote_device_name: "RTR-1", protocol: protocollo }),
      nb(2, { local_port: "ether3", remote_ip: "10.0.0.4", remote_device_name: "SW-4", protocol: "lldp" }),
      nb(3, { local_port: "Port 47", remote_ip: "10.0.0.1", remote_device_name: "RTR-1", remote_port: "ether1-2.5", protocol: "lldp" }),
    ],
  });
}

test("router: MNDP su ether1-2.5 confermato dai due lati via MNDP → nessun collegamento fra i router", () => {
  const coppie = run(dueRouter("mndp")).links.map((l) => [l.a, l.b]);
  assert.ok(!coppie.some(([a, b]) => a === "dev:1" && b === "dev:2"), JSON.stringify(coppie));
  assert.ok(coppie.some(([a, b]) => a === "dev:1" && b === "dev:3"), "lo switch che vede il router via LLDP resta");
});

test("router: lo stesso caso via LLDP dai due lati → collegamento fra i router", () => {
  const l = run(dueRouter("lldp")).links.find((x) => x.a === "dev:1" && x.b === "dev:2");
  assert.ok(l);
  assert.equal(l.source, "lldp");
});
