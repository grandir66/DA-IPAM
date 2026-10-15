import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTopologyModel } from "@/lib/topology/model";
import { autoVisible, buildTree } from "@/lib/topology/tree";
import { linkCost, parseSpeedMbps } from "@/lib/topology/link-attrs";
import { LINK_ATTRS_DEFAULT, type MapLink, type TopologyModelInput } from "@/lib/topology/model-types";
import type { Regole } from "@/lib/topology/regole";
import { baseInput, dev } from "./support/righe";

// Dati inventati: MAC 02:00:00:…, IP 192.0.2.x.
const MAC_A = "02:00:00:00:0a:01"; // controller di SW-A
const MAC_H = "02:00:00:00:0b:01"; // scheda dell'hypervisor
const RECENTE = "2026-10-13 11:00:00";
const VECCHIO = "2026-10-01 11:00:00";

/** Router, due switch (SW-A, SW-B) e un hypervisor con un uplink UniFi verso SW-A e un MAC visto su SW-B. */
function rete(over: Partial<TopologyModelInput> = {}): TopologyModelInput {
  return baseInput({
    devices: [
      dev(1, { name: "RTR-1", device_type: "router", host: "192.0.2.1" }),
      dev(2, { name: "SW-A", host: "192.0.2.2", controller_mac: MAC_A }),
      dev(3, { name: "SW-B", host: "192.0.2.3" }),
      dev(4, { name: "pve-1", device_type: "server", vendor: "proxmox", host: "192.0.2.4", port_count: 0, uplink_mac: MAC_A, uplink_remote_port: 7, uplink_seen_at: RECENTE }),
    ],
    neighbors: [
      { device_id: 2, local_port: "Port 1", remote_device_name: "", remote_port: "ether2", protocol: "lldp", remote_ip: "192.0.2.1", remote_mac: null, timestamp: RECENTE, source: "device" },
      { device_id: 3, local_port: "Port 1", remote_device_name: "", remote_port: "ether3", protocol: "lldp", remote_ip: "192.0.2.1", remote_mac: null, timestamp: RECENTE, source: "device" },
    ],
    knownMacs: [{ device_id: 4, mac: MAC_H }],
    macPorts: [{ device_id: 3, mac: MAC_H, port_name: "Port 5", timestamp: RECENTE, source: "device" }],
    ...over,
  });
}
const albero = (i: TopologyModelInput) => {
  const m = buildTopologyModel(i);
  return { m, t: buildTree(m, autoVisible(m), ["dev:1"]) };
};
const del = (t: ReturnType<typeof albero>["t"], id: string) => t.via.get(id)!;
const linkTra = (t: ReturnType<typeof albero>["t"], a: string, b: string) => t.links.find((l) => [l.a, l.b].sort().join("|") === [a, b].sort().join("|"))!;

test("Review Focus 1: hypervisor con due schede su due switch — un solo principale, l'altro è ridondanza", () => {
  const { t } = albero(rete());
  assert.deepEqual([del(t, "dev:4").a, del(t, "dev:4").b].sort(), ["dev:2", "dev:4"], "principale: uplink UniFi verso SW-A");
  assert.equal(del(t, "dev:4").primary, "auto");
  assert.equal(del(t, "dev:4").redundant, false);
  const sul_b = linkTra(t, "dev:4", "dev:3");
  assert.equal(sul_b.source, "mac_table");
  assert.equal(sul_b.redundant, true);
  assert.equal(sul_b.primary, null);
  assert.equal(t.links.filter((l) => l.redundant).length, 1);
});

test("Review Focus 1: il principale scelto a mano vince anche se i dati preferiscono l'altro", () => {
  const { t } = albero(rete({ primaries: [{ node_id: "dev:4", other_node: "dev:3", node_port: "eno2", other_port: "Port 5" }] }));
  assert.deepEqual([del(t, "dev:4").a, del(t, "dev:4").b].sort(), ["dev:3", "dev:4"]);
  assert.equal(del(t, "dev:4").primary, "user");
  assert.equal(del(t, "dev:4").source, "mac_table", "costa di più di un uplink UniFi, ma la scelta è sua");
  assert.equal(t.children.get("dev:3")!.includes("dev:4"), true);
  assert.equal(linkTra(t, "dev:4", "dev:2").redundant, true);
});

