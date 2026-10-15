// Le misure del capitolo 13 (spec topologia §13.12.1, pezzo T1.0): contano, non disegnano. Dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applicaScenario, chiaveMisura, giriEAttraversamenti, leggiScenario, lettureVm, lineeCucite, lineeDaNomeScelto, padriCambiati, padriDi,
  ramiControVerso, sottoUnaSuaVm, teste, testeCambiate, type LineaMisurata,
} from "@/lib/topology/misura";
import { buildTopologyModel } from "@/lib/topology/model";
import { LINK_ATTRS_DEFAULT, type MapLink } from "@/lib/topology/model-types";
import { baseInput, dev } from "./support/righe";

const L = (a: string, aPort: string, b: string, bPort: string, over: Partial<MapLink> = {}): MapLink => ({
  id: `link:${a}|${b}`, a, aPort, b, bPort, source: "lldp", sources: ["lldp"], uplinkFrom: null, lastSeen: null, daysUnseen: null,
  stale: false, ...LINK_ATTRS_DEFAULT, ...over,
});

test("chiaveMisura: la stessa porta scritta prima (grezza) e dopo (tradotta) dà la stessa chiave", () => {
  assert.equal(chiaveMisura("ether3,bridge"), chiaveMisura("ether3"));
  assert.equal(chiaveMisura("bridge/sfp-sfpplus1"), chiaveMisura("sfp-sfpplus1"));
  assert.equal(chiaveMisura("SFP_ 9"), chiaveMisura("SFP+ 9"));
  assert.notEqual(chiaveMisura("SFP 1"), chiaveMisura("SFP+ 1"));
});

test("C4, linee cucite: due porte piene che nessuna prova sola ha (incidente del 14/10, «porta 10 ↔ ether8»)", () => {
  const input = baseInput({
    devices: [dev(1, { name: "RTR-1", device_type: "router" }), dev(114, { name: "CORE-1", controller_mac: "02:00:00:00:01:14", uplink_mac: "02:00:00:00:00:01" })],
    knownMacs: [{ device_id: 1, mac: "02:00:00:00:00:01" }],
    uplinkPorts: [{ device_id: 114, port_index: 10, port_name: "Port 10" }],
    neighbors: [
      { device_id: 1, local_port: "ether8", remote_device_name: "CORE-1", remote_port: "Port 15", protocol: "lldp", remote_ip: null, remote_mac: "02:00:00:00:01:14", timestamp: "2026-10-13 11:00:00", source: "device" },
      { device_id: 1, local_port: "sfp-sfpplus1,bridge", remote_device_name: "CORE-1", remote_port: "Port 10", protocol: "lldp", remote_ip: null, remote_mac: "02:00:00:00:01:14", timestamp: "2026-10-13 11:00:00", source: "device" },
    ],
  });
  const cucita = L("dev:114", "Port 10", "dev:1", "ether8");      // la porta del figlio dall'uplink, quella del padre dalla prima riga
  const buona = L("dev:114", "Port 10", "dev:1", "sfp-sfpplus1"); // le due porte della stessa riga del router
  const mezza = L("dev:114", "Port 10", "dev:1", "");
  assert.deepEqual(lineeCucite(input, { links: [cucita, buona, mezza], canonical: {} }).map((l) => l.bPort), ["ether8"]);
});

// Rete-campione della famiglia 4 (15/10): la scheda di un hypervisor si annuncia con l'LLDP del firmware, senza nome; il modello la
// abbina col MAC della scansione delle VM, e la misura deve fare lo stesso, altrimenti la linea vera risulta «cucita».
test("C4 — una riga abbinata col MAC della scansione dell'hypervisor è una prova come le altre", () => {
  const NIC = "02:00:00:00:41:a1";
  const input = baseInput({
    devices: [dev(2, { name: "CORE" }), dev(41, { name: "pve-1", device_type: "server", vendor: "proxmox", proxmox_scan: 1, port_count: 0 })],
    neighbors: [{ device_id: 2, local_port: "Port 3", remote_device_name: "", remote_port: NIC, protocol: "lldp", remote_ip: null, remote_mac: NIC, timestamp: "2026-10-13 11:00:00", source: "unifi" }],
    scanHosts: [{ scannedDeviceId: 41, hostname: "pve-1", ips: [], macs: [NIC] }],
  });
  assert.deepEqual(lineeCucite(input, { links: [L("dev:2", "Port 3", "dev:41", NIC)], canonical: {} }), []);
});

