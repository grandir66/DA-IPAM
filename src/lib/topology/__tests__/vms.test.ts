import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTopologyModel } from "@/lib/topology/model";
import { buildNodeIndex } from "@/lib/topology/node-index";
import { nodeClass } from "@/lib/topology/identity";
import { parseProxmoxScan, placeVms } from "@/lib/topology/vms";
import type { ModelVmRow, TopologyModelInput } from "@/lib/topology/model-types";
import { baseInput, dev, host } from "./support/righe";

// Dati inventati con la forma vera della scansione Proxmox (IP 192.0.2.x, MAC 02:00:00:…).
const vm = (vmid: number, node: string, over: Partial<ModelVmRow> = {}): ModelVmRow => ({
  scannedDeviceId: 3, vmid, name: `vm-${vmid}`, node, status: "running", type: "qemu", macs: [], ips: [],
  scannedAt: "2026-10-13T06:00:00.000Z", ...over,
});

/** Un cluster di tre host: pve-a è un apparato (la scansione gira su di lui), pve-b e pve-c sono host censiti. */
function cluster(over: Partial<TopologyModelInput> = {}): TopologyModelInput {
  return baseInput({
    devices: [
      dev(1, { name: "RTR-1", device_type: "router", host: "192.0.2.1" }),
      dev(2, { name: "SW-1", host: "192.0.2.2" }),
      dev(3, { name: "pve-a", device_type: "server", vendor: "proxmox", host: "192.0.2.11", port_count: 0 }),
      dev(4, { name: "altro-server", device_type: "server", vendor: "dell", host: "192.0.2.51", port_count: 0 }),
    ],
    hosts: [
      host(41, { ip: "192.0.2.12", classification: "hypervisor", hostname: "pve-b" }),
      host(42, { ip: "192.0.2.13", classification: "hypervisor", hostname: "pve-c" }),
      host(50, { ip: "192.0.2.50", classification: "server", hostname: "web-vm", mac: "02:00:00:aa:00:03" }),
    ],
    scanHosts: [
      { scannedDeviceId: 3, hostname: "pve-a", ips: ["192.0.2.11"], macs: [] },
      { scannedDeviceId: 3, hostname: "pve-b", ips: ["192.0.2.12"], macs: [] },
      { scannedDeviceId: 3, hostname: "pve-c", ips: ["192.0.2.13"], macs: [] },
    ],
    vms: [
      vm(100, "pve-a", { macs: ["02:00:00:aa:00:01"], ips: ["198.51.100.10"] }),
      vm(101, "pve-b", { macs: ["02:00:00:aa:00:02"] }),
      vm(102, "pve-b", { status: "stopped" }),
      vm(103, "pve-c", { macs: ["02:00:00:aa:00:03"] }),
    ],
    ...over,
  });
}

test("tre host di cluster con 4 VM: ognuna sta nel suo host, per IP e poi per nome", () => {
  const i = cluster();
  const { vms } = placeVms(i, buildNodeIndex(i.devices, i.hosts, i.knownMacs, i.neighbors));
  assert.deepEqual(vms.map((v) => [v.id, v.hypervisorNodeId]), [
    ["vm:3:100", "dev:3"], ["vm:3:101", "host:41"], ["vm:3:102", "host:41"], ["vm:3:103", "host:42"],
  ]);
  assert.equal(vms[0].name, "vm-100");
  assert.deepEqual(vms[0].ips, ["198.51.100.10"]);
});

test("l'host si abbina anche per nome quando l'IP non c'è (alias compresi)", () => {
  const i = cluster({ scanHosts: [{ scannedDeviceId: 3, hostname: "PVE-B", ips: [], macs: [] }], vms: [vm(101, "pve-b")] });
  const { vms } = placeVms(i, buildNodeIndex(i.devices, i.hosts, i.knownMacs, i.neighbors));
  assert.equal(vms[0].hypervisorNodeId, "host:41");
});

test("senza un host abbinato la VM sta nell'apparato scansionato", () => {
  const i = cluster({ vms: [vm(110, "nodo-sconosciuto")], scanHosts: [] });
  const { vms } = placeVms(i, buildNodeIndex(i.devices, i.hosts, i.knownMacs, i.neighbors));
  assert.equal(vms[0].hypervisorNodeId, "dev:3");
});

test("Review Focus 3: una VM con lo stesso MAC di un host censito è quell'host, che esce da «Da sistemare»", () => {
  const m = buildTopologyModel(cluster());
  const v103 = m.vms.find((v) => v.id === "vm:3:103")!;
  assert.equal(v103.nodeId, "host:50");
  assert.equal(v103.hypervisorNodeId, "host:42");
  assert.ok(!m.isolated.includes("host:50"), "host:50 è una VM: non va sistemato");
  assert.ok(m.isolated.includes("dev:4"), "un altro server senza collegamenti resta in «Da sistemare»");
  assert.ok(!m.withoutSite.includes("host:50"));
  assert.equal(m.vms.filter((v) => v.nodeId !== null).length, 1);
});

