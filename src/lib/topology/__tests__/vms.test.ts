import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTopologyModel } from "@/lib/topology/model";
import { buildNodeIndex } from "@/lib/topology/node-index";
import { nodeClass } from "@/lib/topology/identity";
import { macOf, parseProxmoxScan, placeVms } from "@/lib/topology/vms";
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
      dev(2, { name: "SW-1", host: "192.0.2.2", controller_mac: "02:00:00:00:02:02" }), // T1b (spec §13.8.2): la prova di ruolo che il dato vero ha
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

test("la stessa VM letta da due apparati scansionati è una sola (id dall'apparato con l'id più basso)", () => {
  const i = cluster({
    vms: [vm(100, "pve-a", { scannedDeviceId: 3, scannedAt: "2026-05-22T10:00:00.000Z" }), vm(100, "pve-a", { scannedDeviceId: 4, scannedAt: "2026-10-13T06:00:00.000Z" })],
    scanHosts: [
      { scannedDeviceId: 3, hostname: "pve-a", ips: ["192.0.2.11"], macs: [] },
      { scannedDeviceId: 4, hostname: "pve-a", ips: ["192.0.2.11"], macs: [] },
    ],
  });
  const { vms } = placeVms(i, buildNodeIndex(i.devices, i.hosts, i.knownMacs, i.neighbors));
  assert.deepEqual(vms.map((v) => v.id), ["vm:3:100"]);
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
  assert.deepEqual(r.hosts, [{ scannedDeviceId: 5, hostname: "pve-a", ips: ["192.0.2.11"], macs: ["02:00:00:AA:BB:01"], scannedAt: "2026-10-13T06:00:00.000Z" }]);
  assert.equal(r.vms.length, 2);
  assert.deepEqual(r.vms[0], {
    scannedDeviceId: 5, vmid: 106, name: "w-server", node: "pve-a", status: "running", type: "qemu",
    macs: ["02:00:00:AA:CC:01"], ips: ["198.51.100.7"], scannedAt: "2026-10-13T06:00:00.000Z",
  });
});

test("senza MAC e senza nome noto, l'IP che la VM dichiara la riconosce (una macchina censita con un tipo sbagliato)", () => {
  const i = cluster({
    devices: [...cluster().devices, dev(7, { name: "srv-windows", device_type: "switch", vendor: "windows", host: "198.51.100.77", port_count: 0 })],
    vms: [vm(130, "pve-a", { name: "altro-nome", macs: ["02:00:00:cc:00:09"], ips: ["198.51.100.77"] })],
  });
  const m = buildTopologyModel(i);
  assert.equal(m.vms[0].nodeId, "dev:7");
  assert.ok(!m.isolated.includes("dev:7") && !m.withoutSite.includes("dev:7"));
  const altro = cluster({ vms: [vm(131, "pve-a", { ips: ["198.51.100.99"] })] });
  assert.equal(buildTopologyModel(altro).vms[0].nodeId, null);
});

test("i MAC delle scansioni si validano: le scansioni vecchie hanno un IP nel campo MAC (dodici cifre che sembrano un MAC)", () => {
  const raw = JSON.stringify({
    scanned_at: "2026-05-22T10:00:00.000Z",
    hosts: [{
      hostname: "pve-a",
      network_interfaces: [
        { name: "vmbr0", mac_address: "192.168.100.123", ip_addresses: "192.0.2.11/24" },
        { name: "eno1", mac_address: "02-00-00-aa-bb-02", master: "bond0" },
        { name: "eno2", mac_address: "0200.00aa.bb03", master: "bond0" },
      ],
    }],
    vms: [{ node: "pve-a", vmid: 140, name: "vm-140", status: "running", type: "qemu", ip_addresses: [],
      networks_details: [{ id: "net0", mac: "192.168.100.124" }, { id: "net1", mac: "02:00:00:aa:cc:04" }] }],
  });
  const r = parseProxmoxScan(5, raw);
  assert.deepEqual(r.hosts[0].macs, ["02:00:00:AA:BB:02"], "l'IP non diventa un MAC; la forma xx-xx-… si normalizza; la forma a tre gruppi no");
  assert.deepEqual(r.vms[0].macs, ["02:00:00:AA:CC:04"]);
  // Anche ciò che arriva a placeVms già «in forma di riga» si rivaluta.
  const i = cluster({ vms: [vm(141, "pve-a", { macs: ["192.168.100.125", "02:00:00:aa:cc:05"] })] });
  const { vmMacs } = placeVms(i, buildNodeIndex(i.devices, i.hosts, i.knownMacs, i.neighbors));
  assert.deepEqual([...vmMacs], ["02:00:00:AA:CC:05"]);
});