// C2 (spec §13.3.2) conta solo gli uplink del CONTROLLER: anche una linea «tabella MAC» o «dalle VM» ha `uplinkFrom`, ma con
// un altro senso (revisione del piano, 15/10: sull'hub il «prima» contava 1 per una linea «tabella MAC»).
test("C2, rami contro il verso: il padre è il figlio secondo l'uplink del controller; le altre fonti non contano", () => {
  const verso = L("dev:112", "Port 47", "dev:114", "Port 9", { uplinkFrom: "dev:112", source: "unifi_uplink", sources: ["unifi_uplink", "lldp"] });
  const tree = { roots: ["dev:1"], children: new Map([["dev:1", ["dev:112"]], ["dev:112", ["dev:114"]], ["dev:114", []]]), via: new Map([["dev:114", verso]]) };
  assert.equal(ramiControVerso(tree), 1);
  const giusto = { ...tree, children: new Map([["dev:1", ["dev:114"]], ["dev:114", ["dev:112"]], ["dev:112", []]]), via: new Map([["dev:112", verso]]) };
  assert.equal(ramiControVerso(giusto), 0);
  const tabellaMac = { ...tree, via: new Map([["dev:114", { ...verso, source: "mac_table" as const, sources: ["mac_table" as const] }]]) };
  assert.equal(ramiControVerso(tabellaMac), 0);
});

test("padri e padri cambiati (chi entra o esce dall'albero ha undefined dall'altra parte)", () => {
  const p = padriDi({ roots: ["dev:1"], children: new Map([["dev:1", ["dev:114"]], ["dev:114", ["dev:112"]], ["dev:112", []]]) });
  assert.deepEqual(p, { "dev:1": null, "dev:112": "dev:114", "dev:114": "dev:1" });
  assert.deepEqual(padriCambiati({ "dev:1": null, "dev:112": "dev:1", "host:9": "dev:1" }, p), [
    { id: "dev:112", prima: "dev:1", dopo: "dev:114" }, { id: "dev:114", prima: undefined, dopo: "dev:1" }, { id: "host:9", prima: "dev:1", dopo: undefined },
  ]);
});

test("C10 e C11: una linea che fa il giro; una che attraversa un riquadro quando un candidato non lo fa", () => {
  const s = { x: 0, y: 0, w: 200, h: 44 }, t = { x: 0, y: 100, w: 200, h: 44 };
  const giro: LineaMisurata = { a: s, la: "dx", b: t, lb: "sx", punti: [{ x: 200, y: 22 }, { x: 220, y: 22 }, { x: 220, y: 122 }, { x: 0, y: 122 }], tra: ["dev:1", "dev:2"] };
  const ostacolo = { x: 80, y: 50, w: 40, h: 30 };
  assert.deepEqual(giriEAttraversamenti([giro], () => [ostacolo], "lr"), { giri: 1, attraversamenti: 0 });
  const dritta: LineaMisurata = { a: s, la: "giu", b: t, lb: "su", punti: [{ x: 100, y: 44 }, { x: 100, y: 100 }], tra: ["dev:1", "dev:2"] };
  // Attraversa il riquadro in mezzo, ma la «Z» fra gli stessi lati… passa sullo stesso tratto: nessun candidato pulito.
  assert.deepEqual(giriEAttraversamenti([dritta], () => [ostacolo], "lr"), { giri: 0, attraversamenti: 0 });
  const lontani: LineaMisurata = { a: s, la: "dx", b: { x: 400, y: 300, w: 200, h: 44 }, lb: "sx",
    punti: [{ x: 200, y: 22 }, { x: 300, y: 22 }, { x: 300, y: 322 }, { x: 400, y: 322 }], tra: ["dev:1", "dev:3"] };
  assert.deepEqual(giriEAttraversamenti([lontani], () => [{ x: 280, y: 150, w: 40, h: 40 }], "lr"), { giri: 0, attraversamenti: 1 });
});

