import { test } from "node:test";
import assert from "node:assert/strict";
import { anonimizzaInput, contaValoriVeri } from "@/lib/topology/anonimizza";
import { buildTopologyModel } from "@/lib/topology/model";
import type { TopologyModelInput } from "@/lib/topology/model-types";
import { dev, host } from "./support/righe";

const VERO: TopologyModelInput = {
  devices: [
    dev(1, { name: "MK-RTR-CORE", host: "192.168.15.1", device_type: "router", controller_mac: "f4:1e:57:aa:bb:01" }),
    dev(2, { name: "USW-Piano1", host: "192.168.15.20", uplink_mac: "f4:1e:57:aa:bb:01", uplink_seen_at: "2026-10-13 03:00:00" }),
  ],
  hosts: [host(7, { ip: "192.168.20.5", mac: "F4-1E-57-AA-BB-01", hostname: "mk-rtr-core.domarc.local", network_id: 2 })],
  neighbors: [{ device_id: 2, local_port: "Port 1", remote_device_name: "MK-RTR-CORE", remote_port: "ether3", protocol: "lldp", remote_ip: null, remote_mac: null, timestamp: "2026-10-13 03:00:00", source: "unifi" }],
  uplinkPorts: [],
  locations: [{ id: 1, name: "Domarc Bergamo", parent_id: null, head_device_id: null }],
  networks: [
    { id: 1, cidr: "192.168.15.0/24", name: "LAN uffici", gateway: "192.168.15.1", location_id: 1 },
    { id: 2, cidr: "192.168.20.0/24", name: "Server", gateway: "192.168.20.1", location_id: 1 },
  ],
  knownMacs: [{ device_id: 1, mac: "f4:1e:57:aa:bb:01" }],
  overrides: [], macPorts: [], nowMs: Date.parse("2026-10-13T12:00:00Z"), staleDays: 2,
};

test("nessun nome, IP o MAC vero esce", () => {
  const testo = JSON.stringify(anonimizzaInput(VERO));
  for (const vero of ["MK-RTR-CORE", "USW-Piano1", "domarc", "Bergamo", "192.168.", "f4:1e:57", "F4-1E-57", "LAN uffici"]) {
    assert.equal(testo.toLowerCase().includes(vero.toLowerCase()), false, `«${vero}» è nella fixture`);
  }
});

test("la forma resta: stesso modello, stessi conteggi", () => {
  const prima = buildTopologyModel(VERO).counts;
  const dopo = buildTopologyModel(anonimizzaInput(VERO)).counts;
  assert.deepEqual(dopo, prima);
});

test("lo spazio degli indirizzi finito: errore, niente fixture", () => {
  const troppe = { ...VERO, networks: [{ id: 1, cidr: "0.0.0.0/0", name: "x", gateway: null, location_id: null }, { id: 2, cidr: "11.0.0.0/8", name: "y", gateway: null, location_id: null }] };
  assert.throws(() => anonimizzaInput(troppe));
});

test("una porta col nome dato dall'amministratore non esce; quelle di serie restano", () => {
  const conPorte: TopologyModelInput = {
    ...VERO,
    neighbors: [
      { ...VERO.neighbors[0], local_port: "ether5-Magazzino", remote_port: "GigabitEthernet1/0/24" },
      { ...VERO.neighbors[0], device_id: 1, local_port: "ether5-Magazzino", remote_port: "Port 1", remote_device_name: "USW-Piano1" },
    ],
    uplinkPorts: [{ device_id: 2, port_index: 1, port_name: "Uplink verso Bergamo" }],
  };
  const out = anonimizzaInput(conPorte);
  const testo = JSON.stringify(out).toLowerCase();
  assert.equal(testo.includes("magazzino"), false);
  assert.equal(testo.includes("bergamo"), false);
  assert.equal(out.neighbors[0].remote_port, "GigabitEthernet1/0/24");
  assert.equal(out.neighbors[1].remote_port, "Port 1");
  // la stessa porta vera ha lo stesso pseudonimo
  assert.equal(out.neighbors[0].local_port, out.neighbors[1].local_port);
  assert.match(out.neighbors[0].local_port, /^porta-\d+$/);
  assert.deepEqual(buildTopologyModel(out).counts, buildTopologyModel(conPorte).counts);
});