test("una scelta a mano che non corrisponde più a nessun collegamento viene ignorata (resta il sistema)", () => {
  const { t } = albero(rete({ primaries: [{ node_id: "dev:4", other_node: "dev:1", node_port: "", other_port: "" }] }));
  assert.equal(del(t, "dev:4").primary, "auto");
  assert.deepEqual([del(t, "dev:4").a, del(t, "dev:4").b].sort(), ["dev:2", "dev:4"]);
});

test("Review Focus 2: un collegamento a mano verso una porta dove il MAC non c'è resta «non confermato» e non è il principale", () => {
  const i = rete({ overrides: [{ id: 1, action: "add", a_node: "dev:4", a_port: "eno2", b_node: "dev:3", b_port: "Port 9", medium: null }] });
  const { m, t } = albero(i);
  const man = m.links.find((l) => l.sources.includes("manual"))!;
  assert.deepEqual(man.manual, { confirmed: false });
  assert.equal(linkCost(man), 4);
  assert.equal(del(t, "dev:4").source, "unifi_uplink", "il principale è il collegamento confermato dai dati");
  assert.equal(linkTra(t, "dev:4", "dev:3").redundant, true);
});

test("un collegamento a mano verso la porta giusta (il MAC è lì, non vecchio) è confermato, in tutte e due le direzioni", () => {
  for (const [a, aPort, b, bPort] of [["dev:4", "eno2", "dev:3", "Port 5"], ["dev:3", "Port 5", "dev:4", "eno2"]]) {
    const { m } = albero(rete({ overrides: [{ id: 1, action: "add", a_node: a, a_port: aPort, b_node: b, b_port: bPort, medium: null }] }));
    assert.deepEqual(m.links.find((l) => l.sources.includes("manual"))!.manual, { confirmed: true }, `${a}→${b}`);
  }
});

test("il MAC visto sulla porta dichiarata ma vecchio non conferma", () => {
  const i = rete({
    macPorts: [{ device_id: 3, mac: MAC_H, port_name: "Port 5", timestamp: VECCHIO, source: "device" }],
    overrides: [{ id: 1, action: "add", a_node: "dev:4", a_port: "eno2", b_node: "dev:3", b_port: "Port 5", medium: null }],
  });
  assert.deepEqual(buildTopologyModel(i).links.find((l) => l.sources.includes("manual"))!.manual, { confirmed: false });
});

test("un collegamento a mano che i dati vedono anche da soli (uplink UniFi fra gli stessi nodi) è confermato", () => {
  const i = rete({ overrides: [{ id: 1, action: "add", a_node: "dev:4", a_port: "eno1", b_node: "dev:2", b_port: "Port 7", medium: null }] });
  const man = buildTopologyModel(i).links.find((l) => l.sources.includes("manual"))!;
  assert.deepEqual(man.manual, { confirmed: true });
  assert.equal(linkCost(man), 3);
});

test("le schede vive dell'hypervisor (MAC veri nella scansione) lo fanno trovare sullo switch e confermano il collegamento a mano", () => {
  const MAC_NIC = "02:00:00:00:0c:01";
  const i = rete({
    devices: rete().devices.filter((d) => d.id !== 4).concat([dev(4, { name: "pve-1", device_type: "server", vendor: "proxmox", host: "192.0.2.4", port_count: 0 })]),
    knownMacs: [],
    macPorts: [{ device_id: 3, mac: MAC_NIC, port_name: "Port 8", timestamp: RECENTE, source: "device" }],
    scanHosts: [{ scannedDeviceId: 4, hostname: "pve-1", ips: ["192.0.2.4"], macs: [MAC_NIC] }],
  });
  const m = buildTopologyModel(i);
  const l = m.links.find((x) => [x.a, x.b].includes("dev:4"))!;
  assert.deepEqual([l.source, l.a, l.aPort], ["mac_table", "dev:3", "Port 8"]);
  const i2 = { ...i, overrides: [{ id: 1, action: "add" as const, a_node: "dev:4", a_port: "nic1", b_node: "dev:3", b_port: "Port 8", medium: null }] };
  assert.deepEqual(buildTopologyModel(i2).links.find((x) => x.sources.includes("manual"))!.manual, { confirmed: true });
});

