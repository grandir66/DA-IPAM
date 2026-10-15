import { traduciMikrotikLocale, traduciMikrotikRemoto } from "@/lib/topology/lettori/mikrotik";
import { test } from "node:test";
import assert from "node:assert/strict";
import { anonimizzaInput, contaValoriVeri, ingressoDellaFixture, portaAnonima, porteInChiaro } from "@/lib/topology/anonimizza";
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
  overrides: [], macPorts: [], primaries: [], portInfo: [], vms: [], scanHosts: [], nowMs: Date.parse("2026-10-13T12:00:00Z"), staleDays: 2,
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

test("le VM e gli host dei cluster non entrano nelle fixture: nomi, IP e MAC dei clienti restano fuori", () => {
  const conVm: TopologyModelInput = {
    ...VERO,
    vms: [{ scannedDeviceId: 1, vmid: 100, name: "SRV-CLIENTE-X", node: "px-cliente", status: "running", type: "qemu", macs: ["BC:24:11:AA:BB:CC"], ips: ["192.168.15.77"], scannedAt: null }],
    scanHosts: [{ scannedDeviceId: 1, hostname: "px-cliente", ips: ["192.168.15.5"], macs: ["BC:24:11:AA:BB:01"] }],
  };
  const anonimo = anonimizzaInput(conVm);
  assert.deepEqual([anonimo.vms, anonimo.scanHosts], [[], []]);
  assert.equal(JSON.stringify(anonimo).includes("CLIENTE"), false);
});

// Spec topologia §13.12.2: nella fixture del cliente A 329 nomi di porta su 676 erano «porta-N», proprio quelli su cui
// si basa T1. I nomi di serie che mancavano restano; un nome composto si anonimizza pezzo per pezzo (la parte di serie
// resta e il traduttore la legge come sul dato vero); un nome scelto dal cliente resta anonimo.
test("T1: nomi di serie in più; nomi composti pezzo per pezzo; l'interfaccia logica tiene il prefisso", () => {
  const conPorte: TopologyModelInput = {
    ...VERO,
    neighbors: [
      { ...VERO.neighbors[0], device_id: 1, local_port: "sfp28-1,bond1,LAN_BERGAMO", remote_port: "LAN_BERGAMO/sfp-sfpplus2", remote_platform: "MikroTik" },
      { ...VERO.neighbors[0], local_port: "SFP_ 17 - nodo-bergamo", remote_port: "ether1-2.5", remote_platform: "US48P500" },
      { ...VERO.neighbors[0], local_port: "vlan10-Magazzino", remote_port: "vrrp_rete_12" },
      { ...VERO.neighbors[0], local_port: "ether3,bridge", remote_port: "bridge/bond1/wlan60-1" },
    ],
    ports: [{ device_id: 2, port_index: 17, port_name: "SFP+ 17 - nodo-bergamo", speed: "10000 Mbps", status: "up", stp_state: "forwarding" }],
  };
  const out = anonimizzaInput(conPorte);
  const testo = JSON.stringify(out).toLowerCase();
  assert.equal(testo.includes("bergamo"), false);
  assert.equal(testo.includes("magazzino"), false);
  const [a, b, c, d] = out.neighbors;
  assert.match(a.local_port, /^sfp28-1,bond1,porta-\d+$/);
  assert.match(a.remote_port, /^porta-\d+\/sfp-sfpplus2$/);
  assert.equal(a.local_port.split(",")[2], a.remote_port.split("/")[0], "lo stesso bridge ha lo stesso pseudonimo");
  assert.match(b.local_port, /^SFP_ 17 - porta-\d+$/);
  assert.equal(out.ports?.[0].port_name, `SFP+ 17 - ${b.local_port.split(" - ")[1]}`, "la descrizione ha lo stesso pseudonimo nell'elenco e nell'LLDP");
  assert.equal(b.remote_port, "ether1-2.5");
  assert.match(c.local_port, /^vlan-porta-\d+$/);
  assert.match(c.remote_port, /^vrrp-porta-\d+$/, "un nome VRRP scelto dal cliente diventa uno pseudonimo, logico come il vero");
  assert.deepEqual([d.local_port, d.remote_port], ["ether3,bridge", "bridge/bond1/wlan60-1"]);
  assert.deepEqual([a.remote_platform, b.remote_platform, c.remote_platform], ["MikroTik", "altro", undefined]);
  for (const n of out.neighbors) for (const p of [n.local_port, n.remote_port]) assert.equal(portaAnonima(p), true, p);
});

test("T1: chi ha fatto una correzione non entra nella fixture; quando sì", () => {
  const out = anonimizzaInput({ ...VERO, overrides: [{ id: 1, action: "ignore", a_node: "dev:1", a_port: "ether8", b_node: "dev:2", b_port: "Port 15", medium: null, created_by: "mario.rossi", created_at: "2026-10-14 10:07:00" }] });
  assert.deepEqual([out.overrides[0].created_by, out.overrides[0].created_at], [null, "2026-10-14 10:07:00"]);
});

