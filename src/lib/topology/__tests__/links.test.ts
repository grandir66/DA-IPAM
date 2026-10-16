import { test } from "node:test";
import assert from "node:assert/strict";
import { caviFra } from "@/lib/topology/ignored-links";
import { buildLinks, righeUltimoGiro } from "@/lib/topology/links";
import { buildNodeIndex } from "@/lib/topology/node-index";
import type { ModelNeighborRow, TopologyModelInput } from "@/lib/topology/model-types";
import { REGOLE_T1, type RegolaUniversale } from "@/lib/topology/regole";
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

// Spec §13.9 (D3). Incidente del 14/10: «Ignora» toglieva la COPPIA, e con la linea cucita «porta 10 ↔ ether8» è
// sparito anche il cavo vero a 10G. Ora toglie il cavo con quelle due porte (la pagina le scrive sempre, quelle della linea).
test("la correzione manuale vince su LLDP: «ignora» toglie il cavo con le sue porte, «aggiungi» non invecchia mai", () => {
  const base = { devices: [dev(1), dev(2), dev(3)], neighbors: [nb(1, { remote_ip: "10.0.0.2", timestamp: "2026-09-01 03:00:00" })] };
  const ignorato = run(input({ ...base, overrides: [{ id: 1, action: "ignore", a_node: "dev:2", a_port: "", b_node: "dev:1", b_port: "Port 1", medium: null }] }));
  assert.equal(ignorato.links.length, 0);
  assert.deepEqual([...ignorato.ignorati.usate], [1]);
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
const rtr = (id: number) => dev(id, { name: `RTR-${id}`, device_type: "router", vendor: "mikrotik", via: "ssh" });
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

test("uno switch con più vicini MNDP sulla stessa porta fisica: come prima (MNDP non fa un segmento)", () => {
  const i = input({ devices: [dev(1), dev(2), dev(3)], neighbors: [via(2, { local_port: "Port 3" }), via(3, { local_port: "Port 3" })] });
  assert.deepEqual(run(i).links.map((l) => [l.a, l.b]), [["dev:1", "dev:2"], ["dev:1", "dev:3"]]);
});

// I5 (spec §13.6.2): prima valeva solo per i router, e solo finché la coppia non era confermata (`links.ts:178-181`).
test("I5 — da un'interfaccia logica di chi osserva non nasce un cavo, router o switch", () => {
  const i = input({ devices: [dev(1), dev(2), dev(3)], neighbors: [via(2, { local_port: "bridge" }), via(3, { local_port: "bridge" })] });
  assert.deepEqual(run(i).links, []);
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

// Prima questa prova voleva il cavo fra i router: ognuno però sente due apparati via LLDP su quella porta, quindi in
// mezzo c'è un apparato che non si vede (la regola del segmento, decisa per T1 il 14/10 sera, §13.15 punto 2).
test("I7, M-5 — via LLDP dai due lati, ma ognuno sente due apparati su quella porta: segmento, nessun cavo fra i router", () => {
  const coppie = run(dueRouter("lldp")).links.map((l) => [l.a, l.b]);
  assert.ok(!coppie.some(([a, b]) => a === "dev:1" && b === "dev:2"), JSON.stringify(coppie));
});

test("due router che si vedono via LLDP dai due lati, ognuno unico apparato sulla sua porta: un cavo (radio trasparente, §13.7.6 punto 7)", () => {
  const i = input({
    devices: [rtr(1), rtr(2)],
    neighbors: [
      nb(1, { local_port: "ether4", remote_ip: "10.0.0.2", remote_device_name: "RTR-2", remote_port: "ether4", protocol: "lldp", remote_platform: "MikroTik" }),
      nb(2, { local_port: "ether4", remote_ip: "10.0.0.1", remote_device_name: "RTR-1", remote_port: "ether4", protocol: "lldp", remote_platform: "MikroTik" }),
    ],
  });
  assert.deepEqual(run(i).links.map((l) => [l.a, l.aPort, l.b, l.bPort, l.source]), [["dev:1", "ether4", "dev:2", "ether4", "lldp"]]);
});

// ─── Spec §13.7.1: la sede 1 del cliente A in piccolo ───
// Router 1 (dev:1), accesso A (dev:112), core 1 (dev:114), router di riserva (host:7, censito solo come host). Le righe
// del router come le scrive il lettore di T1; quelle di core 1 e di accesso A dal controller. Core 1 sale al router con
// l'uplink del controller, che non sa la porta del router (il router non è del controller).
const ORA = "2026-10-13 11:00:00", ORA_CONTROLLER = "2026-10-13 03:00:00";
const RTR_MAC = "02:00:00:00:00:01", CORE_MAC = "02:00:00:00:01:14", ACC_MAC = "02:00:00:00:01:12", RIS_MAC = "02:00:00:00:00:07";
const porta = (device_id: number, port_index: number, port_name: string, speed: string | null = null) =>
  ({ device_id, port_index, port_name, speed, status: "up", stp_state: null });

function sede1(): TopologyModelInput {
  const r = (local_port: string, remote_device_name: string, remote_port: string, remote_mac: string, protocol = "lldp", remote_platform: string | null = null) =>
    nb(1, { local_port, remote_device_name, remote_port, remote_mac, protocol, remote_platform, timestamp: ORA });
  const c = (device_id: number, local_port: string, remote_device_name: string, remote_port: string, remote_mac: string) =>
    nb(device_id, { local_port, remote_device_name, remote_port, remote_mac, protocol: "lldp", source: "unifi", timestamp: ORA_CONTROLLER });
  return input({
    devices: [
      rtr(1),
      dev(112, { name: "ACC-A", controller_mac: ACC_MAC, uplink_mac: CORE_MAC, uplink_remote_port: 9, uplink_seen_at: ORA_CONTROLLER, via: "api" }),
      dev(114, { name: "CORE-1", controller_mac: CORE_MAC, uplink_mac: RTR_MAC, uplink_seen_at: ORA_CONTROLLER, via: "api" }),
    ],
    hosts: [host(7, { ip: "10.0.9.2", mac: RIS_MAC, hostname: "RTR-RISERVA", classification: "router" })],
    knownMacs: [{ device_id: 1, mac: RTR_MAC }],
    uplinkPorts: [{ device_id: 114, port_index: 10, port_name: "Uplink verso il router" }, { device_id: 112, port_index: 50, port_name: "SFP+ 2" }],
    ports: [
      porta(1, 1, "ether1-2.5", "2500 Mbps"), porta(1, 3, "ether3", "1000 Mbps"), porta(1, 8, "ether8", "1000 Mbps"),
      porta(1, 9, "sfp-sfpplus1", "10000 Mbps"), porta(1, 10, "bridge"), porta(1, 11, "vlan10-uffici"),
      porta(114, 9, "Port 9", "10000 Mbps"), porta(114, 10, "Uplink verso il router", "10000 Mbps"), porta(114, 15, "Port 15 - WAN", "1000 Mbps"),
      porta(112, 47, "Port 47", "2500 Mbps"), porta(112, 50, "SFP+ 2", "10000 Mbps"),
    ],
    neighbors: [
      r("sfp-sfpplus1,bridge", "CORE-1", "Uplink verso il router", CORE_MAC),
      r("ether8", "CORE-1", "Port 15 - WAN", CORE_MAC),
      r("ether8", "RTR-RISERVA", "bridge/ether8", RIS_MAC, "lldp", "MikroTik"),
      r("ether1-2.5", "ACC-A", "Port 47", ACC_MAC),
      r("ether1-2.5", "RTR-RISERVA", "bridge/ether1-2.5", RIS_MAC, "mndp", "MikroTik"),
      r("vlan10-uffici", "RTR-RISERVA", "vlan10-uffici", RIS_MAC, "mndp", "MikroTik"),
      c(114, "Uplink verso il router", "RTR-1", "sfp-sfpplus1", RTR_MAC),
      c(114, "Port 15 - WAN", "RTR-1", "ether8", RTR_MAC),
      c(114, "Port 15 - WAN", "RTR-RISERVA", "ether8", RIS_MAC),
      c(114, "Port 9", "ACC-A", "SFP+ 2", ACC_MAC),
      c(112, "Port 47", "RTR-1", "ether1-2.5", RTR_MAC),
      c(112, "SFP+ 2", "CORE-1", "Port 9", CORE_MAC),
    ],
  });
}
const linea = (i: TopologyModelInput, id: string) => run(i).links.find((l) => l.id === id)!;

test("I6 — le porte di una linea vengono da una prova sola: l'uplink si completa con la riga LLDP di core 1 sulla sua porta di uplink", () => {
  const { links, segmenti } = run(sede1());
  const rc = links.find((l) => l.id === "link:dev:1|dev:114")!;
  assert.deepEqual([rc.a, rc.aPort, rc.b, rc.bPort, rc.sources, rc.uplinkFrom], ["dev:114", "Uplink verso il router", "dev:1", "sfp-sfpplus1", ["unifi_uplink", "lldp"], "dev:114"]);
  assert.equal(rc.altriCavi, undefined, "ether8 e la porta 15 non danno un cavo");
  assert.deepEqual(links.map((l) => l.id), ["link:dev:112|dev:114", "link:dev:1|dev:112", "link:dev:1|dev:114"]);
  assert.deepEqual([...segmenti.keys()].sort(), ["dev:114|port15-wan", "dev:1|ether8"]);
  assert.deepEqual([...segmenti.get("dev:1|ether8")!].sort(), ["dev:114", "host:7"]);
});

test("I4 — conferma per porta: core 1 vede router 1 sulla porta 10, non sulla 15 → la riga del router su ether8 non passa", () => {
  const i = sede1();
  // Senza il router di riserva e senza le righe della porta 15: ether8 non è un segmento, ma sente core 1 (LLDP) e un
  // altro router (MNDP), quindi non è «unico vicino» e serve la conferma sulla porta.
  i.neighbors = i.neighbors.filter((n) => n.remote_mac !== RIS_MAC && !(n.device_id === 114 && n.local_port === "Port 15 - WAN"));
  i.devices.push(rtr(2));
  i.neighbors.push(nb(1, { local_port: "ether8", remote_device_name: "RTR-2", remote_ip: "10.0.0.2", protocol: "mndp", remote_platform: "MikroTik", timestamp: ORA }));
  const rc = linea(i, "link:dev:1|dev:114");
  assert.deepEqual([rc.aPort, rc.bPort, rc.altriCavi], ["Uplink verso il router", "sfp-sfpplus1", undefined]);
});

test("I5 — la riga del router da una VLAN verso core 1, con la coppia confermata: niente", () => {
  const i = sede1();
  i.neighbors.push(nb(1, { local_port: "vlan10-uffici", remote_device_name: "CORE-1", remote_port: "Uplink verso il router", remote_mac: CORE_MAC, protocol: "lldp", timestamp: ORA }));
  assert.equal(linea(i, "link:dev:1|dev:114").altriCavi, undefined);
});

test("I7, C8 — la porta 15 di core 1 sente due apparati: non dà cavi; il router di riserva sta sotto accesso B, porta 16", () => {
  const i = sede1();
  i.devices.push(dev(78, { name: "ACC-B", controller_mac: "02:00:00:00:00:78", via: "api" }));
  // Il router di riserva annuncia solo da una VLAN: la sua porta non è nota.
  i.neighbors.push(nb(78, { local_port: "Port 16", remote_device_name: "RTR-RISERVA", remote_port: "vrrp_rete_7", remote_mac: RIS_MAC, source: "unifi", timestamp: ORA_CONTROLLER, remote_platform: "MikroTik" }));
  const ris = run(i).links.filter((l) => l.a === "host:7" || l.b === "host:7");
  assert.deepEqual(ris.map((l) => [l.a, l.aPort, l.b, l.bPort]), [["dev:78", "Port 16", "host:7", ""]]);
});

test("I15 — le righe dello stesso apparato sulla porta 10 di core 1 sono un gruppo; la riga VRRP col suo IP non porta sul nodo sbagliato", () => {
  const i = sede1();
  i.hosts.push(host(9, { ip: "10.0.9.254", hostname: "VIP-GATEWAY", classification: "server" }));
  i.neighbors.push(
    nb(114, { local_port: "Uplink verso il router", remote_device_name: "RTR-1", remote_port: "vrrp_rete_7", remote_ip: "10.0.9.254", remote_mac: RTR_MAC, source: "unifi", timestamp: ORA_CONTROLLER }),
    nb(114, { local_port: "Uplink verso il router", remote_device_name: "RTR-1", remote_port: "vlan10-uffici", remote_mac: RTR_MAC, source: "unifi", timestamp: ORA_CONTROLLER }),
  );
  const { links, segmenti } = run(i);
  assert.equal(links.some((l) => l.a === "host:9" || l.b === "host:9"), false, "nessuna linea verso il nodo dell'IP virtuale");
  assert.equal(segmenti.has("dev:114|uplinkversoilrouter"), false, "la porta 10 non diventa un segmento");
  const rc = links.find((l) => l.id === "link:dev:1|dev:114")!;
  assert.deepEqual([rc.aPort, rc.bPort, rc.altriCavi], ["Uplink verso il router", "sfp-sfpplus1", undefined]);
});

// I15 vale anche per un gruppo di una riga sola (revisione del piano, 15/10): una riga da una VRRP porta l'IP virtuale, che
// è di un altro nodo. Prima un gruppo di una riga si abbinava come una volta, cioè per IP per primo.
test("I15 — una riga sola da una VRRP, con l'IP virtuale che è di un altro nodo: si abbina per telaio, non all'IP", () => {
  const RTR = "02:00:00:00:00:01";
  const i = input({
    devices: [dev(5, { name: "SW-5", via: "api" }), rtr(1)],
    hosts: [host(9, { ip: "10.0.9.254", hostname: "VIP-GATEWAY", classification: "server" })],
    knownMacs: [{ device_id: 1, mac: RTR }],
    neighbors: [nb(5, { local_port: "Port 15", remote_device_name: "", remote_port: "vrrp_rete_7", remote_ip: "10.0.9.254", remote_mac: RTR, source: "unifi" })],
  });
  assert.deepEqual(run(i).links.map((l) => [l.a, l.b]), [["dev:5", "dev:1"]]);
});

test("I13 — «eth0» su uno switch che non ha quella porta: porta non nota, nessun segmento", () => {
  const i = input({
    devices: [dev(5, { name: "FLEX-5", via: "api" }), dev(6), dev(7)],
    ports: [porta(5, 1, "Port 1")],
    neighbors: [
      nb(5, { local_port: "eth0", remote_device_name: "SW-6", remote_ip: "10.0.0.6", source: "unifi" }),
      nb(5, { local_port: "eth0", remote_device_name: "SW-7", remote_ip: "10.0.0.7", source: "unifi" }),
    ],
  });
  const { links, segmenti } = run(i);
  assert.equal(segmenti.size, 0);
  assert.equal(links.length, 2, "le righe valgono come prima, con la porta da completare dall'altro capo");
});

test("I43 — un vicino vecchio non fa un segmento: dopo un ricablaggio il cavo nuovo c'è, il vecchio è «non visto»", () => {
  const i = input({
    devices: [dev(2, { via: "api" }), dev(3), dev(4)],
    neighbors: [
      nb(2, { local_port: "Port 5", remote_device_name: "SW-3", remote_ip: "10.0.0.3", source: "unifi", timestamp: "2026-10-09 03:00:00" }),
      nb(2, { local_port: "Port 5", remote_device_name: "SW-4", remote_ip: "10.0.0.4", source: "unifi", timestamp: "2026-10-13 03:00:00" }),
    ],
  });
  const { links, segmenti } = run(i);
  assert.equal(segmenti.size, 0);
  const per = new Map(links.map((l) => [l.b, l]));
  assert.deepEqual([per.get("dev:4")?.stale, per.get("dev:3")?.stale], [false, true]);
});

test("R-superata: la riga troncata di ieri lascia il posto a quella intera di oggi; un vicino sparito resta e invecchia", () => {
  const i = input({
    devices: [rtr(1), dev(112, { name: "ACC-A" })],
    knownMacs: [{ device_id: 112, mac: ACC_MAC }],
    neighbors: [
      nb(1, { local_port: "ether1-2.5", remote_device_name: "ACC-A", remote_port: "Port", remote_mac: ACC_MAC, protocol: "mndp", timestamp: "2026-10-13 10:00:00" }),
      nb(1, { local_port: "ether1-2.5", remote_device_name: "ACC-A", remote_port: "Port 47", remote_mac: ACC_MAC, protocol: "lldp", timestamp: "2026-10-13 11:00:00" }),
      nb(1, { local_port: "ether7", remote_device_name: "SW-SPARITO", remote_port: "Port 1", remote_mac: "02:00:00:00:09:99", protocol: "lldp", timestamp: "2026-10-01 11:00:00" }),
    ],
  });
  assert.deepEqual(righeUltimoGiro(i).map((n) => n.remote_port).sort(), ["Port 1", "Port 47"]);
  const l = run(i).links.find((x) => x.b === "dev:112")!;
  assert.deepEqual([l.aPort, l.bPort, l.source], ["ether1-2.5", "Port 47", "lldp"]);
});

test("Review Focus 1 — righe senza data o con una data illeggibile: restano, contano come attuali, niente errori", () => {
  const i = input({
    devices: [dev(2, { via: "api" }), dev(3), dev(4)],
    neighbors: [
      nb(2, { local_port: "Port 5", remote_device_name: "SW-3", remote_ip: "10.0.0.3", source: "unifi", timestamp: null }),
      nb(2, { local_port: "Port 6", remote_device_name: "SW-4", remote_ip: "10.0.0.4", source: "unifi", timestamp: "non è una data" }),
    ],
  });
  assert.equal(righeUltimoGiro(i).length, 2);
  assert.deepEqual(run(i).links.map((l) => [l.b, l.stale, l.daysUnseen]), [["dev:3", false, null], ["dev:4", false, null]]);
});

test("Review Focus 2 — il MAC VRRP non è un telaio: router 1 e router di riserva sulla stessa porta restano due apparati", () => {
  const VRRP = "00:00:5E:00:01:0A";
  const i = input({
    devices: [dev(5, { name: "SW-5", via: "api" }), rtr(1), rtr(8)],
    neighbors: [
      nb(5, { local_port: "Port 15", remote_device_name: "RTR-1", remote_port: "vrrp_rete_7", remote_mac: VRRP, source: "unifi" }),
      nb(5, { local_port: "Port 15", remote_device_name: "RTR-8", remote_port: "vrrp_rete_7", remote_mac: VRRP, source: "unifi" }),
    ],
  });
  const { links, segmenti } = run(i);
  assert.deepEqual([...segmenti.keys()], ["dev:5|port15"]);
  assert.deepEqual(links, []);
});

test("Review Focus 3 — lo stesso apparato sulla stessa porta dal controller e dalla lettura dell'apparato, con due telai: uno solo", () => {
  const i = input({
    devices: [dev(5, { name: "SW-5", via: "api" }), dev(6, { name: "SW-6", controller_mac: "02:00:00:00:00:06" })],
    knownMacs: [{ device_id: 6, mac: "02:00:00:00:06:01" }],
    neighbors: [
      nb(5, { local_port: "Port 3", remote_device_name: "SW-6", remote_mac: "02:00:00:00:00:06", source: "unifi" }),
      nb(5, { local_port: "Port 3", remote_device_name: "SW-6", remote_mac: "02:00:00:00:06:01", source: "device" }),
    ],
  });
  const { links, segmenti } = run(i);
  assert.equal(segmenti.size, 0);
  assert.deepEqual(links.map((l) => [l.a, l.b, l.sources]), [["dev:5", "dev:6", ["lldp"]]]);
});

test("H2 — router e aggregazione con due cavi: la linea ha le porte di un cavo (porta 31 ↔ sfp28-2), l'altro fra gli altri cavi visti", () => {
  const AGG = "02:00:00:00:00:11", RTR = "02:00:00:00:00:01";
  const i = input({
    devices: [rtr(1), dev(11, { name: "AGG-11", controller_mac: AGG, uplink_mac: RTR, uplink_seen_at: ORA_CONTROLLER, via: "snmp_v2" })],
    knownMacs: [{ device_id: 1, mac: RTR }],
    uplinkPorts: [{ device_id: 11, port_index: 31, port_name: "SFP28 31 - verso il router" }],
    ports: [porta(1, 1, "sfp28-1", "25000 Mbps"), porta(1, 2, "sfp28-2", "25000 Mbps"), porta(11, 31, "SFP28 31 - verso il router", "25000 Mbps"), porta(11, 32, "SFP28 32", "25000 Mbps")],
    neighbors: [
      nb(11, { local_port: "SFP28 31 - verso il router", remote_device_name: "RTR-1", remote_port: "sfp28-2", remote_mac: RTR, source: "unifi", timestamp: ORA_CONTROLLER }),
      nb(11, { local_port: "SFP28 31 - verso il router", remote_device_name: "RTR-1", remote_port: "VL_31_XY", remote_mac: RTR, source: "unifi", timestamp: ORA_CONTROLLER }),
      nb(11, { local_port: "SFP28 32", remote_device_name: "RTR-1", remote_port: "sfp28-1", remote_mac: RTR, source: "unifi", timestamp: ORA_CONTROLLER }),
      nb(1, { local_port: "sfp28-1,bond1,LAN_IN", remote_device_name: "AGG-11", remote_port: "SFP28 32", remote_mac: AGG, protocol: "mndp", timestamp: ORA }),
      nb(1, { local_port: "sfp28-2,bond1,LAN_IN", remote_device_name: "AGG-11", remote_port: "SFP28 31 - verso il router", remote_mac: AGG, protocol: "mndp", timestamp: ORA }),
    ],
  });
  const [l] = run(i).links;
  assert.deepEqual([l.a, l.aPort, l.b, l.bPort, l.sources], ["dev:11", "SFP28 31 - verso il router", "dev:1", "sfp28-2", ["unifi_uplink", "lldp", "mndp"]]);
  assert.deepEqual(l.altriCavi, [{ aPort: "SFP28 32", bPort: "sfp28-1", sources: ["lldp", "mndp"], lastSeen: ORA }]);
});

test("I47, H10 — un'interfaccia senza fili non è logica: il client dell'access point resta collegato, «≋ Wi-Fi»", () => {
  const i = input({
    devices: [dev(191, { name: "AP-191", device_type: "access_point", via: "api" }), dev(192, { name: "AP-192", device_type: "access_point" })],
    neighbors: [nb(191, { local_port: "wifi2ap9", remote_device_name: "AP-192", remote_ip: "10.0.0.192", source: "unifi" })],
  });
  const [l] = run(i).links;
  assert.deepEqual([l.a, l.aPort, l.b, l.medium], ["dev:191", "wifi2ap9", "dev:192", "wireless"]);
});

// ─── Passaggio universale (spec §13.16): le regole entrate in T1, scritte per ogni rete ───
/** Come `run`, con una regola del passaggio universale spenta (la misura C19 confronta «tutte» e «tutte meno una»). */
function senza(i: TopologyModelInput, regola: RegolaUniversale) {
  return buildLinks(i, buildNodeIndex(i.devices, i.hosts, i.knownMacs), new Map(), new Set([...REGOLE_T1].filter((r) => r !== regola)));
}
const RF_MAC = "02:00:00:00:00:21";
/** Il router di testa (dev:1) e un secondo router (dev:21) con due cavi diretti fra loro: la forma della rete B (l'hub). */
function testaEFrontiera(extra: ModelNeighborRow[]): TopologyModelInput {
  return input({
    devices: [rtr(1), dev(21, { name: "RTR-FRONTIERA", device_type: "router", vendor: "mikrotik", via: "ssh", host: "10.0.0.21" })],
    knownMacs: [{ device_id: 21, mac: RF_MAC }],
    ports: [porta(1, 1, "sfp-sfpplus1", "10000 Mbps"), porta(1, 3, "sfp-sfpplus3", "10000 Mbps"), porta(21, 2, "sfp-sfpplus2", "10000 Mbps"), porta(21, 4, "sfp-sfpplus4", "10000 Mbps")],
    neighbors: [
      nb(1, { local_port: "sfp-sfpplus1,BR_RP", remote_device_name: "RTR-FRONTIERA", remote_port: "sfp-sfpplus2", remote_mac: RF_MAC, protocol: "lldp", remote_platform: "MikroTik", timestamp: ORA }),
      nb(1, { local_port: "sfp-sfpplus3,BR_RP", remote_device_name: "RTR-FRONTIERA", remote_port: "sfp-sfpplus4", remote_mac: RF_MAC, protocol: "lldp", remote_platform: "MikroTik", timestamp: ORA }),
      ...extra,
    ],
  });
}
const porteDi = (l: { aPort: string; bPort: string; altriCavi?: Array<{ aPort: string; bPort: string }> }) => [l.aPort, l.bPort, ...(l.altriCavi ?? []).flatMap((c) => [c.aPort, c.bPort])];

// I58 (spec §13.12.3) e H7 anticipato per i MikroTik (§13.6.1; §13.7.1 passo 1 e quarta trappola). Rete B, 14/10: il router
// sente il router di frontiera su dieci VLAN dai nomi scelti, e su una è l'unico vicino: la mappa tracciava la linea fra i due
// da lì («VL_… ↔ VL_…»). Per un router col traduttore del suo prodotto un nome scelto non è una porta fisica.
test("I58, H7 — dalle righe di un MikroTik su un nome scelto nessun cavo: né come unico vicino, né confermato", () => {
  const i = testaEFrontiera([
    nb(1, { local_port: "VL_16_QWE", remote_device_name: "RTR-FRONTIERA", remote_port: "VL_16_QWE", remote_mac: RF_MAC, protocol: "mndp", remote_platform: "MikroTik", timestamp: ORA }),
    nb(1, { local_port: "XQ_7_ABC", remote_device_name: "RTR-FRONTIERA", remote_port: "sfp-sfpplus2", remote_mac: RF_MAC, protocol: "lldp", remote_platform: "MikroTik", timestamp: ORA }),
    nb(21, { local_port: "sfp-sfpplus2", remote_device_name: "RTR-1", remote_port: "XQ_7_ABC", remote_ip: "10.0.0.1", protocol: "lldp", remote_platform: "MikroTik", timestamp: ORA }),
  ]);
  const [l] = run(i).links;
  assert.deepEqual(porteDi(l).filter((p) => /^(VL_|XQ_)/.test(p)), [], JSON.stringify(l));
  assert.deepEqual([l.a, l.aPort, l.b, l.bPort], ["dev:1", "sfp-sfpplus1", "dev:21", "sfp-sfpplus2"]);
  assert.deepEqual(l.altriCavi?.map((c) => [c.aPort, c.bPort]), [["sfp-sfpplus3", "sfp-sfpplus4"]], "il secondo cavo vero fra gli altri cavi visti");
  const prima = senza(i, "nome-scelto-non-fisico").links[0];
  assert.equal(porteDi(prima).some((p) => /^(VL_|XQ_)/.test(p)), true, "spenta la regola (misura C19), il nome scelto torna");
});

// Spec §13.13.2: il prezzo di non indovinare dal nome (G2). Una porta fisica rinominata dal cliente su un MikroTik non dà cavi
// dalle righe del router; il cavo resta se l'altro capo è uno switch che lo vede, con la porta del router non nota.
test("Review Focus 8 — una porta fisica rinominata su un MikroTik: il cavo resta dal lato dello switch, la porta del router non nota", () => {
  const i = input({
    devices: [rtr(1), dev(5, { name: "SW-5", via: "api" })],
    ports: [porta(5, 9, "Port 9", "10000 Mbps")],
    neighbors: [
      nb(1, { local_port: "uplink-core", remote_device_name: "SW-5", remote_port: "Port 9", remote_ip: "10.0.0.5", protocol: "lldp", timestamp: ORA }),
      nb(5, { local_port: "Port 9", remote_device_name: "RTR-1", remote_port: "uplink-core", remote_ip: "10.0.0.1", protocol: "lldp", remote_platform: "MikroTik", source: "unifi", timestamp: ORA_CONTROLLER }),
    ],
  });
  assert.deepEqual(run(i).links.map((l) => [l.a, l.aPort, l.b, l.bPort, l.sources]), [["dev:5", "Port 9", "dev:1", "", ["lldp"]]]);
});

// I60 (spec §13.6.4; §13.7.1 passi 2 e 3b). Nelle righe di RouterOS il MAC è dell'interfaccia che ha mandato l'annuncio, non il
// telaio: sulla rete B il router di frontiera sentirebbe il router su una porta con due MAC (uno dalla porta, uno da una VLAN),
// cioè due «apparati», e la porta diventerebbe un segmento falso che toglie un cavo provato.
test("I60 — gli apparati di una porta si contano per apparato: lo stesso router con due MAC e un nome che identifica è uno", () => {
  const riga = (mac: string, remote_port: string, remote_device_name = "RTR-TESTA") =>
    nb(21, { local_port: "sfp-sfpplus4", remote_device_name, remote_port, remote_mac: mac, protocol: "lldp", remote_platform: "MikroTik", timestamp: ORA });
  const solo21 = (righe: ModelNeighborRow[]) => input({
    devices: [dev(21, { name: "RTR-FRONTIERA", device_type: "router", vendor: "mikrotik", via: "ssh" })], ports: [porta(21, 4, "sfp-sfpplus4", "10000 Mbps")], neighbors: righe,
  });
  const stesso = solo21([riga("02:00:A0:00:00:01", "VL_88_X"), riga("02:00:A0:00:00:03", "BR_RP/sfp-sfpplus3")]);
  assert.equal(run(stesso).segmenti.size, 0, "un apparato: nessun segmento");
  assert.equal(senza(stesso, "conto-per-apparato").segmenti.size, 1, "contato per MAC (regola spenta): il segmento falso");
  // guardie di identity.ts e node-index.ts: un nome di fabbrica non identifica; MAC di OUI diversi sono due oggetti
  assert.equal(run(solo21([riga("02:00:A0:00:00:01", "ether1", "MikroTik"), riga("02:00:A0:00:00:03", "ether2", "MikroTik")])).segmenti.size, 1);
  assert.equal(run(solo21([riga("02:00:A0:00:00:01", "ether1"), riga("02:00:B7:00:00:03", "ether2")])).segmenti.size, 1);
  // il controller dà il telaio: due telai restano due apparati anche col nome uguale
  const ctrl = input({ devices: [dev(5, { name: "SW-5", via: "api" })], neighbors: [
    nb(5, { local_port: "Port 3", remote_device_name: "AP-X", remote_mac: "02:00:A0:00:00:01", source: "unifi" }),
    nb(5, { local_port: "Port 3", remote_device_name: "AP-X", remote_mac: "02:00:A0:00:00:05", source: "unifi" }),
  ] });
  assert.equal(run(ctrl).segmenti.size, 1);
});

test("I60 — sul membro di un fascio l'aggregazione via LLDP e tre apparati via CDP inoltrato (scritti `mndp`): un cavo, non un segmento", () => {
  const AGG = "02:00:00:00:00:11";
  const i = input({
    devices: [rtr(1), dev(11, { name: "AGG-11", controller_mac: AGG, via: "api" }), dev(31), dev(32), dev(33)],
    knownMacs: [{ device_id: 1, mac: RTR_MAC }],
    ports: [porta(1, 1, "sfp28-1", "25000 Mbps"), porta(11, 32, "SFP28 32", "25000 Mbps")],
    neighbors: [
      nb(1, { local_port: "sfp28-1,bond1,BR_RP", remote_device_name: "AGG-11", remote_port: "SFP28 32", remote_mac: AGG, protocol: "lldp", timestamp: ORA }),
      // l'aggregazione vede il router sulla sua porta 32 (conferma per porta, passo 3c): le righe CDP inoltrate contano per
      // l'«unico vicino» (§11.1, come prima), non per il segmento
      nb(11, { local_port: "SFP28 32", remote_device_name: "RTR-1", remote_port: "sfp28-1", remote_mac: RTR_MAC, source: "unifi", timestamp: ORA_CONTROLLER }),
      ...[31, 32, 33].map((k) => nb(1, { local_port: "sfp28-1,bond1,BR_RP", remote_device_name: `SW-${k}`, remote_ip: `10.0.0.${k}`, remote_port: "ether1", protocol: "mndp", remote_platform: "MikroTik", timestamp: ORA })),
    ],
  });
  const { links, segmenti } = run(i);
  assert.equal(segmenti.size, 0);
  assert.deepEqual(links.filter((l) => l.b === "dev:11" || l.a === "dev:11").map((l) => [l.aPort, l.bPort]), [["sfp28-1", "SFP28 32"]]);
});

// I61 (spec §13.7.3, G5): una VLAN su più porte d'accesso di un bridge gestito non è un segmento. Rete B e cliente A: la WAN
// come VLAN dentro il bridge del router, su più porte d'accesso, un apparato ciascuna. Passa già (la regola c'è dal §13.7.3):
// è la prova che la tiene.
test("I61 — la stessa VLAN su sei porte d'accesso del router: sei cavi, nessun segmento", () => {
  const k6 = [1, 2, 3, 4, 5, 6];
  const i = input({
    devices: [rtr(1)],
    hosts: k6.map((k) => host(30 + k, { ip: `10.0.2.${k}`, mac: `02:00:00:00:0b:0${k}`, hostname: `MODEM-${k}`, classification: "router" })),
    ports: k6.map((k) => porta(1, k, `sfp-sfpplus${k}`, "1000 Mbps")),
    neighbors: k6.flatMap((k) => [
      nb(1, { local_port: `sfp-sfpplus${k},BR_RP`, remote_device_name: `MODEM-${k}`, remote_port: "eth0", remote_mac: `02:00:00:00:0b:0${k}`, protocol: "lldp", timestamp: ORA }),
      nb(1, { local_port: "VL_9_WAN", remote_device_name: `MODEM-${k}`, remote_port: "eth0", remote_mac: `02:00:00:00:0b:0${k}`, protocol: "mndp", timestamp: ORA }),
    ]),
  });
  const { links, segmenti } = run(i);
  assert.equal(segmenti.size, 0);
  assert.deepEqual(links.map((l) => [l.aPort, l.bPort]), k6.map((k) => [`sfp-sfpplus${k}`, "eth0"]));
});

const ignora = (id: number, a: string, aPort: string, b: string, bPort: string) => ({ id, action: "ignore" as const, a_node: a, a_port: aPort, b_node: b, b_port: bPort, medium: null });

test("I8 — «Ignora» per cavo: (porta 10, ether8) non tocca il cavo a 10G ed è orfana; (porta 10, sfp-sfpplus1) toglie solo lui", () => {
  const del14 = run({ ...sede1(), overrides: [ignora(1, "dev:114", "Uplink verso il router", "dev:1", "ether8")] });
  assert.equal(del14.links.some((l) => l.id === "link:dev:1|dev:114"), true, "il cavo sfp-sfpplus1 ↔ porta 10 resta");
  assert.deepEqual([...del14.ignorati.usate], [], "non corrisponde a nessun cavo visto: orfana");
  const giusto = run({ ...sede1(), overrides: [ignora(2, "dev:114", "Uplink verso il router", "dev:1", "sfp-sfpplus1")] });
  assert.equal(giusto.links.some((l) => l.id === "link:dev:1|dev:114"), false);
  assert.deepEqual([...giusto.ignorati.usate], [2]);
  assert.equal(giusto.links.some((l) => l.id === "link:dev:1|dev:112"), true, "gli altri cavi del router restano");
});

test("I8 — una porta vuota vale per ogni porta su quel lato; due porte vuote non tolgono un cavo con le porte: orfana", () => {
  const una = run({ ...sede1(), overrides: [ignora(3, "dev:1", "sfp-sfpplus1", "dev:114", "")] });
  assert.equal(una.links.some((l) => l.id === "link:dev:1|dev:114"), false);
  const nessuna = run({ ...sede1(), overrides: [ignora(4, "dev:1", "", "dev:114", "")] });
  assert.equal(nessuna.links.some((l) => l.id === "link:dev:1|dev:114"), true);
  assert.deepEqual([...nessuna.ignorati.usate], []);
});

// Revisione finale di T1 (spec §13.9): una linea senza porte — l'uplink senza fili di un access point in mesh, famiglia 2
// delle reti-campione — si deve poter ignorare. Prima la correzione scritta dalla pagina (porte della linea, qui vuote) era
// orfana subito, e «Scegli il cavo da ignorare…» riproponeva lo stesso cavo vuoto: si girava in tondo. Una regola senza
// porte toglie solo un cavo senza porte di quella coppia, mai un cavo con le porte.
const meshAp = () => input({
  devices: [
    dev(5, { name: "AP-5", device_type: "access_point", controller_mac: "02:00:00:00:00:05", via: "api" }),
    dev(6, { name: "AP-6", device_type: "access_point", controller_mac: "02:00:00:00:00:06", uplink_mac: "02:00:00:00:00:05", uplink_type: "wireless", uplink_seen_at: ORA, via: "api" }),
  ],
});

test("I8 — «Ignora questo cavo…» su una linea senza porte (l'uplink senza fili di un access point in mesh) la toglie", () => {
  const prima = run(meshAp());
  assert.deepEqual(prima.links.map((l) => [l.a, l.aPort, l.b, l.bPort, l.source]), [["dev:6", "", "dev:5", "", "unifi_uplink"]]);
  const l = prima.links[0];
  // La pagina scrive le porte della linea (topology-map-client.tsx, «Ignora questo cavo…»): qui tutte e due vuote.
  const dopo = run({ ...meshAp(), overrides: [ignora(9, l.a, l.aPort, l.b, l.bPort)] });
  assert.deepEqual(dopo.links, []);
  assert.deepEqual([...dopo.ignorati.usate], [9]);
  assert.deepEqual(caviFra({ links: dopo.links, canonical: {} }, l.a, l.b), [], "nessun cavo da riproporre: non si gira in tondo");
});

test("I8 — una regola senza porte toglie il cavo senza porte della coppia e lascia quello con le porte", () => {
  const i = meshAp();
  i.neighbors = [nb(5, { local_port: "Port 2", remote_device_name: "AP-6", remote_port: "eth0", remote_mac: "02:00:00:00:00:06", source: "unifi", timestamp: ORA })];
  const prima = run(i).links;
  assert.deepEqual(prima.map((l) => [l.aPort, l.bPort, l.sources]), [["eth0", "Port 2", ["unifi_uplink", "lldp"]]]);
  const dopo = run({ ...i, overrides: [ignora(9, "dev:6", "", "dev:5", "")] });
  assert.deepEqual(dopo.links.map((l) => [l.aPort, l.bPort, l.sources]), [["Port 2", "eth0", ["lldp"]]]);
  assert.deepEqual([...dopo.ignorati.usate], [9]);
});

// Review Focus 5: le correzioni salvate prima di T1 hanno le porte come le scriveva la linea di allora (grezze) e possono
// citare un host poi promosso ad apparato.
test("Review Focus 5 — un «Ignora» di prima: porte nella forma grezza («ether3,bridge», «SFP_ 9») e un host poi promosso", () => {
  const i = input({
    devices: [rtr(1), dev(2, { name: "SW-2", host: "10.0.1.40", host_id: 40, controller_mac: "02:00:00:00:00:02", via: "api" })],
    hosts: [host(40, { ip: "10.0.1.40" })],
    ports: [porta(2, 9, "SFP+ 9", "10000 Mbps"), porta(1, 3, "ether3", "1000 Mbps")],
    neighbors: [
      nb(2, { local_port: "SFP_ 9", remote_device_name: "RTR-1", remote_port: "ether3", remote_ip: "10.0.0.1", source: "unifi" }),
      // Il router sente lo switch sulla porta che lo switch annuncia («Port 9»: l'identificativo assegnato localmente).
      nb(1, { local_port: "ether3,bridge", remote_device_name: "SW-2", remote_port: "Port 9", remote_ip: "10.0.1.40", protocol: "lldp" }),
    ],
    overrides: [ignora(5, "host:40", "SFP_ 9", "dev:1", "ether3,bridge")],
  });
  const r = run(i);
  assert.deepEqual(r.links, []);
  assert.deepEqual([...r.ignorati.usate], [5]);
});

// Review Focus 5, revisione finale di T1: prima di T1 la porta remota della linea era la riga grezza, e un «Ignora» di
// allora l'ha salvata così. Letta solo col traduttore del lato locale, una forma che c'era solo dal lato remoto non trovava
// più il cavo: la correzione diventava orfana e il cavo tornava sulla mappa.
test("Review Focus 5 — un «Ignora» di prima con la porta remota di un MikroTik nel bridge («bridge/ether3»): toglie ancora il cavo", () => {
  const i = input({
    devices: [rtr(1), dev(5, { name: "SW-5", controller_mac: "02:00:00:00:00:05", via: "api" })],
    ports: [porta(5, 3, "Port 3"), porta(1, 3, "ether3")],
    neighbors: [nb(5, { local_port: "Port 3", remote_device_name: "RTR-1", remote_port: "bridge/ether3", remote_ip: "10.0.0.1", remote_platform: "MikroTik", source: "unifi" })],
  });
  assert.deepEqual(run(i).links.map((l) => [l.a, l.aPort, l.b, l.bPort]), [["dev:5", "Port 3", "dev:1", "ether3"]], "senza «Ignora» il cavo c'è");
  const r = run({ ...i, overrides: [ignora(7, "dev:5", "Port 3", "dev:1", "bridge/ether3")] });
  assert.deepEqual(r.links, []);
  assert.deepEqual([...r.ignorati.usate], [7]);
  // Lo stesso senza l'elenco delle porte del router: letta dal lato locale «bridge/ether3» è un'interfaccia logica, che un
  // cavo non ha mai; vale la lettura del lato remoto.
  const senzaElenco = { ...i, ports: [porta(5, 3, "Port 3")] };
  assert.deepEqual(run(senzaElenco).links.map((l) => l.bPort), ["ether3"], "senza «Ignora» il cavo c'è");
  assert.deepEqual(run({ ...senzaElenco, overrides: [ignora(7, "dev:5", "Port 3", "dev:1", "bridge/ether3")] }).links, []);
});

test("Review Focus 5 — un «Ignora» di prima su un uplink del controller: «Port 10» del padre, che oggi ha un nome scelto", () => {
  const i = input({
    devices: [
      dev(1, { name: "SW-1", controller_mac: "02:00:00:00:00:01", via: "api" }),
      dev(2, { name: "SW-2", controller_mac: "02:00:00:00:00:02", uplink_mac: "02:00:00:00:00:01", uplink_remote_port: 10, uplink_seen_at: ORA, via: "api" }),
    ],
    uplinkPorts: [{ device_id: 2, port_index: 25, port_name: "SFP+ 1" }],
    ports: [porta(1, 10, "Server rack"), porta(2, 25, "SFP+ 1")],
  });
  assert.deepEqual(run(i).links.map((l) => [l.a, l.aPort, l.b, l.bPort]), [["dev:2", "SFP+ 1", "dev:1", "Server rack"]], "senza «Ignora» il cavo c'è");
  const r = run({ ...i, overrides: [ignora(8, "dev:2", "SFP+ 1", "dev:1", "Port 10")] });
  assert.deepEqual(r.links, []);
  assert.deepEqual([...r.ignorati.usate], [8]);
});

// Passo 3a, revisione finale di T1: dopo uno spostamento del cavo sul router (ether3 → ether5) la riga vecchia del figlio
// resta 90 giorni (il MAC è dell'interfaccia: telaio diverso, R-superata non la toglie). La porta del padre si prende dalla
// riga più recente, non dalla prima in ordine: altrimenti la linea diceva «ether3», vista oggi, e il cavo vero stava fra
// gli «Altri cavi visti».
test("I6 — uplink verso un padre di cui il controller non sa la porta: la porta del padre dalla riga più recente del figlio", () => {
  const VECCHIA = "2026-10-03 11:00:00";
  const i = input({
    devices: [rtr(1), dev(2, { name: "SW-2", controller_mac: "02:00:00:00:00:02", uplink_mac: "02:00:00:00:00:01", uplink_seen_at: ORA, via: "api" })],
    knownMacs: [{ device_id: 1, mac: "02:00:00:00:00:01" }],
    uplinkPorts: [{ device_id: 2, port_index: 25, port_name: "SFP+ 1" }],
    ports: [porta(2, 25, "SFP+ 1"), porta(1, 3, "ether3"), porta(1, 5, "ether5")],
    neighbors: [
      nb(2, { local_port: "SFP_ 1", remote_device_name: "RTR-1", remote_port: "ether3", remote_mac: "02:00:00:00:a0:03", remote_platform: "MikroTik", source: "unifi", timestamp: VECCHIA }),
      nb(2, { local_port: "SFP_ 1", remote_device_name: "RTR-1", remote_port: "ether5", remote_mac: "02:00:00:00:a0:05", remote_platform: "MikroTik", source: "unifi", timestamp: ORA }),
    ],
  });
  const [l] = run(i).links;
  assert.deepEqual([l.a, l.aPort, l.b, l.bPort, l.stale], ["dev:2", "SFP+ 1", "dev:1", "ether5", false]);
  assert.deepEqual(l.altriCavi?.map((c) => [c.aPort, c.bPort]), [["SFP+ 1", "ether3"]]);
});

// Passo 5, revisione finale di T1: la linea di una coppia prende il cavo che la lascia «vista», se ce n'è uno; poi livello,
// rango e prove. Prima un cavo non più visto da due lati batteva il cavo visto oggi da uno: la linea diventava «non vista»
// con le porte di ieri, e l'albero la penalizzava (chiaveScelta). Prima di T1 la fusione prendeva il «visto» più recente
// fra tutte le prove (ADR 0008).
test("Passo 5 — un cavo non più visto, anche con più prove, non regge la linea di una coppia vista oggi su un altro cavo", () => {
  const VECCHIA = "2026-10-03 11:00:00";
  const i = input({
    devices: [dev(1, { via: "snmp_v2", vendor: "hp" }), dev(2, { via: "snmp_v2", vendor: "hp" })],
    ports: [porta(1, 1, "1"), porta(1, 2, "2"), porta(2, 1, "1"), porta(2, 2, "2")],
    neighbors: [
      nb(1, { local_port: "1", remote_device_name: "SW-2", remote_port: "1", remote_ip: "10.0.0.2", timestamp: VECCHIA }),
      nb(2, { local_port: "1", remote_device_name: "SW-1", remote_port: "1", remote_ip: "10.0.0.1", timestamp: VECCHIA }),
      // il cavo di oggi: dev:2 non si legge più da dieci giorni, lo vede solo dev:1
      nb(1, { local_port: "2", remote_device_name: "SW-2", remote_port: "2", remote_ip: "10.0.0.2", timestamp: ORA }),
    ],
  });
  const [l] = run(i).links;
  assert.deepEqual([l.aPort, l.bPort, l.stale, l.daysUnseen], ["2", "2", false, 0]);
  assert.deepEqual(l.altriCavi?.map((c) => [c.aPort, c.bPort]), [["1", "1"]]);
});

// …ma lo stesso cavo, visto oggi da un lato senza la porta remota e fino a dieci giorni fa dall'altro con tutte e due, resta
// una linea vista con le due porte: «non visto» vale per il cavo (le prove compatibili), non per la riga.
test("Passo 5 — lo stesso cavo visto oggi da un lato solo: le due porte della prova di ieri restano e la linea è vista", () => {
  const VECCHIA = "2026-10-03 11:00:00";
  const i = input({
    devices: [dev(1, { via: "snmp_v2", vendor: "hp" }), dev(2, { via: "snmp_v2", vendor: "hp" })],
    ports: [porta(1, 1, "1"), porta(2, 1, "1")],
    neighbors: [
      nb(1, { local_port: "1", remote_device_name: "SW-2", remote_port: "", remote_ip: "10.0.0.2", timestamp: ORA }),
      nb(2, { local_port: "1", remote_device_name: "SW-1", remote_port: "1", remote_ip: "10.0.0.1", timestamp: VECCHIA }),
    ],
  });
  const [l] = run(i).links;
  assert.deepEqual([l.a, l.aPort, l.b, l.bPort, l.stale, l.altriCavi], ["dev:1", "1", "dev:2", "1", false, undefined]);
});