test("un nome vuoto: l'host resta senza nome, l'apparato prende una sigla", () => {
  const vuoti: TopologyModelInput = {
    ...VERO,
    devices: [...VERO.devices, dev(3, { name: " ", host: "192.168.15.30" })],
    hosts: [...VERO.hosts, host(8, { ip: "192.168.20.6", hostname: "", custom_name: "  " })],
  };
  const out = anonimizzaInput(vuoti);
  assert.equal(out.hosts[1].hostname, null);
  assert.equal(out.hosts[1].custom_name, null);
  assert.match(out.devices[2].name, /^SW-\d+$/);
  assert.deepEqual(buildTopologyModel(out).counts, buildTopologyModel(vuoti).counts);
});

test("una porta a forma di IP o di MAC passa per l'IP o il MAC finto", () => {
  const conPorte: TopologyModelInput = {
    ...VERO,
    neighbors: [
      { ...VERO.neighbors[0], local_port: "192.168.15.1", remote_port: "f4:1e:57:aa:bb:01" },
      { ...VERO.neighbors[0], local_port: "f41e.57aa.bb01", remote_port: "F41E57AABB01" },
    ],
  };
  const out = anonimizzaInput(conPorte);
  assert.equal(out.neighbors[0].local_port, out.devices[0].host);
  assert.equal(out.neighbors[0].remote_port, out.devices[0].controller_mac);
  assert.equal(out.neighbors[1].local_port, out.devices[0].controller_mac);
  assert.equal(out.neighbors[1].remote_port, out.devices[0].controller_mac);
  assert.equal(contaValoriVeri(conPorte, out).ip + contaValoriVeri(conPorte, out).mac, 0);
});

test("il conto dei valori veri: zero sull'anonimo, li trova se ci sono", () => {
  assert.deepEqual(contaValoriVeri(VERO, anonimizzaInput(VERO)), { ip: 0, mac: 0, nomi: 0 });
  const fuga = anonimizzaInput(VERO);
  fuga.neighbors[0].local_port = "uplink 192.168.20.5";
  fuga.neighbors[0].remote_port = "F41E.57AA.BB01";
  fuga.hosts[0].hostname = "USW-Piano1";
  fuga.uplinkPorts = [{ device_id: 1, port_index: 1, port_name: "verso bergamo" }];
  const c = contaValoriVeri(VERO, fuga);
  assert.equal(c.ip, 1);
  assert.equal(c.mac, 1);
  // «usw-piano1» (chiave del nome) e «bergamo» (parola di un nome di ubicazione)
  assert.equal(c.nomi, 2);
});

test("macPorts: stesso MAC vero, stesso MAC finto di host e vicini; porte dal vocabolario; nessun valore vero", () => {
  const i = {
    ...VERO,
    macPorts: [
      { device_id: 2, mac: "F4-1E-57-AA-BB-01", port_name: "Port 1", timestamp: "2026-10-13 10:00:00", source: "device" },
      { device_id: 2, mac: "aa:bb:cc:dd:ee:ff", port_name: "Sala riunioni", timestamp: "2026-10-13 10:00:00", source: "unifi" },
    ],
  };
  const a = anonimizzaInput(i);
  assert.equal(a.macPorts[0].mac, a.hosts[0].mac, "lo stesso MAC vero ha lo stesso MAC finto");
  assert.match(a.macPorts[1].mac, /^02:0[0-9a-f](:[0-9a-f]{2}){4}$/);
  assert.equal(a.macPorts[0].port_name, "Port 1");
  assert.match(a.macPorts[1].port_name, /^porta-\d+$/);
  assert.deepEqual([a.macPorts[0].device_id, a.macPorts[0].timestamp, a.macPorts[1].source], [2, "2026-10-13 10:00:00", "unifi"]);
  assert.deepEqual(contaValoriVeri(i, JSON.parse(JSON.stringify(a))), { ip: 0, mac: 0, nomi: 0 });
  assert.equal(contaValoriVeri(i, { x: "visto aabbccddeeff" }).mac, 1);
});