test("velocità e PoE vengono dalla porta dello switch sul collegamento", () => {
  const i = rete({ portInfo: [
    { device_id: 2, port_name: "Port 7", speed: "1000 Mbps", poe_status: "delivering", poe_power_mw: 4500 },
    { device_id: 3, port_name: "Port 1", speed: "10G", poe_status: "disabled", poe_power_mw: 0 },
  ] });
  const m = buildTopologyModel(i);
  const l = (a: string, b: string) => m.links.find((x) => [x.a, x.b].sort().join("|") === [a, b].sort().join("|"))!;
  assert.deepEqual([l("dev:2", "dev:4").speedMbps, l("dev:2", "dev:4").poeW], [1000, 4.5]);
  assert.deepEqual([l("dev:1", "dev:3").speedMbps, l("dev:1", "dev:3").poeW], [10000, null]);
  assert.deepEqual([l("dev:1", "dev:2").speedMbps, l("dev:1", "dev:2").poeW], [null, null]);
});

test("parseSpeedMbps: «1000 Mbps», «10G», «2,5G», sconosciuto", () => {
  const casi: Array<[string | null, number | null]> = [
    ["1000 Mbps", 1000], ["10G", 10000], ["10 Gbps", 10000], ["2.5G", 2500], ["2,5G", 2500], ["100M", 100], ["100 Mbps", 100],
    ["10000 Mbps", 10000], ["auto", null], ["", null], [null, null], ["-1", null], ["0", null],
  ];
  for (const [s, v] of casi) assert.equal(parseSpeedMbps(s), v, String(s));
});

test("wireless: dall'uplink UniFi del figlio o dalla porta «wifi»; il tipo a mano vince; un tipo non valido si ignora", () => {
  const i = rete({
    devices: [...rete().devices, dev(5, { name: "AP-1", device_type: "access_point", host: "192.0.2.5", uplink_mac: MAC_A, uplink_seen_at: RECENTE, uplink_type: "wireless" }),
      dev(6, { name: "AP-2", device_type: "access_point", host: "192.0.2.6", uplink_mac: MAC_A, uplink_seen_at: RECENTE, uplink_type: "wire" })],
    overrides: [
      { id: 1, action: "add", a_node: "dev:3", a_port: "Port 20", b_node: "dev:4", b_port: "eno2", medium: "fibra" },
      { id: 2, action: "add", a_node: "dev:1", a_port: "wifi", b_node: "dev:3", b_port: "", medium: "boh" },
    ],
  });
  const m = buildTopologyModel(i);
  const l = (a: string, b: string) => m.links.find((x) => [x.a, x.b].sort().join("|") === [a, b].sort().join("|"))!;
  assert.equal(l("dev:2", "dev:5").medium, "wireless");
  assert.equal(l("dev:2", "dev:6").medium, null);
  assert.equal(l("dev:3", "dev:4").medium, "fibra");
  assert.equal(l("dev:1", "dev:3").medium, "wireless", "porta «wifi», tipo non valido scartato");
});

test("linkCost: la scelta a mano vale −1000; poi vecchiaia e fonte", () => {
  const l = (over: Partial<MapLink>): MapLink => ({
    id: "x", a: "dev:1", aPort: "", b: "dev:2", bPort: "", source: "lldp", sources: ["lldp"], uplinkFrom: null, lastSeen: null,
    daysUnseen: null, stale: false, ...LINK_ATTRS_DEFAULT, ...over,
  });
  assert.equal(linkCost(l({ primary: "user", source: "mac_table", stale: true })), -1000);
  assert.equal(linkCost(l({ source: "unifi_uplink" })), 1);
  assert.equal(linkCost(l({ source: "lldp" })), 2);
  assert.equal(linkCost(l({ source: "cdp" })), 2);
  assert.equal(linkCost(l({ source: "mndp" })), 2);
  assert.equal(linkCost(l({ source: "mac_table" })), 3);
  assert.equal(linkCost(l({ source: "manual", sources: ["manual"], manual: { confirmed: true } })), 3);
  assert.equal(linkCost(l({ source: "manual", sources: ["manual"], manual: { confirmed: false } })), 4);
  assert.equal(linkCost(l({ source: "lldp", stale: true })), 102);
});

