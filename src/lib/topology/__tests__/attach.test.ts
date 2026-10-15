import { test } from "node:test";
import assert from "node:assert/strict";
import { attachMacs } from "@/lib/topology/attach";
import { buildLinks } from "@/lib/topology/links";
import { buildNodeIndex } from "@/lib/topology/node-index";
import { buildTopologyModel } from "@/lib/topology/model";
import { autoVisible } from "@/lib/topology/tree";
import type { ModelMacPortRow, TopologyModelInput } from "@/lib/topology/model-types";
import { baseInput, dev, host } from "./support/righe";

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
    locations: [], networks: [], knownMacs: [], overrides: [], macPorts: [], primaries: [], portInfo: [], vms: [], scanHosts: [], nowMs: NOW, staleDays: 2, ...over,
  };
}
function run(i: TopologyModelInput) {
  const idx = buildNodeIndex(i.devices, i.hosts, i.knownMacs, i.neighbors);
  const { links, ignorati, segmenti } = buildLinks(i, idx);
  return { links, ...attachMacs(i, idx, links, { ignorati, segmenti }) };
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

test("vecchio: oltre la soglia resta nell'elenco con «visto l'ultima volta» ma non conta nel numero (I4)", () => {
  const r = run(input({ macPorts: [mp(3, mac(5), "Port 5", "2026-10-10 12:00:00"), mp(3, mac(6), "Port 6")] }));
  const vecchio = r.portClients.find((p) => p.port === "Port 5")!.clients[0];
  assert.equal(vecchio.stale, true);
  assert.equal(vecchio.lastSeen, "2026-10-10 12:00:00");
  assert.equal(r.clientCount["dev:3"], 1, "conta solo il client fresco");
});

test("un MAC passato dall'AP1 (3 giorni fa) all'AP2 (oggi) sta sull'AP2, anche se l'AP2 ha più client (I4)", () => {
  const devices = [...input().devices, dev(8, { name: "AP-8", device_type: "access_point" }), dev(9, { name: "AP-9", device_type: "access_point" })];
  const m = mac(1);
  const altri = [mac(201), mac(202), mac(203)].map((x) => mp(9, x, "wlan0"));
  const r = run(input({ devices, macPorts: [mp(8, m, "wlan0", "2026-10-10 11:00:00"), mp(9, m, "wlan0"), ...altri] }));
  const dove = r.portClients.filter((p) => p.clients.some((c) => c.mac === m)).map((p) => p.nodeId);
  assert.deepEqual(dove, ["dev:9"]);
  assert.equal(r.clientCount["dev:9"], 4);
  assert.equal(r.clientCount["dev:8"], undefined);
});

test("i MAC su una porta si contano distinti: due grafie della stessa porta non valgono doppio (I4)", () => {
  const m = mac(1), m1 = mac(2);
  const r = run(input({
    macPorts: [mp(3, m, "Port 5"), mp(3, m1, "Port 5"), mp(3, m1, "port 5"), mp(2, m, "Port 6"), mp(2, mac(3), "Port 6"), mp(2, mac(4), "Port 6")],
  }));
  const dove = r.portClients.filter((p) => p.clients.some((c) => c.mac === m)).map((p) => [p.nodeId, p.port]);
  assert.deepEqual(dove, [["dev:3", "Port 5"]]);
});

test("stessi dati, stesso risultato", () => {
  const i = input({ macPorts: [mp(2, mac(1), "Port 3"), mp(3, mac(2), "Port 5"), mp(1, mac(2), "bridge")] });
  assert.deepEqual(run(i), run(i));
});

test("un MAC VRRP su una porta di bordo non crea un collegamento mac_table e non prende il nome del router (I2)", () => {
  const vrrp = "00:00:5e:00:01:0a";
  const hosts = [host(20, { ip: "10.0.0.1", mac: vrrp, classification: "router" })]; // assorbito dal router per IP
  const r = run(input({ hosts, knownMacs: [{ device_id: 1, mac: vrrp }], macPorts: [mp(3, vrrp, "Port 4")] }));
  assert.deepEqual(r.attachLinks, []);
  assert.deepEqual(r.portClients.map((p) => p.clients.map((c) => [c.nodeId, c.name])), [[[null, null]]]);
});

// Spec §11.1: ciò che un router vede sul bridge non prova nessun cavo.
for (const tipo of ["server_linux", "server"] as const) {
  test(`${tipo} visto solo dal router sul bridge: nessun collegamento, nessun client`, () => {
    const m = mac(7);
    const i = input({
      hosts: [host(1, { ip: "10.0.1.50", mac: m, classification: tipo })],
      devices: [
        dev(1, { name: "RTR-1", device_type: "router", host: "10.0.0.1" }),
        dev(2, { name: "SW-2", host: "10.0.0.2" }),
        dev(3, { name: "SRV-3", device_type: tipo, host: "10.0.1.50" }),
      ],
      neighbors: [],
      uplinkPorts: [],
      knownMacs: [{ device_id: 3, mac: m }],
      macPorts: [mp(1, m, "bridge")],
    });
    const r = run(i);
    assert.deepEqual(r.attachLinks, []);
    assert.deepEqual(r.portClients, []);
  });

  test(`${tipo} visto anche sullo switch (Port 15): collegamento mac_table switch ↔ server`, () => {
    const m = mac(7);
    const i = input({
      devices: [
        dev(1, { name: "RTR-1", device_type: "router", host: "10.0.0.1" }),
        dev(2, { name: "SW-2", host: "10.0.0.2" }),
        dev(3, { name: "SRV-3", device_type: tipo, host: "10.0.1.50" }),
      ],
      neighbors: [],
      uplinkPorts: [],
      knownMacs: [{ device_id: 3, mac: m }],
      macPorts: [mp(1, m, "bridge"), mp(2, m, "Port 15")],
    });
    const r = run(i);
    assert.deepEqual(r.attachLinks.map((l) => [l.a, l.aPort, l.b, l.source]), [["dev:2", "Port 15", "dev:3", "mac_table"]]);
  });
}

test("host server visto solo dal router sul bridge: da sistemare, non radice dell'albero automatico", async () => {
  const { buildTopologyModel } = await import("@/lib/topology/model");
  const { autoVisible, buildTree } = await import("@/lib/topology/tree");
  const m = mac(7);
  const i = input({
    hosts: [host(1, { ip: "10.0.1.50", mac: m, classification: "server_linux" })],
    neighbors: [], uplinkPorts: [],
    macPorts: [mp(1, m, "bridge"), mp(2, mac(8), "Port 3")],
    devices: [
      dev(1, { name: "RTR-1", device_type: "router", host: "10.0.0.1" }),
      dev(2, { name: "SW-2", host: "10.0.0.2" }),
    ],
    knownMacs: [{ device_id: 1, mac: mac(9) }],
  });
  const model = buildTopologyModel(i);
  assert.ok(model.isolated.includes("host:1"), "fra quelli da sistemare");
  assert.ok(!autoVisible(model).has("host:1"));
  assert.ok(!buildTree(model, autoVisible(model), ["dev:1"]).roots.includes("host:1"));
  assert.equal(model.counts.isolatedDevices, 2, "il conteggio resta degli apparati");
});

// Task 1b: i MAC che il router vede sulle sue porte fisiche (bridge host) propongono
// ciò che c'è attaccato, ma solo come RIPIEGO. Una porta del router che porta a un
// ramo intero vede decine di apparati: sul cliente A, trattare ogni MAC su una
// porta fisica come un cavo avrebbe dato ~230 collegamenti falsi.
const RTR = dev(1, { name: "RTR-1", device_type: "router", host: "10.0.0.1" });
const SRV_MAC = "02:00:00:00:bb:07";

test("router: un server visto solo su ether7 del router → collegamento router ↔ server", () => {
  const i = input({
    devices: [RTR, dev(2), dev(3), dev(7, { name: "SRV-7", device_type: "server", host: "10.0.1.7" })],
    knownMacs: [{ device_id: 7, mac: SRV_MAC }],
    macPorts: [mp(1, SRV_MAC, "ether7")],
  });
  assert.deepEqual(run(i).attachLinks.map((l) => [l.a, l.aPort, l.b, l.source]), [["dev:1", "ether7", "dev:7", "mac_table"]]);
});

test("router: le righe vecchie dell'ARP (bridge, VLAN, VRRP) restano ignorate", () => {
  const i = input({
    devices: [RTR, dev(2), dev(3), dev(7, { name: "SRV-7", device_type: "server", host: "10.0.1.7" })],
    knownMacs: [{ device_id: 7, mac: SRV_MAC }],
    macPorts: [mp(1, SRV_MAC, "bridge"), mp(1, SRV_MAC, "vlan10"), mp(1, SRV_MAC, "vrrp_rete10")],
  });
  assert.deepEqual(run(i).attachLinks, []);
});

// Switch SW-4 su ether2 del router; dietro 20 MAC: 18 client, l'AP-5 (che SW-4 vede sulla sua Port 5,
// una porta di bordo) e lo switch SW-6 (uplink UniFi verso SW-4).
function ramoSuEther2() {
  const swMac = "02:00:00:00:cc:04", apMac = "02:00:00:00:cc:05", sw6Mac = "02:00:00:00:cc:06";
  const clienti = Array.from({ length: 18 }, (_, k) => mac(300 + k));
  return input({
    devices: [
      RTR, dev(2), dev(3),
      dev(4, { name: "SW-4", host: "10.0.0.4", controller_mac: swMac }),
      dev(5, { name: "AP-5", device_type: "access_point", host: "10.0.0.5" }),
      dev(6, { name: "SW-6", host: "10.0.0.6", controller_mac: sw6Mac, uplink_mac: swMac, uplink_seen_at: RECENTE }),
    ],
    knownMacs: [{ device_id: 5, mac: apMac }],
    macPorts: [
      ...[swMac, apMac, sw6Mac, ...clienti].map((m) => mp(1, m, "ether2")),
      mp(4, apMac, "Port 5"),
    ],
  });
}

test("router: uno switch su ether2 con dietro 20 MAC → router ↔ switch; l'AP che lo switch vede su una porta di bordo sta sotto lo switch", () => {
  const r = run(ramoSuEther2());
  const coppie = [...r.links, ...r.attachLinks].map((l) => [l.a, l.b].sort().join("—")).sort();
  assert.ok(coppie.includes("dev:1—dev:4"), `router ↔ SW-4: ${coppie.join(", ")}`);
  assert.ok(coppie.includes("dev:4—dev:5"), "AP-5 sotto SW-4");
  assert.ok(!coppie.includes("dev:1—dev:5"), "AP-5 non sotto il router");
  assert.ok(!coppie.includes("dev:1—dev:6"), "SW-6 ha già il padre (uplink UniFi)");
  const rl = r.attachLinks.find((l) => l.a === "dev:1" && l.b === "dev:4");
  assert.equal(rl?.aPort, "ether2");
  assert.equal(r.clientCount["dev:1"], undefined, "i 18 MAC dietro lo switch non diventano client del router");
});

test("router: un apparato con uplink UniFi verso uno switch e visto anche su una porta del router resta sotto lo switch", () => {
  const swMac = "02:00:00:00:cc:04", apMac = "02:00:00:00:cc:05";
  const i = input({
    devices: [
      RTR, dev(2), dev(3),
      dev(4, { name: "SW-4", host: "10.0.0.4", controller_mac: swMac }),
      dev(5, { name: "AP-5", device_type: "access_point", host: "10.0.0.5", controller_mac: apMac, uplink_mac: swMac, uplink_seen_at: RECENTE }),
    ],
    macPorts: [mp(1, apMac, "ether5")],
  });
  const r = run(i);
  const coppie = [...r.links, ...r.attachLinks].map((l) => [l.a, l.b].sort().join("—"));
  assert.ok(coppie.includes("dev:4—dev:5"));
  assert.ok(!coppie.includes("dev:1—dev:5"), coppie.join(", "));
});

test("router: un server sulla stessa porta di uno switch, che nessuno switch vede, non si attacca al router (lo switch può essere il suo padre)", () => {
  const swMac = "02:00:00:00:cc:04";
  const i = input({
    devices: [
      RTR, dev(2), dev(3),
      dev(4, { name: "SW-4", host: "10.0.0.4", controller_mac: swMac }),
      dev(7, { name: "SRV-7", device_type: "server", host: "10.0.1.7" }),
    ],
    knownMacs: [{ device_id: 7, mac: SRV_MAC }],
    macPorts: [mp(1, swMac, "sfp-sfpplus1"), mp(1, SRV_MAC, "sfp-sfpplus1")],
  });
  const coppie = run(i).attachLinks.map((l) => [l.a, l.b].join("—"));
  assert.deepEqual(coppie, ["dev:1—dev:4"]);
});

test("router: un server con un LLDP verso uno switch fuori da quel ramo ha già il padre: niente collegamento dal router", () => {
  const i = input({
    devices: [RTR, dev(2), dev(3), dev(7, { name: "SRV-7", device_type: "server", host: "10.0.1.7" })],
    knownMacs: [{ device_id: 7, mac: SRV_MAC }],
    neighbors: [
      { device_id: 2, local_port: "Port 1", remote_device_name: "SW-3", remote_port: "Port 1", protocol: "lldp", remote_ip: "10.0.0.3", remote_mac: null, timestamp: RECENTE, source: "device" },
      { device_id: 2, local_port: "Port 8", remote_device_name: "SRV-7", remote_port: "eno1", protocol: "lldp", remote_ip: "10.0.1.7", remote_mac: null, timestamp: RECENTE, source: "device" },
    ],
    macPorts: [mp(1, SRV_MAC, "ether7")],
  });
  const r = run(i);
  assert.deepEqual(r.attachLinks, []);
  assert.ok(r.links.some((l) => l.a === "dev:2" && l.b === "dev:7"));
});

test("router: due switch su ether2 legati da un LLDP, nessuno col verso noto: non si sa chi sta sopra, niente collegamento", () => {
  const a = "02:00:00:00:cc:04", b = "02:00:00:00:cc:08";
  const i = input({
    devices: [
      RTR, dev(2), dev(3),
      dev(4, { name: "SW-4", host: "10.0.0.4", controller_mac: a }),
      dev(8, { name: "SW-8", host: "10.0.0.8", controller_mac: b }),
    ],
    neighbors: [
      { device_id: 4, local_port: "Port 2", remote_device_name: "SW-8", remote_port: "Port 1", protocol: "lldp", remote_ip: "10.0.0.8", remote_mac: null, timestamp: RECENTE, source: "device" },
    ],
    macPorts: [mp(1, a, "ether2"), mp(1, b, "ether2")],
  });
  assert.deepEqual(run(i).attachLinks.filter((l) => l.a === "dev:1"), []);
});

// Revisione finale del ramo (I-3), ora per cavo (spec §13.9, I9): «Ignora» vale anche per tabella MAC, ripiego del router
// e «dalle VM», sulla porta del cavo ignorato verso quell'oggetto. La pagina scrive le porte della linea: per una linea
// della tabella MAC, la porta dello switch e niente dall'altra parte (vale per ogni porta).
const ignora = (a: string, aPort: string, b: string, bPort = "") => [{ id: 1, action: "ignore" as const, a_node: a, a_port: aPort, b_node: b, b_port: bPort, medium: null }];
// Generico sul tipo della linea: le prove leggono anche le porte (`aPort`, `bPort`), che un tipo `{ a; b }` non ha (TS2339).
const fra = <T extends { a: string; b: string }>(links: T[], x: string, y: string) => links.filter((l) => [l.a, l.b].sort().join("|") === [x, y].sort().join("|"));

test("I-3/I9: un collegamento «tabella MAC» ignorato non torna, e il MAC non diventa un client", () => {
  const SRV = "02:00:00:00:05:01";
  const i = baseInput({
    devices: [dev(2, { name: "CENTRALE-2", host: "192.0.2.2" }), dev(5, { name: "SRV-5", device_type: "server", host: "192.0.2.15", port_count: 0 })],
    knownMacs: [{ device_id: 5, mac: SRV }],
    macPorts: [mp(2, SRV, "Port 7")],
  });
  assert.equal(fra(buildTopologyModel(i).links, "dev:2", "dev:5").length, 1, "senza «Ignora» il collegamento c'è");
  const m = buildTopologyModel({ ...i, overrides: ignora("dev:2", "Port 7", "dev:5") });
  assert.deepEqual(fra(m.links, "dev:2", "dev:5"), []);
  assert.deepEqual(m.portClients, []);
  assert.deepEqual(m.correzioniOrfane, []);
});

test("I9: la porta del cavo ignorato resta occupata verso quell'oggetto; lo stesso oggetto su un'altra porta compare", () => {
  const SRV = "02:00:00:00:05:01";
  const i = baseInput({
    devices: [dev(2, { name: "CENTRALE-2", host: "192.0.2.2" }), dev(5, { name: "SRV-5", device_type: "server", host: "192.0.2.15", port_count: 0 })],
    knownMacs: [{ device_id: 5, mac: SRV }],
    macPorts: [mp(2, SRV, "Port 8")],
    overrides: ignora("dev:2", "Port 7", "dev:5"),
  });
  const m = buildTopologyModel(i);
  assert.deepEqual(fra(m.links, "dev:2", "dev:5").map((l) => (l.a === "dev:2" ? l.aPort : l.bPort)), ["Port 8"]);
  assert.deepEqual(m.correzioniOrfane, [1], "la correzione su Port 7 non toglie niente: orfana");
});

// Revisione del piano (15/10): su una linea LLDP o uplink la pagina scrive TUTTE E DUE le porte. Tabella MAC, ripiego e VM
// sanno una porta sola: con `ignorato(…, null)` la porta dell'altro capo non tornava mai, la porta restava libera e il MAC
// di accesso A sulla porta 9 di core 1 rifaceva subito la linea. `portaOccupata` guarda solo la porta di chi vede il MAC.
test("I9: un cavo LLDP ignorato con le sue due porte non torna dalla tabella MAC sulla stessa porta", () => {
  const ACC = "02:00:00:00:01:12";
  const i = baseInput({
    devices: [dev(114, { name: "CORE-1", host: "192.0.2.114" }), dev(112, { name: "ACC-A", host: "192.0.2.112" })],
    knownMacs: [{ device_id: 112, mac: ACC }],
    neighbors: [{ device_id: 114, local_port: "Port 9", remote_device_name: "ACC-A", remote_port: "SFP+ 2", protocol: "lldp", remote_ip: "192.0.2.112", remote_mac: null, timestamp: RECENTE, source: "device" }],
    macPorts: [mp(114, ACC, "Port 9")],
  });
  assert.equal(fra(buildTopologyModel(i).links, "dev:114", "dev:112").length, 1, "senza «Ignora» il cavo c'è");
  const m = buildTopologyModel({ ...i, overrides: ignora("dev:114", "Port 9", "dev:112", "SFP+ 2") });
  assert.deepEqual(fra(m.links, "dev:114", "dev:112"), [], "né il cavo LLDP né una linea «tabella MAC» sulla porta 9");
  assert.deepEqual(m.correzioniOrfane, []);
});

test("I9: un cavo LLDP ignorato verso un hypervisor non torna «dalle VM» sulla stessa porta", () => {
  const vm = (vmid: number, mac: string) => ({
    scannedDeviceId: 5, vmid, name: `vm-${vmid}`, node: "px-h", status: "running", type: "qemu", macs: [mac], ips: [], scannedAt: "2026-10-13T06:00:00.000Z",
  });
  const vms = [vm(501, "02:00:00:aa:00:01"), vm(502, "02:00:00:aa:00:02")];
  const i = baseInput({
    devices: [dev(2, { name: "CENTRALE-2", host: "192.0.2.2" }), dev(5, { name: "px-h", device_type: "server", vendor: "proxmox", host: "192.0.2.15", port_count: 0 })],
    scanHosts: [{ scannedDeviceId: 5, hostname: "px-h", ips: ["192.0.2.15"], macs: [] }],
    neighbors: [{ device_id: 2, local_port: "Port 1", remote_device_name: "px-h", remote_port: "eno1", protocol: "lldp", remote_ip: "192.0.2.15", remote_mac: null, timestamp: RECENTE, source: "device" }],
    vms, macPorts: vms.map((v) => mp(2, v.macs[0], "Port 1")),
  });
  assert.equal(fra(buildTopologyModel(i).links, "dev:2", "dev:5").length, 1, "senza «Ignora» il cavo c'è");
  const m = buildTopologyModel({ ...i, overrides: ignora("dev:2", "Port 1", "dev:5", "eno1") });
  assert.deepEqual(fra(m.links, "dev:2", "dev:5"), [], "né il cavo LLDP né una linea «dalle VM» sulla porta 1");
  assert.deepEqual(m.correzioniOrfane, []);
});

test("I-3/I9: il ripiego del router ignorato non torna", () => {
  const i = input({
    devices: [RTR, dev(2), dev(3), dev(7, { name: "SRV-7", device_type: "server", host: "10.0.1.7" })],
    knownMacs: [{ device_id: 7, mac: SRV_MAC }],
    macPorts: [mp(1, SRV_MAC, "ether7")],
  });
  assert.equal(fra(buildTopologyModel(i).links, "dev:1", "dev:7").length, 1, "senza «Ignora» il collegamento c'è");
  assert.deepEqual(fra(buildTopologyModel({ ...i, overrides: ignora("dev:1", "ether7", "dev:7") }).links, "dev:1", "dev:7"), []);
});

test("I-3/I9: un collegamento «dalle VM» ignorato non torna", () => {
  const vm = (vmid: number, mac: string) => ({
    scannedDeviceId: 5, vmid, name: `vm-${vmid}`, node: "px-h", status: "running", type: "qemu", macs: [mac], ips: [], scannedAt: "2026-10-13T06:00:00.000Z",
  });
  const vms = [vm(501, "02:00:00:aa:00:01"), vm(502, "02:00:00:aa:00:02")];
  const i = baseInput({
    devices: [dev(2, { name: "CENTRALE-2", host: "192.0.2.2" }), dev(5, { name: "px-h", device_type: "server", vendor: "proxmox", host: "192.0.2.15", port_count: 0 })],
    scanHosts: [{ scannedDeviceId: 5, hostname: "px-h", ips: ["192.0.2.15"], macs: [] }],
    vms, macPorts: vms.map((v) => mp(2, v.macs[0], "Port 1")),
  });
  assert.equal(fra(buildTopologyModel(i).links, "dev:2", "dev:5").length, 1, "senza «Ignora» il collegamento c'è");
  assert.deepEqual(fra(buildTopologyModel({ ...i, overrides: ignora("dev:2", "Port 1", "dev:5") }).links, "dev:2", "dev:5"), []);
});

// Revisione finale di T1: la porta di un cavo ignorato conta come «occupata» (e la correzione come usata) solo se la linea
// della tabella MAC nascerebbe davvero. Con la coppia già collegata da un altro cavo non nascerebbe comunque (una linea per
// coppia): la correzione non nasconde niente, è orfana, e «Togli la correzione» va proposto.
test("C5 — con la coppia già collegata da un altro cavo, la correzione sulla porta della tabella MAC è orfana", () => {
  const SRV = "02:00:00:00:05:01";
  const i = baseInput({
    devices: [dev(2, { name: "CENTRALE-2", host: "192.0.2.2" }), dev(5, { name: "SRV-5", device_type: "server", host: "192.0.2.15", port_count: 0 })],
    knownMacs: [{ device_id: 5, mac: SRV }],
    neighbors: [{ device_id: 2, local_port: "Port 1", remote_device_name: "SRV-5", remote_port: "eno1", protocol: "lldp", remote_ip: "192.0.2.15", remote_mac: null, timestamp: RECENTE, source: "device" }],
    macPorts: [mp(2, SRV, "Port 7")],
    overrides: ignora("dev:2", "Port 7", "dev:5"),
  });
  const m = buildTopologyModel(i);
  assert.deepEqual(fra(m.links, "dev:2", "dev:5").map((l) => (l.a === "dev:2" ? l.aPort : l.bPort)), ["Port 1"]);
  assert.deepEqual(m.correzioniOrfane, [1]);
});

test("C5 — un «Ignora» senza porte non toglie un collegamento che ha una porta (la tabella MAC): è orfano", () => {
  const SRV = "02:00:00:00:05:01";
  const i = baseInput({
    devices: [dev(2, { name: "CENTRALE-2", host: "192.0.2.2" }), dev(5, { name: "SRV-5", device_type: "server", host: "192.0.2.15", port_count: 0 })],
    knownMacs: [{ device_id: 5, mac: SRV }],
    macPorts: [mp(2, SRV, "Port 7")],
    overrides: ignora("dev:2", "", "dev:5"),
  });
  const m = buildTopologyModel(i);
  assert.equal(fra(m.links, "dev:2", "dev:5").length, 1);
  assert.deepEqual(m.correzioniOrfane, [1]);
});

// Spec §13.7.1 passo 2 e §13.3.1 riga 3: una porta che sente due o più apparati non dà linee verso di loro, nemmeno dalla
// tabella MAC. Sull'hub gli switch di laboratorio (solo host) sulla porta 5 dello switch 48 PoE vanno in «Da sistemare» (H5).
test("porta di segmento: la tabella MAC non rifà la linea verso chi la porta sente via LLDP; un client sulla stessa porta resta", () => {
  const LAB1 = "02:00:00:00:0a:01", LAB2 = "02:00:00:00:0a:02", PC = "02:00:00:00:0a:09";
  const i = baseInput({
    devices: [dev(2, { name: "SW-48POE", host: "10.0.0.2", via: "api" })],
    hosts: [
      host(31, { ip: "10.0.1.31", mac: LAB1, hostname: "LAB-SW-1", classification: "switch" }),
      host(32, { ip: "10.0.1.32", mac: LAB2, hostname: "LAB-SW-2", classification: "switch" }),
      host(39, { ip: "10.0.1.39", mac: PC, hostname: "PC-39", classification: "workstation" }),
    ],
    neighbors: [
      { device_id: 2, local_port: "Port 5", remote_device_name: "LAB-SW-1", remote_port: "Port 1", protocol: "lldp", remote_ip: null, remote_mac: LAB1, timestamp: RECENTE, source: "unifi" },
      { device_id: 2, local_port: "Port 5", remote_device_name: "LAB-SW-2", remote_port: "Port 1", protocol: "lldp", remote_ip: null, remote_mac: LAB2, timestamp: RECENTE, source: "unifi" },
    ],
    macPorts: [mp(2, LAB1, "Port 5"), mp(2, LAB2, "Port 5"), mp(2, PC, "Port 5")],
  });
  const r = run(i);
  assert.deepEqual([...r.links, ...r.attachLinks], [], "nessuna linea verso gli switch di laboratorio");
  assert.deepEqual(r.portClients.map((p) => [p.nodeId, p.port, p.clients.map((c) => c.nodeId)]), [["dev:2", "Port 5", ["host:39"]]]);
});

// Spec §13.3 e H5: chi resta senza collegamenti per la regola del segmento va in «Da sistemare» («nessun collegamento»).
// Revisione del piano (15/10): `isolated` prendeva solo apparati, attaccati e hypervisor, e gli switch di laboratorio
// dell'hub (host classificati switch) diventavano tre radici sole della mappa automatica. Solo i membri di un segmento:
// un host isolato per altri motivi resta com'era (sul cliente A la radio lontana a 60 GHz è e resta la seconda radice, C16).
test("H5 — gli host classificati switch che la regola del segmento lascia senza linee sono «Da sistemare», non radici sole", () => {
  const LAB1 = "02:00:00:00:0a:01", LAB2 = "02:00:00:00:0a:02";
  const i = baseInput({
    devices: [dev(1, { name: "RTR-1", device_type: "router", host: "10.0.0.1", vendor: "mikrotik", via: "ssh" }), dev(2, { name: "SW-48POE", host: "10.0.0.2", via: "api" })],
    hosts: [
      host(31, { ip: "10.0.1.31", mac: LAB1, hostname: "LAB-SW-1", classification: "switch" }),
      host(32, { ip: "10.0.1.32", mac: LAB2, hostname: "LAB-SW-2", classification: "switch" }),
    ],
    neighbors: [
      { device_id: 2, local_port: "Port 24", remote_device_name: "RTR-1", remote_port: "ether2", protocol: "lldp", remote_ip: "10.0.0.1", remote_mac: null, timestamp: RECENTE, source: "unifi" },
      // Il router letto via SSH ha le sue righe (la forma vera): così la prova regge anche con T1b, che vuole una prova di ruolo.
      { device_id: 1, local_port: "ether2", remote_device_name: "SW-48POE", remote_port: "Port 24", protocol: "lldp", remote_ip: "10.0.0.2", remote_mac: null, timestamp: RECENTE, source: "device" },
      { device_id: 2, local_port: "Port 5", remote_device_name: "LAB-SW-1", remote_port: "Port 1", protocol: "lldp", remote_ip: null, remote_mac: LAB1, timestamp: RECENTE, source: "unifi" },
      { device_id: 2, local_port: "Port 5", remote_device_name: "LAB-SW-2", remote_port: "Port 1", protocol: "lldp", remote_ip: null, remote_mac: LAB2, timestamp: RECENTE, source: "unifi" },
    ],
  });
  const m = buildTopologyModel(i);
  assert.deepEqual(m.isolated.filter((id) => id.startsWith("host:")), ["host:31", "host:32"]);
  assert.deepEqual([...autoVisible(m)].sort(), ["dev:1", "dev:2"]);
});

// Verifica del piano sul dato dell'hub (15/10): il ripiego del router da una VLAN col nome scelto a mano («VL_…») appendeva
// un hypervisor al router. Per un router col traduttore del suo prodotto il ripiego vuole `fisica: true`; col generico,
// come prima, basta che la porta non sia logica.
test("ripiego del router: da un'interfaccia che il traduttore del prodotto non riconosce, niente", () => {
  const mk = dev(1, { name: "RTR-1", device_type: "router", host: "10.0.0.1", vendor: "mikrotik", via: "ssh" });
  const i = (router: typeof mk, porta: string) => input({
    devices: [router, dev(2), dev(3), dev(7, { name: "SRV-7", device_type: "server", host: "10.0.1.7" })],
    knownMacs: [{ device_id: 7, mac: SRV_MAC }],
    macPorts: [mp(1, SRV_MAC, porta)],
  });
  assert.deepEqual(run(i(mk, "VL_2_UFFICI")).attachLinks, []);
  assert.deepEqual(run(i(mk, "ether7")).attachLinks.map((l) => [l.a, l.aPort, l.b]), [["dev:1", "ether7", "dev:7"]]);
  assert.deepEqual(run(i(RTR, "VL_2_UFFICI")).attachLinks.map((l) => [l.a, l.aPort, l.b]), [["dev:1", "VL_2_UFFICI", "dev:7"]]);
});

// Spec §13.7.8 (G9): un apparato non è client di sé stesso. Uno switch vede il suo MAC sulla porta della CPU: prima contava fra i
// client di quella porta (`attach.ts:124-129`) e toglieva la prova del cavo all'altro switch che lo vede.
test("G9 — il MAC proprio di uno switch sulla sua porta non è un suo client; sulla porta di un altro switch prova il cavo", () => {
  const SW = "02:00:00:00:00:02";
  const i = baseInput({
    devices: [dev(2, { name: "SW-2", controller_mac: SW }), dev(3, { name: "SW-3" })],
    macPorts: [mp(2, SW, "Port 0"), mp(3, SW, "Port 7")],
  });
  const m = buildTopologyModel(i);
  assert.deepEqual(m.portClients.filter((p) => p.nodeId === "dev:2"), []);
  assert.deepEqual(m.links.map((l) => [l.a, l.aPort, l.b, l.source]), [["dev:3", "Port 7", "dev:2", "mac_table"]]);
});
