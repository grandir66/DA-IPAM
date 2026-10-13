import { test } from "node:test";
import assert from "node:assert/strict";
import { anonimizzaInput } from "@/lib/topology/anonimizza";
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
  overrides: [], nowMs: Date.parse("2026-10-13T12:00:00Z"), staleDays: 2,
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
