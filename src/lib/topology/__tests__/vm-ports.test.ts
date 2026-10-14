// Task 2b (spec topologia §12.5): hypervisor dalle VM sulla porta, principale dell'hypervisor, nome dal Proxmox.
// Dati inventati con la forma vera (VM con `node`, `status`, MAC nelle schede; IP 192.0.2.x; MAC 02:00:…).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTopologyModel } from "@/lib/topology/model";
import { buildTree } from "@/lib/topology/tree";
import { SOURCE_WORDS, vmPortWords } from "@/lib/topology/edge-look";
import type { MapLink, ModelMacPortRow, ModelVmRow, TopologyModelInput } from "@/lib/topology/model-types";
import { baseInput, dev } from "./support/righe";

const RECENTE = "2026-10-13 11:00:00";
const VECCHIO = "2026-10-01 11:00:00";
const mp = (device_id: number, mac: string, port_name: string, timestamp = RECENTE): ModelMacPortRow =>
  ({ device_id, mac, port_name, timestamp, source: "device" });
const vmMac = (h: number, k: number) => `02:00:00:a${h}:00:${String(k).padStart(2, "0")}`;
const vm = (vmid: number, node: string, mac: string, over: Partial<ModelVmRow> = {}): ModelVmRow => ({
  scannedDeviceId: 5, vmid, name: `vm-${vmid}`, node, status: "running", type: "qemu", macs: [mac], ips: [],
  scannedAt: "2026-10-13T06:00:00.000Z", ...over,
});
/** VM accese di un hypervisor: `n` VM numerate da `from`, MAC vmMac(h, k). */
const vmsOf = (h: number, node: string, from: number, n: number, over: Partial<ModelVmRow> = {}) =>
  Array.from({ length: n }, (_, i) => vm(100 * h + from + i, node, vmMac(h, from + i), over));

const H_MAC = "02:00:00:00:05:01";

/**
 * Router 1; centrale 2 e centrale 3 (switch); accesso 4 (switch); hypervisor 5 «px-h» e 6 «px-k» (server Proxmox).
 * I tre switch salgono al router con LLDP sulla «Port 24». La scheda di gestione di px-h (1G) sta sulla Port 5
 * dell'accesso; le schede 10G non si vedono (il programma non ne conosce il MAC).
 */