test("scenari: S1 senza correzioni; S3 senza l'uplink di un apparato; S4 lldp su tutte le righe fra router; S9 un vicino di ieri", () => {
  const input = baseInput({
    devices: [dev(1, { name: "RTR-1", device_type: "router" }), dev(2, { name: "RTR-2", device_type: "router" }), dev(114, { uplink_mac: "02:00:00:00:00:01" })],
    uplinkPorts: [{ device_id: 114, port_index: 10, port_name: "Port 10" }],
    overrides: [{ id: 1, action: "ignore", a_node: "dev:114", a_port: "Port 10", b_node: "dev:1", b_port: "ether8", medium: null }],
    neighbors: [
      { device_id: 1, local_port: "ether3", remote_device_name: "RTR-2", remote_port: "ether3", protocol: "mndp", remote_ip: "10.0.0.2", remote_mac: null, timestamp: "2026-10-13 11:00:00", source: "device" },
      { device_id: 1, local_port: "ether1", remote_device_name: "SW-114", remote_port: "Port 1", protocol: "mndp", remote_ip: null, remote_mac: null, timestamp: "2026-10-13 11:00:00", source: "device" },
    ],
  });
  assert.deepEqual(applicaScenario(input, { nome: "S1" }).overrides, []);
  const s3 = applicaScenario(input, { nome: "S3", apparato: 114 });
  assert.deepEqual([s3.devices.find((d) => d.id === 114)?.uplink_mac, s3.uplinkPorts], [null, []]);
  assert.deepEqual(applicaScenario(input, { nome: "S4" }).neighbors.map((n) => n.protocol), ["lldp", "mndp"]);
  const s9 = applicaScenario(input, { nome: "S9", apparato: 114, porta: "Port 10", fonte: "unifi" });
  const vecchia = s9.neighbors[s9.neighbors.length - 1];
  assert.deepEqual([vecchia.device_id, vecchia.local_port, vecchia.source, vecchia.timestamp], [114, "Port 10", "unifi", "2026-10-10 12:00:00"]);
  assert.deepEqual(leggiScenario("S9:114:Port 10:unifi"), { nome: "S9", apparato: 114, porta: "Port 10", fonte: "unifi" });
  assert.deepEqual(leggiScenario("S3:114"), { nome: "S3", apparato: 114 });
  assert.equal(leggiScenario("S7"), null);
});

// ─── Passaggio universale (spec §13.16): le misure che i criteri nuovi chiedono, sui due casi reali e su ogni rete ───

// C19 e H17: la testa proposta (quando nessuno l'ha scelta) e la testa di ogni sede, prima e dopo ogni regola.
test("teste: la proposta della mappa automatica e quella di ogni sede; testeCambiate dice dove cambiano", () => {
  const m = buildTopologyModel(baseInput({
    devices: [dev(1, { name: "RTR-1", device_type: "router", location_id: 7 }), dev(2, { name: "SW-2", location_id: 7 })],
    locations: [{ id: 7, name: "Sede 7", parent_id: null, head_device_id: null }],
    networks: [{ id: 1, cidr: "10.0.0.0/24", name: "lan", gateway: "10.0.0.1", location_id: 7 }],
    // il router legge i suoi vicini (la prova di ruolo che il dato vero ha: da T1b un router senza prove non fa la testa)
    neighbors: [{ device_id: 1, local_port: "ether2", remote_device_name: "SW-2", remote_port: "Port 1", protocol: "lldp", remote_ip: "10.0.0.2", remote_mac: null, timestamp: "2026-10-13 11:00:00", source: "device" }],
  }));
  const t = teste(m);
  assert.deepEqual(t, { proposta: "dev:1", sedi: { "7": "dev:1" } });
  assert.deepEqual(testeCambiate(t, { proposta: "dev:2", sedi: { "7": "dev:1", "8": null } }), [
    { dove: "mappa automatica", prima: "dev:1", dopo: "dev:2" }, { dove: "sede 8", prima: undefined, dopo: null },
  ]);
});