test("stessi dati, stesso albero (principale e ridondanza compresi)", () => {
  const i = rete({ overrides: [{ id: 1, action: "add", a_node: "dev:4", a_port: "eno2", b_node: "dev:3", b_port: "Port 9", medium: null }] });
  const a = albero(i), b = albero(rete({ overrides: i.overrides }));
  const ser = (x: ReturnType<typeof albero>) => JSON.stringify({ c: [...x.t.children.entries()], v: [...x.t.via.entries()], l: x.t.links, r: x.t.roots });
  assert.equal(ser(a), ser(b));
});

// Spec §13.6.1: la velocità di una linea è la minima delle due porte trovate per CHIAVE. Prima si cercava per nome
// normalizzato, e «SFP_ 17 - x» (tabella LLDP del controller) non trovava «SFP+ 17 - x» (elenco delle porte): sull'hub
// tre hypervisor finivano sotto lo switch di gestione a 2,5G invece che sotto l'aggregazione a 10G (H9); sul cliente A
// i cavi 8 e 9 di core 2 non avevano velocità (C9).
test("velocità per chiave: «SFP_ 17 - x» del controller trova «SFP+ 17 - x» nell'elenco; «Port N» remota trova l'indice N", () => {
  const i = baseInput({
    devices: [dev(11, { name: "AGG-11", via: "api" }), dev(4, { name: "HV-4", device_type: "hypervisor", vendor: "proxmox" })],
    ports: [{ device_id: 11, port_index: 17, port_name: "SFP+ 17 - nodo-a", speed: "10000 Mbps", status: "up", stp_state: null }],
    neighbors: [{ device_id: 11, local_port: "SFP_ 17 - nodo-a", remote_device_name: "HV-4", remote_port: "enp1s0", protocol: "lldp", remote_ip: "10.0.0.4", remote_mac: null, timestamp: "2026-10-13 03:00:00", source: "unifi" }],
  });
  const l = buildTopologyModel(i).links.find((x) => x.id === "link:dev:11|dev:4")!;
  assert.deepEqual([l.a === "dev:11" ? l.aPort : l.bPort, l.speedMbps], ["SFP+ 17 - nodo-a", 10000]);
});

// I70 (spec §13.6.1, «Un nome doppio con una velocità sola»; H13). Un nome che corrisponde a più porte non dice la porta (I14),
// ma se tutte hanno la stessa velocità la velocità sì. Rete B: il cavo dati di un hypervisor sta su un nome di due porte a 10G,
// e senza velocità l'hypervisor andava sotto la sua porta di gestione a 1G.
test("I70 — un nome doppio con una velocità sola dà la velocità; con due velocità no; spenta la regola, come prima", () => {
  const conPorte = (v2: string) => baseInput({
    devices: [dev(11, { name: "AGG-11", via: "api" }), dev(4, { name: "HV-4", device_type: "server", vendor: "proxmox" })],
    ports: [
      { device_id: 11, port_index: 15, port_name: "SFP+ 15", speed: "10000 Mbps", status: "up", stp_state: null },
      { device_id: 11, port_index: 16, port_name: "SFP+ 15", speed: v2, status: "up", stp_state: null },
    ],
    neighbors: [{ device_id: 11, local_port: "SFP+ 15", remote_device_name: "HV-4", remote_port: "enp1s0", protocol: "lldp", remote_ip: "10.0.0.4", remote_mac: null, timestamp: "2026-10-13 03:00:00", source: "unifi" }],
  });
  const velocita = (i: ReturnType<typeof conPorte>, regole?: Regole) => buildTopologyModel(i, regole).links.find((x) => x.id === "link:dev:11|dev:4")?.speedMbps;
  assert.equal(velocita(conPorte("10000 Mbps")), 10000);
  assert.equal(velocita(conPorte("1000 Mbps")), null);
  assert.equal(velocita(conPorte("10000 Mbps"), new Set()), null, "regola spenta (misura C19): come prima");
});