test("due letture della stessa VM: IP e MAC della vecchia valgono se la nuova non li ha (VM riconosciuta per IP)", () => {
  const due = (nuova: Partial<ModelVmRow>) => cluster({
    devices: [...cluster().devices, dev(7, { name: "srv-windows", device_type: "switch", vendor: "windows", host: "198.51.100.77", port_count: 0 })],
    vms: [
      vm(130, "pve-a", { scannedDeviceId: 3, scannedAt: "2026-05-22T10:00:00.000Z", name: "altro-nome", ips: ["198.51.100.77"], macs: ["02:00:00:cc:00:09"] }),
      vm(130, "pve-a", { scannedDeviceId: 4, scannedAt: "2026-10-13T06:00:00.000Z", name: "altro-nome", ...nuova }),
    ],
    scanHosts: [
      { scannedDeviceId: 3, hostname: "pve-a", ips: ["192.0.2.11"], macs: [] },
      { scannedDeviceId: 4, hostname: "pve-a", ips: ["192.0.2.11"], macs: [] },
    ],
  });
  const m = buildTopologyModel(due({ ips: [], macs: [] }));
  assert.equal(m.vms.length, 1);
  assert.equal(m.vms[0].id, "vm:3:130", "l'id è quello dell'apparato con l'id più basso, non della lettura più recente");
  assert.deepEqual(m.vms[0].ips, ["198.51.100.77"]);
  assert.equal(m.vms[0].nodeId, "dev:7", "riconosciuta per l'IP che solo la lettura vecchia riportava");
  assert.ok(!m.isolated.includes("dev:7"));
  // La lettura nuova ha i suoi IP: valgono quelli, la vecchia non aggiunge un indirizzo forse riassegnato.
  const n = buildTopologyModel(due({ ips: ["198.51.100.99"], macs: ["02:00:00:cc:00:10"] }));
  assert.deepEqual(n.vms[0].ips, ["198.51.100.99"]);
  assert.equal(n.vms[0].nodeId, null);
});

// Revisione finale M-1: sul cliente A più apparati leggono lo stesso cluster, uno dopo l'altro. Se l'id della VM
// seguisse la lettura più recente, basterebbe che l'ultima lettura fallisse una notte per cambiare gli id: le VM
// salvate in una mappa diventerebbero «sparite». L'id viene dall'apparato con l'id più basso; i dati dalla più recente.
test("M-1: l'id di una VM letta da più apparati non cambia con l'ordine delle letture; i dati sono della più recente", () => {
  const due = (at3: string, at4: string) => cluster({
    vms: [
      vm(100, "pve-a", { scannedDeviceId: 3, scannedAt: at3, name: "da-3", ips: ["198.51.100.3"] }),
      vm(100, "pve-a", { scannedDeviceId: 4, scannedAt: at4, name: "da-4", ips: ["198.51.100.4"] }),
    ],
    scanHosts: [
      { scannedDeviceId: 3, hostname: "pve-a", ips: ["192.0.2.11"], macs: [] },
      { scannedDeviceId: 4, hostname: "pve-a", ips: ["192.0.2.11"], macs: [] },
    ],
  });
  const leggi = (i: TopologyModelInput) => placeVms(i, buildNodeIndex(i.devices, i.hosts, i.knownMacs, i.neighbors)).vms;
  const quattroUltimo = leggi(due("2026-10-13T03:00:00.000Z", "2026-10-14T03:05:00.000Z"));
  assert.deepEqual(quattroUltimo.map((v) => [v.id, v.name, v.ips[0], v.scannedAt]), [["vm:3:100", "da-4", "198.51.100.4", "2026-10-14T03:05:00.000Z"]]);
  // Stanotte la lettura del 4 è fallita: il 3 è il più recente. L'id resta lo stesso, i dati sono del 3.
  const treUltimo = leggi(due("2026-10-15T03:00:00.000Z", "2026-10-14T03:05:00.000Z"));
  assert.deepEqual(treUltimo.map((v) => [v.id, v.name]), [["vm:3:100", "da-3"]]);
});

// Revisione finale M-2 (spec §11.5): un hypervisor è anche un server con la scansione Proxmox, non solo uno col
// fornitore giusto. Prima un server «dell» con la scansione restava «att»: «N VM ▸» che non si espande.
test("M-2: un server con la scansione Proxmox è un hypervisor anche con un altro fornitore", () => {
  assert.equal(nodeClass({ type: "server", vendor: "dell", proxmoxScan: true }), "hyper");
  assert.equal(nodeClass({ type: "server", vendor: "dell", proxmoxScan: false }), "att");
  assert.equal(nodeClass({ type: "switch", vendor: null, proxmoxScan: true }), "infra", "il tipo vince: uno switch resta uno switch");
  const i = cluster({
    devices: cluster().devices.map((d) => (d.id === 4 ? { ...d, proxmox_scan: 1 } : d)),
    scanHosts: [{ scannedDeviceId: 4, hostname: "pve-z", ips: ["192.0.2.51"], macs: [] }],
    vms: [vm(150, "pve-z", { scannedDeviceId: 4 })],
  });
  const m = buildTopologyModel(i);
  assert.equal(nodeClass(m.nodes.find((n) => n.id === "dev:4")!), "hyper");
  assert.equal(m.vms[0].hypervisorNodeId, "dev:4", "la VM sta nel suo host, riconosciuto per IP");
});