// R1 (spec §13.3.4): la misura dice su quale lettura delle VM è fatta. Dal 15/10 l'hub rilegge le VM ogni notte, e una VM
// spenta o spostata cambia i collegamenti «dalle VM»: «prima» e «dopo» si misurano sulla stessa copia.
test("R1 — lettureVm: per ogni apparato scansionato, la lettura delle VM più recente (anche dagli host del cluster)", () => {
  const vm = (scannedDeviceId: number, vmid: number, scannedAt: string | null) => ({
    scannedDeviceId, vmid, name: `vm-${vmid}`, node: "pve-a", status: "running", type: "qemu", macs: [], ips: [], scannedAt,
  });
  const i = baseInput({
    vms: [vm(4, 100, "2026-04-27 09:00:00"), vm(4, 101, "2026-04-27T09:05:00.000Z"), vm(5, 200, null)],
    scanHosts: [{ scannedDeviceId: 4, hostname: "pve-a", ips: [], macs: [], scannedAt: "2026-10-15 03:00:00" }],
  });
  assert.deepEqual(lettureVm(i), { "dev:4": "2026-10-15 03:00:00", "dev:5": null });
});

// H15, I62 (spec §13.7.8): nessun oggetto sotto una sua VM. Rete B: l'hypervisor appeso alla scheda del firewall virtuale.
test("H15 — sottoUnaSuaVm: gli hypervisor il cui padre è una loro VM", () => {
  const vms = [{ id: "vm:4:120", name: "fw", status: "running", ips: [], hypervisorNodeId: "dev:4", nodeId: "dev:15", scannedAt: null }];
  assert.deepEqual(sottoUnaSuaVm({ vms }, { "dev:4": "dev:15", "dev:15": "dev:2" }), ["dev:4"]);
  assert.deepEqual(sottoUnaSuaVm({ vms }, { "dev:4": "dev:2", "dev:15": "dev:2" }), []);
});

// H7 (spec §13.3.3): nessuna linea di un router col traduttore del suo prodotto da un nome scelto dal cliente. Il conto vale sulle
// porte grezze di prima («VL_16_X», «ether3,bridge») e su quelle tradotte di dopo; le correzioni a mano non contano.
test("H7 — lineeDaNomeScelto: linee dei dati con un capo su un router col traduttore del suo prodotto e una porta che il traduttore non riconosce", () => {
  // dev:4 è un MikroTik letto via SNMP: passa dal traduttore generico, e la regola lo lascia stare (verifica del 15/10)
  const snmp = Object.assign(dev(4, { device_type: "router", vendor: "mikrotik" }), { via: "snmp_v2" });
  const i = baseInput({ devices: [dev(1, { name: "RTR-1", device_type: "router", vendor: "mikrotik" }), dev(2), dev(3, { device_type: "router", vendor: "cisco" }), snmp] });
  const l = (id: string, aPort: string, b: string, over: Partial<MapLink> = {}) => L("dev:1", aPort, b, "Port 1", { id, ...over });
  const linee = [
    l("a", "VL_16_X", "dev:2"), l("b", "ether3,bridge", "dev:2"), l("c", "sfp-sfpplus1", "dev:2"), l("d", "vlan10", "dev:2"),
    l("e", "PONTE-A", "dev:2", { source: "manual", sources: ["manual"] }), L("dev:3", "Gi1/0/5", "dev:2", "Port 2", { id: "f" }),
    L("dev:4", "VL_16_X", "dev:2", "Port 3", { id: "g" }),
  ];
  assert.deepEqual(lineeDaNomeScelto(i, { links: linee }).map((x) => x.id), ["a"]);
});

test("S12 — lettura delle VM rinnovata: la VM indicata spenta, al suo posto un'altra accesa con gli stessi MAC", () => {
  const vm = { scannedDeviceId: 4, vmid: 120, name: "fw", node: "pve-a", status: "running", type: "qemu", macs: ["02:00:00:00:12:01"], ips: [], scannedAt: "2026-04-27 09:00:00" };
  const s = applicaScenario(baseInput({ vms: [vm] }), { nome: "S12", apparato: 4, vmid: 120 });
  assert.deepEqual(s.vms.map((v) => [v.vmid, v.status, v.macs]), [[120, "stopped", ["02:00:00:00:12:01"]], [100120, "running", ["02:00:00:00:12:01"]]]);
  assert.equal(s.vms[1].scannedAt, "2026-10-13T12:00:00.000Z");
  assert.deepEqual(leggiScenario("S12:4:120"), { nome: "S12", apparato: 4, vmid: 120 });
  assert.equal(leggiScenario("S12:4"), null);
});