// Spec §13.12.2 e G17 (vincolo 9): un nome scelto dal cliente diventa uno pseudonimo, mai un nome di fabbrica; il traduttore
// legge lo pseudonimo come il nome vero (stessi fatti), così le prove sulle fixture girano su nomi scelti e non di fabbrica.
// Il bridge e le VLAN coi nomi scelti della rete B (qui inventati, col loro disegno) restano «non noti» e «nel bridge».
test("T1, G17: lo pseudonimo di un nome scelto dà al traduttore gli stessi fatti del nome vero", () => {
  const scelti = ["sfp28-1,bond1,BR_QX", "VL_44_ZETA", "sfp-sfpplus1,BR_QX", "BR_QX/sfp-sfpplus12"];
  const out = anonimizzaInput({ ...VERO, neighbors: scelti.map((p) => ({ ...VERO.neighbors[0], device_id: 1, local_port: p, remote_port: p, remote_platform: "MikroTik" })) });
  const fatti = (p: string) => { const l = traduciMikrotikLocale(p); return [l.fisica, l.senzaFili, l.nelBridge, l.fascio]; };
  scelti.forEach((p, k) => {
    assert.deepEqual(fatti(out.neighbors[k].local_port), fatti(p), p);
    const [r, v] = [traduciMikrotikRemoto(out.neighbors[k].remote_port), traduciMikrotikRemoto(p)];
    assert.deepEqual([r.fisica, r.senzaFili, r.nelBridge, r.fascio], [v.fisica, v.senzaFili, v.nelBridge, v.fascio], p);
  });
  assert.equal(JSON.stringify(out).includes("QX"), false);
  assert.equal(JSON.stringify(out).includes("ZETA"), false);
});

// Spec §13.12.2. Verifica del 15/10: un'alternativa allargata di PORTA_GENERICA («vrrp_rete_N», il disegno dei nomi che un cliente
// dà alle sue VRRP) avrebbe pubblicato i nomi veri come «di serie»; il controllo dei nomi degli oggetti non guarda le porte.
// Il secondo controllo usa un elenco chiuso di nomi di fabbrica e si ferma su ogni altro pezzo rimasto uguale al vero.
test("porteInChiaro: un nome scelto rimasto uguale al vero ferma l'estrazione; i nomi di fabbrica no", () => {
  const conPorte: TopologyModelInput = {
    ...VERO,
    neighbors: [
      { ...VERO.neighbors[0], local_port: "sfp28-1,bond1,LAN_BERGAMO", remote_port: "Port 47" },
      { ...VERO.neighbors[0], local_port: "ether1-2.5", remote_port: "vrrp_rete_12" },
      { ...VERO.neighbors[0], local_port: "SFP_ 17 - nodo-bergamo", remote_port: "bridge/bond1/wlan60-1" },
    ],
  };
  const out = anonimizzaInput(conPorte);
  assert.equal(porteInChiaro(conPorte, out), 0);
  const fuga = { ...out, neighbors: out.neighbors.map((n, k) => (k === 1 ? { ...n, remote_port: "vrrp_rete_12" } : n)) };
  assert.equal(porteInChiaro(conPorte, fuga), 1, "lo pseudonimo tolto: il nome vero torna, e il controllo lo vede");
  const bridge = { ...out, neighbors: out.neighbors.map((n, k) => (k === 0 ? { ...n, local_port: "sfp28-1,bond1,LAN_BERGAMO" } : n)) };
  assert.equal(porteInChiaro(conPorte, bridge), 1, "anche un pezzo di un nome composto");
});

// Revisione del piano (15/10): la fixture non ha VM, e dalla fase 2b le VM cambiano il modello. L'estrazione confronta la
// fixture con l'ingresso vero senza le VM: i conteggi del modello devono coincidere.
test("ingressoDellaFixture: senza VM né host dei cluster; la fixture anonima dà gli stessi conteggi del modello", () => {
  const conVm: TopologyModelInput = {
    ...VERO,
    vms: [{ scannedDeviceId: 1, vmid: 100, name: "vm-vera", node: "pve-vero", status: "running", type: "qemu", macs: ["02:00:00:aa:bb:09"], ips: ["192.0.2.9"], scannedAt: "2026-10-13T06:00:00.000Z" }],
    scanHosts: [{ scannedDeviceId: 1, hostname: "pve-vero", ips: ["192.0.2.9"], macs: [] }],
  };
  const r = ingressoDellaFixture(conVm);
  assert.deepEqual([r.vms, r.scanHosts], [[], []]);
  assert.deepEqual(buildTopologyModel(anonimizzaInput(r)).counts, buildTopologyModel(r).counts);
});