// Revisione finale M-6: una sola forma del MAC per il modello e per lo script di misura (`scripts/misura-fase2b.ts`).
test("M-6: macOf vale un MAC solo nella forma a sei ottetti; un IP con dodici cifre non è un MAC", () => {
  assert.equal(macOf("02-00-00-aa-bb-cc"), "02:00:00:AA:BB:CC");
  assert.equal(macOf(" 02:00:00:aa:bb:cd "), "02:00:00:AA:BB:CD");
  for (const x of ["192.168.100.123", "0200.00aa.bb03", "020000aabbcc", "00:00:00:00:00:00", "", null, 42]) assert.equal(macOf(x), null, String(x));
});

// Cliente A, 15/10 (prima notte di hypervisor_sync): tre nodi di un cluster scansionati uno per uno. La lettura più recente
// (dal nodo C) aveva l'elenco delle VM di tutto il cluster ma non l'host del nodo A (dati dell'host non letti,
// proxmox-client.ts): le VM di A finivano nel nodo C, il cavo a 10G «dalle VM» di A passava a C e A restava col solo 1G
// di gestione (sulla mappa passo passo, senza collegamenti).
test("un host che la lettura più recente non elenca: le sue VM restano del nodo giusto, non dell'apparato scansionato", () => {
  const nodi = [
    dev(3, { name: "pve-a", device_type: "server", vendor: "proxmox", host: "192.0.2.11", port_count: 0 }),
    dev(5, { name: "pve-c", device_type: "server", vendor: "proxmox", host: "192.0.2.13", port_count: 0 }),
  ];
  const tutto = (over: Partial<TopologyModelInput>) => cluster({ devices: [...cluster().devices, ...nodi.filter((d) => d.id !== 3)], ...over });
  const notte = "2026-10-15T03:00:00.000Z", dopo = "2026-10-15T03:02:00.000Z";
  const leVm = (id: number, at: string) => [
    vm(100, "pve-a", { scannedDeviceId: id, scannedAt: at, macs: ["02:00:00:aa:00:01"] }),
    vm(200, "pve-c", { scannedDeviceId: id, scannedAt: at, macs: ["02:00:00:aa:00:09"] }),
  ];
  const i = tutto({
    scanHosts: [
      { scannedDeviceId: 3, hostname: "pve-a", ips: ["192.0.2.11"], macs: [], scannedAt: notte },
      { scannedDeviceId: 3, hostname: "pve-c", ips: ["192.0.2.13"], macs: [], scannedAt: notte },
      { scannedDeviceId: 5, hostname: "pve-c", ips: ["192.0.2.13"], macs: [], scannedAt: dopo }, // pve-a: host non letto
    ],
    vms: [...leVm(3, notte), ...leVm(5, dopo)],
  });
  const { vms, runningVmMacs } = placeVms(i, buildNodeIndex(i.devices, i.hosts, i.knownMacs, i.neighbors));
  assert.equal(runningVmMacs.get("02:00:00:AA:00:01")?.hypervisor, "dev:3");
  assert.equal(runningVmMacs.get("02:00:00:AA:00:09")?.hypervisor, "dev:5");
  assert.deepEqual(vms.map((v) => [v.id, v.hypervisorNodeId]), [["vm:3:100", "dev:3"], ["vm:3:200", "dev:5"]]);
});

// Il rovescio della prova sopra: due hypervisor autonomi col nome di fabbrica («pve»), uno letto a metà (nessun host
// nella sua lettura). L'abbinamento per nome trovato nell'altra lettura NON vale: la lettura del secondo ha un nodo
// solo, quindi è il suo, e le sue VM restano dell'apparato scansionato come prima.
test("due hypervisor autonomi con lo stesso nome di nodo: la lettura senza host tiene le VM all'apparato letto", () => {
  const i = cluster({
    devices: [...cluster().devices, dev(6, { name: "pve-z", device_type: "server", vendor: "proxmox", host: "192.0.2.61", port_count: 0 })],
    scanHosts: [{ scannedDeviceId: 3, hostname: "pve", ips: ["192.0.2.11"], macs: [] }],
    vms: [
      vm(100, "pve", { scannedDeviceId: 3, macs: ["02:00:00:aa:00:01"] }),
      vm(100, "pve", { scannedDeviceId: 6, macs: ["02:00:00:aa:00:06"] }),
      vm(101, "pve", { scannedDeviceId: 6, macs: ["02:00:00:aa:00:07"] }),
    ],
  });
  const { vms } = placeVms(i, buildNodeIndex(i.devices, i.hosts, i.knownMacs, i.neighbors));
  assert.deepEqual(vms.map((v) => [v.id, v.hypervisorNodeId]).sort(), [["vm:3:100", "dev:3"], ["vm:6:100", "dev:6"], ["vm:6:101", "dev:6"]]);
});