function rete(over: Partial<TopologyModelInput> = {}): TopologyModelInput {
  const lldp = (id: number) => ({
    device_id: id, local_port: "Port 24", remote_device_name: "RTR-1", remote_port: `ether${id}`, protocol: "lldp",
    remote_ip: "192.0.2.1", remote_mac: null, timestamp: RECENTE, source: "device",
  });
  return baseInput({
    devices: [
      dev(1, { name: "RTR-1", device_type: "router", host: "192.0.2.1" }),
      dev(2, { name: "CENTRALE-2", host: "192.0.2.2" }),
      dev(3, { name: "CENTRALE-3", host: "192.0.2.3" }),
      dev(4, { name: "ACCESSO-4", host: "192.0.2.4" }),
      dev(5, { name: "px-h", device_type: "server", vendor: "proxmox", host: "192.0.2.15", port_count: 0 }),
      dev(6, { name: "px-k", device_type: "server", vendor: "proxmox", host: "192.0.2.16", port_count: 0 }),
    ],
    neighbors: [lldp(2), lldp(3), lldp(4)],
    knownMacs: [{ device_id: 5, mac: H_MAC }],
    scanHosts: [
      { scannedDeviceId: 5, hostname: "px-h", ips: ["192.0.2.15"], macs: [] },
      { scannedDeviceId: 5, hostname: "px-k", ips: ["192.0.2.16"], macs: [] },
    ],
    portInfo: [
      { device_id: 2, port_name: "Port 1", speed: "10G", poe_status: null, poe_power_mw: null },
      { device_id: 3, port_name: "Port 1", speed: "10G", poe_status: null, poe_power_mw: null },
      { device_id: 4, port_name: "Port 5", speed: "1000 Mbps", poe_status: null, poe_power_mw: null },
    ],
    ...over,
  });
}
const pair = (links: MapLink[], a: string, b: string) => links.filter((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
const vmLinks = (links: MapLink[]) => links.filter((l) => l.sources.includes("vm_mac"));

test("porta con 3 VM accese tutte di px-h: collegamento «dalle VM» verso px-h, e le VM non sono client", () => {
  const vms = vmsOf(5, "px-h", 1, 3);
  const m = buildTopologyModel(rete({ vms, macPorts: vms.map((v) => mp(2, v.macs[0], "Port 1")) }));
  const l = vmLinks(m.links);
  assert.equal(l.length, 1);
  assert.deepEqual([l[0].a, l[0].aPort, l[0].b, l[0].source, l[0].sources, l[0].uplinkFrom, l[0].vmCount, l[0].stale],
    ["dev:2", "Port 1", "dev:5", "vm_mac", ["vm_mac"], "dev:5", 3, false]);
  assert.equal(l[0].speedMbps, 10000);
  assert.deepEqual(m.portClients, []);
  assert.equal(m.counts.linksBySource.vm_mac, 1);
});

test("VM di px-h e di px-k sulla stessa porta: porta di passaggio, niente", () => {
  const vms = [...vmsOf(5, "px-h", 1, 3), ...vmsOf(6, "px-k", 1, 1)];
  const m = buildTopologyModel(rete({ vms, macPorts: vms.map((v) => mp(2, v.macs[0], "Port 1")) }));
  assert.deepEqual(vmLinks(m.links), []);
});

test("porta uplink o porta di un collegamento fra apparati: niente", () => {
  const vms = vmsOf(5, "px-h", 1, 2);
  const m = buildTopologyModel(rete({
    vms,
    uplinkPorts: [{ device_id: 3, port_index: 9, port_name: "Port 9" }],
    macPorts: [...vms.map((v) => mp(2, v.macs[0], "Port 24")), ...vms.map((v) => mp(3, v.macs[0], "Port 9"))],
  }));
  assert.deepEqual(vmLinks(m.links), []);
});

test("le VM spente non contano: né per il conto né per guastare la porta", () => {
  const accese = vmsOf(5, "px-h", 1, 1);
  const spente = vmsOf(6, "px-k", 1, 2, { status: "stopped" });
  const soloSpente = vmsOf(5, "px-h", 10, 2, { status: "stopped" });
  const m = buildTopologyModel(rete({
    vms: [...accese, ...spente, ...soloSpente],
    macPorts: [...[...accese, ...spente].map((v) => mp(2, v.macs[0], "Port 1")), ...soloSpente.map((v) => mp(3, v.macs[0], "Port 1"))],
  }));
  const l = vmLinks(m.links);
  assert.deepEqual(l.map((x) => [x.a, x.b, x.vmCount]), [["dev:2", "dev:5", 1]]);
});

test("le VM viste oltre la soglia «non visto» non contano", () => {
  const fresche = vmsOf(5, "px-h", 1, 2);
  const vecchie = vmsOf(6, "px-k", 1, 2);
  const soloVecchie = vmsOf(5, "px-h", 10, 3);
  const m = buildTopologyModel(rete({
    vms: [...fresche, ...vecchie, ...soloVecchie],
    macPorts: [
      ...fresche.map((v) => mp(2, v.macs[0], "Port 1")),
      ...vecchie.map((v) => mp(2, v.macs[0], "Port 1", VECCHIO)),
      ...soloVecchie.map((v) => mp(3, v.macs[0], "Port 1", VECCHIO)),
    ],
  }));
  assert.deepEqual(vmLinks(m.links).map((x) => [x.a, x.b, x.vmCount]), [["dev:2", "dev:5", 2]]);
});

test("la stessa VM in una scansione vecchia su un altro nodo non guasta la porta: vale la lettura più recente", () => {
  // Come sul cliente A: una scansione di maggio dice che la VM girava su px-k, quella di stanotte su px-h; e una
  // replica spenta con lo stesso MAC nella lettura di stanotte non conta.
  const ora = vmsOf(5, "px-h", 1, 3);
  const vecchia = ora.map((v) => ({ ...v, node: "px-k", scannedDeviceId: 6, scannedAt: "2026-05-22T10:00:00.000Z" }));
  const replica = { ...ora[0], vmid: 9001, node: "px-k", status: "stopped" };
  const m = buildTopologyModel(rete({ vms: [...ora, ...vecchia, replica], macPorts: ora.map((v) => mp(2, v.macs[0], "Port 1")) }));
  assert.deepEqual(vmLinks(m.links).map((x) => [x.a, x.b, x.vmCount]), [["dev:2", "dev:5", 3]]);
});

test("una VM spenta nell'ultima lettura non conta anche se una lettura vecchia la dava accesa altrove", () => {
  const ora = vmsOf(5, "px-h", 1, 2);
  const spenta = { ...vm(503, "px-h", vmMac(5, 3)), status: "stopped" };
  const vecchia = { ...spenta, node: "px-k", status: "running", scannedDeviceId: 6, scannedAt: "2026-05-22T10:00:00.000Z" };
  const m = buildTopologyModel(rete({ vms: [...ora, spenta, vecchia], macPorts: [...ora, spenta].map((v) => mp(2, v.macs[0], "Port 1")) }));
  assert.deepEqual(vmLinks(m.links).map((x) => [x.a, x.b, x.vmCount]), [["dev:2", "dev:5", 2]]);
});

test("stessa coppia già collegata dalla tabella MAC: si fonde (fonti mac_table + vm_mac), niente doppioni", () => {
  const vms = vmsOf(5, "px-h", 1, 1);
  const m = buildTopologyModel(rete({ vms, macPorts: [mp(4, H_MAC, "Port 5"), mp(4, vms[0].macs[0], "Port 5")] }));
  const l = pair(m.links, "dev:4", "dev:5");
  assert.equal(l.length, 1);
  assert.deepEqual([l[0].source, l[0].sources, l[0].aPort, l[0].vmCount], ["mac_table", ["mac_table", "vm_mac"], "Port 5", 1]);
});

/** px-h: gestione 1G sull'accesso (tabella MAC, 1 VM) e 10G sul centrale 2 (11 VM). */
function dueCavi(over: Partial<TopologyModelInput> = {}): TopologyModelInput {
  const sulCentrale = vmsOf(5, "px-h", 1, 11);
  const sullAccesso = vmsOf(5, "px-h", 20, 1);
  return rete({
    vms: [...sulCentrale, ...sullAccesso],
    macPorts: [...sulCentrale.map((v) => mp(2, v.macs[0], "Port 1")), mp(4, H_MAC, "Port 5"), mp(4, sullAccesso[0].macs[0], "Port 5")],
    ...over,
  });
}
const albero = (i: TopologyModelInput) => {
  const m = buildTopologyModel(i);
  return buildTree(m, new Set(m.nodes.map((n) => n.id)), ["dev:1"]);
};
const padre = (t: ReturnType<typeof albero>, id: string) => { const l = t.via.get(id)!; return l.a === id ? l.b : l.a; };

test("principale dell'hypervisor: il cavo più veloce (10G dalle VM) vince sul 1G della gestione, che è ridondanza", () => {
  const t = albero(dueCavi());
  assert.equal(padre(t, "dev:5"), "dev:2");
  assert.equal(t.via.get("dev:5")!.primary, "auto");
  const g = pair(t.links, "dev:4", "dev:5")[0];
  assert.equal(g.redundant, true);
});

test("★ scelto a mano sul 1G: vince il 1G", () => {
  const t = albero(dueCavi({ primaries: [{ node_id: "dev:5", other_node: "dev:4", node_port: "", other_port: "Port 5" }] }));
  assert.equal(padre(t, "dev:5"), "dev:4");
  assert.equal(t.via.get("dev:5")!.primary, "user");
  assert.equal(pair(t.links, "dev:2", "dev:5")[0].redundant, true);
});

test("due cavi 10G: vince quello con più VM", () => {
  const su2 = vmsOf(5, "px-h", 1, 3);
  const su3 = vmsOf(5, "px-h", 10, 5);
  const t = albero(rete({ vms: [...su2, ...su3], macPorts: [...su2.map((v) => mp(2, v.macs[0], "Port 1")), ...su3.map((v) => mp(3, v.macs[0], "Port 1"))] }));
  assert.equal(padre(t, "dev:5"), "dev:3");
  assert.equal(pair(t.links, "dev:2", "dev:5")[0].redundant, true);
});

test("un apparato che non è un hypervisor: la scelta resta quella di oggi (fonte più affidabile)", () => {
  // Lo switch 4 è visto via LLDP dal router e via tabella MAC (porta 10G) dal centrale 2: resta l'LLDP.
  const sw4 = "02:00:00:00:04:01";
  const t = albero(rete({
    knownMacs: [{ device_id: 4, mac: sw4 }],
    macPorts: [mp(2, sw4, "Port 1")],
  }));
  assert.equal(padre(t, "dev:4"), "dev:1");
});

test("nome dal Proxmox: l'IP dell'apparato sta nell'host «PVE-GIU» → name «PVE-GIU», dnsName «pve-02.esempio»", () => {
  const i = rete({
    devices: [...rete().devices.filter((d) => d.id !== 5), dev(5, { name: "pve-02.esempio", device_type: "server", vendor: "proxmox", host: "192.0.2.15", port_count: 0 })],
    scanHosts: [{ scannedDeviceId: 5, hostname: "PVE-GIU", ips: ["192.0.2.15", "198.51.100.15"], macs: [] }],
  });
  const n = buildTopologyModel(i).nodes.find((x) => x.id === "dev:5")!;
  assert.deepEqual([n.name, n.dnsName], ["PVE-GIU", "pve-02.esempio"]);
  // L'inventario non cambia: il nome della riga dell'apparato resta quello.
  assert.equal(i.devices.find((d) => d.id === 5)!.name, "pve-02.esempio");
});

test("stesso nome con un dominio diverso o in maiuscolo: nessun dnsName", () => {
  const i = rete({
    devices: [...rete().devices.filter((d) => d.id !== 5), dev(5, { name: "PX-H.altro.dominio", device_type: "server", vendor: "proxmox", host: "192.0.2.15", port_count: 0 })],
    scanHosts: [{ scannedDeviceId: 5, hostname: "px-h.dominio", ips: ["192.0.2.15"], macs: [] }],
  });
  const n = buildTopologyModel(i).nodes.find((x) => x.id === "dev:5")!;
  assert.deepEqual([n.name, n.dnsName], ["PX-H.altro.dominio", undefined]);
});

test("nome dal Proxmox solo per IP: un host del cluster abbinato per nome non rinomina niente", () => {
  const i = rete({ scanHosts: [{ scannedDeviceId: 5, hostname: "px-h", ips: [], macs: [] }] });
  const n = buildTopologyModel(i).nodes.find((x) => x.id === "dev:5")!;
  assert.deepEqual([n.name, n.dnsName], ["px-h", undefined]);
});

test("apparato che si chiama col suo IP: prende il nome dal Proxmox, senza «DNS:»", () => {
  const i = rete({
    devices: [...rete().devices.filter((d) => d.id !== 5), dev(5, { name: "192.0.2.15", device_type: "server", vendor: "proxmox", host: "192.0.2.15", port_count: 0 })],
    scanHosts: [{ scannedDeviceId: 5, hostname: "px-h", ips: ["192.0.2.15"], macs: [] }],
  });
  const n = buildTopologyModel(i).nodes.find((x) => x.id === "dev:5")!;
  assert.deepEqual([n.name, n.dnsName], ["px-h", undefined]);
});

test("parole: la fonte «dalle VM» e «N VM di H passano da questa porta»", () => {
  assert.equal(SOURCE_WORDS.vm_mac, "dalle VM");
  assert.equal(SOURCE_WORDS.mac_table, "tabella MAC");
  const l = { vmCount: 15, uplinkFrom: "dev:5", sources: ["vm_mac"] } as unknown as MapLink;
  assert.equal(vmPortWords(l, () => "PVE-GIU"), "15 VM di PVE-GIU passano da questa porta");
  assert.equal(vmPortWords({ ...l, vmCount: 1 }, () => "PVE-SU"), "1 VM di PVE-SU passa da questa porta");
  assert.equal(vmPortWords({ ...l, sources: ["lldp"], vmCount: undefined } as unknown as MapLink, () => "x"), null);
});