test("Review Focus 3: il MAC di una VM visto su una porta di switch non è un client di quella porta", () => {
  const i = cluster({
    macPorts: [
      { device_id: 2, mac: "02:00:00:aa:00:01", port_name: "Port 17", timestamp: "2026-10-13 06:00:00", source: "device" },
      { device_id: 2, mac: "02:00:00:aa:00:03", port_name: "Port 17", timestamp: "2026-10-13 06:00:00", source: "device" },
      { device_id: 2, mac: "02:00:00:bb:00:09", port_name: "Port 17", timestamp: "2026-10-13 06:00:00", source: "device" },
    ],
  });
  const porta = (m: ReturnType<typeof buildTopologyModel>) => m.portClients.find((p) => p.nodeId === "dev:2" && p.port === "Port 17");
  assert.deepEqual(porta(buildTopologyModel(i))!.clients.map((c) => c.mac), ["02:00:00:BB:00:09"]);
  assert.equal(buildTopologyModel(i).clientCount["dev:2"], 1);
  assert.equal(buildTopologyModel(i).links.filter((l) => l.source === "mac_table").length, 0, "nessun collegamento dal MAC di una VM");
  // Controllo: senza le VM, gli stessi MAC erano client (e quello dell'host censito un collegamento).
  const senza = buildTopologyModel({ ...i, vms: [] });
  assert.equal(porta(senza)!.clients.length, 2);
});

test("un apparato «server» con fornitore Proxmox o VMware è un hypervisor; un server qualunque no", () => {
  assert.equal(nodeClass({ type: "server", vendor: "proxmox" }), "hyper");
  assert.equal(nodeClass({ type: "server_linux", vendor: "VMware" }), "hyper");
  assert.equal(nodeClass({ type: "hypervisor", vendor: null }), "hyper");
  assert.equal(nodeClass({ type: "server", vendor: "dell" }), "att");
  assert.equal(nodeClass({ type: "switch", vendor: "proxmox" }), "infra");
  const m = buildTopologyModel(cluster());
  assert.equal(nodeClass(m.nodes.find((n) => n.id === "dev:3")!), "hyper");
  assert.equal(nodeClass(m.nodes.find((n) => n.id === "host:41")!), "hyper");
});

test("senza MAC la VM coincide con un nodo attaccato o client dello stesso nome; con MAC diversi no", () => {
  const i = cluster({ vms: [vm(120, "pve-a", { name: "web-vm" }), vm(121, "pve-a", { name: "altro-server", macs: ["02:00:00:cc:00:01"] })] });
  const { vms, vmNodeIds } = placeVms(i, buildNodeIndex(i.devices, i.hosts, i.knownMacs, i.neighbors));
  assert.equal(vms[0].nodeId, "host:50");
  assert.equal(vms[1].nodeId, null);
  assert.deepEqual([...vmNodeIds], ["host:50"]);
});

test("la stessa VM letta da due apparati scansionati è una sola (vince la lettura più recente)", () => {
  const i = cluster({
    vms: [vm(100, "pve-a", { scannedDeviceId: 3, scannedAt: "2026-05-22T10:00:00.000Z" }), vm(100, "pve-a", { scannedDeviceId: 4, scannedAt: "2026-10-13T06:00:00.000Z" })],
    scanHosts: [
      { scannedDeviceId: 3, hostname: "pve-a", ips: ["192.0.2.11"], macs: [] },
      { scannedDeviceId: 4, hostname: "pve-a", ips: ["192.0.2.11"], macs: [] },
    ],
  });
  const { vms } = placeVms(i, buildNodeIndex(i.devices, i.hosts, i.knownMacs, i.neighbors));
  assert.deepEqual(vms.map((v) => v.id), ["vm:4:100"]);
});

test("JSON della scansione rovinato o di forma inattesa: nessuna VM, nessun errore", () => {
  for (const raw of ["{rotto", "", null, "[]", "42", '{"vms":"x","hosts":7}', '{"vms":[null,5,{"vmid":"x"}],"hosts":[null]}']) {
    assert.deepEqual(parseProxmoxScan(3, raw), { vms: [], hosts: [] }, String(raw));
  }
  const m = buildTopologyModel(cluster({ vms: [], scanHosts: [] }));
  assert.deepEqual(m.vms, []);
});

test("parseProxmoxScan legge la forma vera: VM con le schede e gli IP, host con le schede (anche vive)", () => {
  const raw = JSON.stringify({
    scanned_at: "2026-10-13T06:00:00.000Z",
    hosts: [{
      hostname: "pve-a",
      network_interfaces: [
        { name: "vmbr0", type: "bridge", state: "up", mac_address: "02:00:00:AA:BB:01", ip_addresses: "192.0.2.11/24", bridge: null, vlan_id: null, speed_mbps: null },
        { name: "nic3", type: "eth", state: "down", mac_address: null, ip_addresses: null, bridge: null, vlan_id: null, speed_mbps: null },
      ],
    }],
    vms: [
      { node: "pve-a", vmid: 106, name: "w-server", status: "running", type: "qemu", ip_addresses: ["198.51.100.7"],
        networks_details: [{ id: "net0", model: "e1000", mac: "02:00:00:AA:CC:01", bridge: "vmbr1" }, { id: "net1" }] },
      { node: "pve-a", vmid: 107, name: "c-lxc", status: "stopped", type: "lxc", ip_addresses: [], networks_details: [] },
    ],
  });
  const r = parseProxmoxScan(5, raw);
  assert.deepEqual(r.hosts, [{ scannedDeviceId: 5, hostname: "pve-a", ips: ["192.0.2.11"], macs: ["02:00:00:AA:BB:01"] }]);
  assert.equal(r.vms.length, 2);
  assert.deepEqual(r.vms[0], {
    scannedDeviceId: 5, vmid: 106, name: "w-server", node: "pve-a", status: "running", type: "qemu",
    macs: ["02:00:00:AA:CC:01"], ips: ["198.51.100.7"], scannedAt: "2026-10-13T06:00:00.000Z",
  });
});
