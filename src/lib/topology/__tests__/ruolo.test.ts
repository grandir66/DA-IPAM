// Spec topologia §13.8.2 (D6) e prova I28. Vincolo 7 di Riccardo (14/10): sull'hub 19 PC e server (16 Windows e 3 Linux,
// spec §13.1 punto 12) registrati come «switch» per l'inventario, sei nell'albero; host classificati router su prove deboli (un telefono,
// un notebook) anche. Ora un oggetto fa da switch, router o AP solo con una prova sua. Dati inventati con la forma vera.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROVE_AGGIUNTE, classeInMappa, proveDiRuolo } from "@/lib/topology/cavi/ruolo";
import { motivoDaSistemare } from "@/lib/topology/da-sistemare";
import { buildTopologyModel } from "@/lib/topology/model";
import { buildNodeIndex } from "@/lib/topology/node-index";
import { autoVisible, buildTree } from "@/lib/topology/tree";
import { computeMapView } from "@/lib/topology/map-compute";
import type { TopologyModelInput } from "@/lib/topology/model-types";
import { baseInput, dev, host } from "./support/righe";
import { padriCambiati, padriDi } from "@/lib/topology/misura";

const ORA = "2026-10-13 11:00:00";
const prove = (i: TopologyModelInput, id: string) =>
  proveDiRuolo(i, buildNodeIndex(i.devices, i.hosts, i.knownMacs, i.neighbors)).get(id) ?? [];

test("le prove, una per una (D6 e le sei aggiunte del 14/10 sera; il ruolo a mano)", () => {
  const i = baseInput({
    devices: [
      dev(1, { name: "RTR-1", device_type: "router", vendor: "mikrotik", via: "ssh" }),
      dev(2, { name: "SW-2", controller_mac: "02:00:00:00:00:02", uplink_mac: "02:00:00:00:00:03" }),
      dev(3, { name: "SW-3", controller_mac: "02:00:00:00:00:03" }),
      dev(4, { name: "SW-4", topology_role: "rete" }),
      dev(5, { name: "SW-5" }),
      dev(6, { name: "RTR-6", device_type: "router" }),
    ],
    neighbors: [{ device_id: 1, local_port: "ether2", remote_device_name: "RTR-6", remote_port: "ether1", protocol: "mndp", remote_ip: "10.0.0.6", remote_mac: null, timestamp: ORA, source: "device" }],
    uplinkPorts: [{ device_id: 2, port_index: 25, port_name: "SFP+ 1" }],
    ports: [{ device_id: 5, port_index: 1, port_name: "Port 1", speed: null, status: "up", stp_state: "forwarding" }],
    macPorts: [{ device_id: 1, mac: "02:00:00:00:00:02", port_name: "ether3", timestamp: ORA, source: "device" }],
  });
  assert.deepEqual(prove(i, "dev:1"), ["mac_dietro", "vicini"]);      // legge vicini; dietro una sua porta c'è SW-2
  assert.deepEqual(prove(i, "dev:2"), ["controller", "uplink"]);      // gestito dal controller, con la sua porta di uplink
  assert.deepEqual(prove(i, "dev:3"), ["controller", "padre_di"]);    // SW-2 esce verso di lui
  assert.deepEqual(prove(i, "dev:4"), ["a_mano"]);                     // «Ruolo nella mappa → Apparato di rete»
  assert.deepEqual(prove(i, "dev:5"), ["spanning_tree"]);             // una porta con lo stato dello spanning tree
  assert.deepEqual(prove(i, "dev:6"), ["annuncio"]);                  // si annuncia come apparato (MNDP o CDP)
  assert.equal(PROVE_AGGIUNTE.has("annuncio"), true);
  assert.equal(PROVE_AGGIUNTE.has("vicini"), false);
});

test("VM ospitate e capi di un salto radio sono prove (il salto radio arriva in T3: qui come parametro)", () => {
  const i = baseInput({ devices: [dev(7, { name: "RADIO-7", device_type: "access_point" })] });
  const idx = buildNodeIndex(i.devices, i.hosts, i.knownMacs, i.neighbors);
  const vm = { id: "vm:9:100", name: "vm", status: "running", ips: [], hypervisorNodeId: "dev:9", nodeId: null, scannedAt: null };
  const p = proveDiRuolo(i, idx, { vms: [vm], capiRadio: new Set(["dev:7"]) });
  assert.deepEqual([p.get("dev:9"), p.get("dev:7")], [["vm"], ["radio"]]);
});

test("I28 — non sono prove: il tipo dichiarato, la classificazione, essere visto via LLDP da uno switch o nella tabella MAC di altri", () => {
  const PC = "02:00:00:00:00:31";
  const i = baseInput({
    devices: [dev(2, { name: "SW-2", via: "api" }), dev(31, { name: "PC-31", device_type: "switch", vendor: "windows", host: "10.0.0.31" })],
    hosts: [host(40, { ip: "10.0.1.40", hostname: "TELEFONO-40", classification: "router" })],
    knownMacs: [{ device_id: 31, mac: PC }],
    neighbors: [{ device_id: 2, local_port: "Port 7", remote_device_name: "PC-31", remote_port: "eth0", protocol: "lldp", remote_ip: null, remote_mac: PC, timestamp: ORA, source: "unifi" }],
    macPorts: [{ device_id: 2, mac: PC, port_name: "Port 7", timestamp: ORA, source: "device" }],
  });
  assert.deepEqual(prove(i, "dev:31"), []);
  assert.deepEqual(prove(i, "host:40"), []);
  const m = buildTopologyModel(i);
  assert.deepEqual(m.daSistemare?.map((d) => d.id), ["dev:31"]);
  assert.equal(m.classiMappa?.["dev:31"], "da_sistemare");
  assert.deepEqual([...autoVisible(m)].sort(), ["dev:2"], "fuori dalla mappa automatica");
});

test("classeInMappa: «infra» e «ap» solo con una prova; il ruolo a mano decide prima di tutto; gli altri come nodeClass", () => {
  const sw = { type: "switch", vendor: null };
  assert.equal(classeInMappa(sw, [], null), "da_sistemare");
  assert.equal(classeInMappa(sw, ["vicini"], null), "infra");
  assert.equal(classeInMappa({ type: "access_point", vendor: null }, undefined, null), "da_sistemare");
  assert.equal(classeInMappa(sw, [], "rete"), "infra");
  assert.equal(classeInMappa(sw, ["vicini"], "attaccato"), "att");
  assert.equal(classeInMappa({ type: "server", vendor: null }, [], null), "att");
  assert.equal(classeInMappa({ type: "workstation", vendor: null }, [], null), "client");
});

test("H4b — un host che la classificazione dice router, senza prove, è «da sistemare» col motivo; un apparato col suo", () => {
  assert.equal(motivoDaSistemare({ kind: "device", type: "switch" }),
    "dichiarato switch, ma nessuna prova che lo sia: non vede vicini (LLDP, CDP, MNDP), nessuna porta con spanning tree, nessun apparato dietro le sue porte. Se lo è: Ruolo nella mappa → Apparato di rete");
  assert.match(motivoDaSistemare({ kind: "host", type: "router" }), /^la classificazione automatica lo dice router, ma nessuna prova che lo sia: .* prima Promuovi ad apparato/);
});

test("«Da sistemare» si comporta come un client: conta come client sulla porta, i MAC dietro di lui non lo rendono di passaggio", () => {
  const PC = "02:00:00:00:00:31", DIETRO = "02:00:00:00:00:41";
  const i = baseInput({
    devices: [dev(1, { name: "RTR-1", device_type: "router" }), dev(2, { name: "SW-2", via: "api", uplink_mac: "02:00:00:00:00:01" }), dev(31, { name: "PC-31", device_type: "switch", vendor: "windows", host: "10.0.0.31" })],
    knownMacs: [{ device_id: 1, mac: "02:00:00:00:00:01" }, { device_id: 31, mac: PC }],
    hosts: [host(41, { ip: "10.0.1.41", mac: DIETRO, hostname: "STAMPANTE-41", classification: "printer" })],
    macPorts: [
      { device_id: 2, mac: PC, port_name: "Port 7", timestamp: ORA, source: "device" },
      { device_id: 31, mac: DIETRO, port_name: "Port 1", timestamp: ORA, source: "device" },
    ],
  });
  const m = buildTopologyModel(i);
  assert.equal(m.links.some((l) => l.a === "dev:31" || l.b === "dev:31"), false, "nessuna linea «tabella MAC» verso il PC");
  assert.deepEqual(m.portClients.map((p) => [p.nodeId, p.port, p.clients.map((c) => c.nodeId)]), [["dev:2", "Port 7", ["dev:31"]]]);
});

test("R2 — in una mappa passo passo «da sistemare» resta, come foglia: non fa da ponte verso chi sta dietro", () => {
  const add = (id: number, a: string, b: string) => ({ id, action: "add" as const, a_node: a, a_port: "", b_node: b, b_port: "", medium: null });
  const i = baseInput({
    devices: [dev(1, { name: "RTR-1", device_type: "router", topology_role: "rete" }), dev(31, { name: "PC-31", vendor: "windows" }), dev(5, { name: "SW-5", topology_role: "rete" })],
    overrides: [add(1, "dev:1", "dev:31"), add(2, "dev:31", "dev:5")],
  });
  const t = buildTree(buildTopologyModel(i), new Set(["dev:1", "dev:31", "dev:5"]), ["dev:1"]);
  assert.deepEqual([t.children.get("dev:1"), t.children.get("dev:31"), t.roots], [["dev:31"], [], ["dev:1", "dev:5"]]);
});

// Review Focus 6 (revisione del piano, 15/10): un oggetto senza prove che oggi ha un figlio. Esce dall'albero; il figlio
// non resta appeso a lui: va per un'altra via o diventa radice, e la misura lo conta fra i padri cambiati.
test("Review Focus 6 — chi va in «Da sistemare» non si porta dietro i figli: il figlio diventa radice, e si conta", () => {
  const i = baseInput({
    devices: [
      dev(1, { name: "RTR-1", device_type: "router", vendor: "mikrotik", via: "ssh" }),
      dev(31, { name: "PC-31", vendor: "windows" }),
      dev(5, { name: "SW-5", via: "api", controller_mac: "02:00:00:00:00:05" }),
    ],
    neighbors: [
      { device_id: 1, local_port: "ether5", remote_device_name: "PC-31", remote_port: "eth0", protocol: "lldp", remote_ip: "10.0.0.31", remote_mac: null, timestamp: ORA, source: "device" },
      { device_id: 5, local_port: "Port 1", remote_device_name: "PC-31", remote_port: "eth0", protocol: "lldp", remote_ip: "10.0.0.31", remote_mac: null, timestamp: ORA, source: "unifi" },
    ],
  });
  const m = buildTopologyModel(i);
  assert.equal(m.classiMappa?.["dev:31"], "da_sistemare");
  const dopo = buildTree(m, autoVisible(m), ["dev:1"]);
  const comeT1 = { ...m, classiMappa: {}, daSistemare: [] };
  const prima = buildTree(comeT1, autoVisible(comeT1), ["dev:1"]);
  assert.deepEqual(padriCambiati(padriDi(prima), padriDi(dopo)), [
    { id: "dev:31", prima: "dev:1", dopo: undefined }, { id: "dev:5", prima: "dev:31", dopo: null },
  ]);
});

// Review Focus 7: un `topology_role` scritto da una versione successiva («core» e «accesso» di T3, spec §13.9), e poi si è
// tornati a T1b. «Core» e «accesso» sono ruoli di rete; un valore sconosciuto non rompe niente: decide il sistema.
test("Review Focus 7 — un ruolo a mano che T1b non conosce: «core» e «accesso» valgono apparato di rete; un altro valore, decide il sistema", () => {
  const i = baseInput({ devices: [dev(4, { topology_role: "core" }), dev(6, { topology_role: "accesso" }), dev(7, { topology_role: "boh" })] });
  assert.deepEqual([prove(i, "dev:4"), prove(i, "dev:6"), prove(i, "dev:7")], [["a_mano"], ["a_mano"], []]);
  assert.deepEqual(buildTopologyModel(i).daSistemare?.map((d) => d.id), ["dev:7"]);
});

// ─── Passaggio universale (spec §13.16) per T1b ───

// I64 (spec §13.8.2, G10; H14, C16). Rete B: cinque oggetti di rete senza collegamenti (due switch di laboratorio che si
// annunciano via MNDP, uno switch che non risponde, un notebook e un telefono classificati router) erano radici sole della
// mappa automatica: «Da sistemare» prendeva solo apparati, attaccati e hypervisor. Cliente A: la radio lontana a 60 GHz.
test("I64 — nessuna radice sola: un host di rete con una prova di ruolo e nessun collegamento va in «Da sistemare», «nessun collegamento»", () => {
  const i = baseInput({
    devices: [dev(1, { name: "RTR-1", device_type: "router", vendor: "mikrotik", via: "ssh", host: "10.0.0.1" }), dev(2, { name: "SW-2", host: "10.0.0.2", controller_mac: "02:00:00:00:00:02" })],
    hosts: [host(40, { ip: "10.0.1.40", mac: "02:00:00:00:00:40", hostname: "LAB-SW-40", classification: "switch" })],
    neighbors: [
      { device_id: 1, local_port: "ether2", remote_device_name: "SW-2", remote_port: "Port 1", protocol: "lldp", remote_ip: "10.0.0.2", remote_mac: null, timestamp: ORA, source: "device" },
      // lo switch di laboratorio si annuncia (MNDP) su una VLAN del router: una prova di ruolo, nessun cavo
      { device_id: 1, local_port: "vlan40", remote_device_name: "LAB-SW-40", remote_port: "bridge", protocol: "mndp", remote_ip: "10.0.1.40", remote_mac: "02:00:00:00:00:40", timestamp: ORA, source: "device" },
    ],
  });
  const m = buildTopologyModel(i);
  assert.deepEqual(prove(i, "host:40"), ["annuncio"]);
  assert.deepEqual(m.isolated, ["host:40"]);
  assert.deepEqual([...autoVisible(m)].sort(), ["dev:1", "dev:2"], "fuori dalla mappa automatica: non è una seconda radice");
  // nessun oggetto perso dalle mappe passo passo: chi ce l'ha messo lo ritrova
  const passo = computeMapView(m, { auto: false, members: ["dev:1", "host:40"], roots: ["dev:1"], head: null, tweaks: [], expanded: new Set(), orientation: "lr" });
  assert.deepEqual([passo.missing, passo.visible.has("host:40")], [[], true]);
});

// I65 (spec §13.8.2, G10, G12). «Hypervisor» solo con una prova: ospita VM o è un hypervisor censito e letto (scansione Proxmox);
// la classificazione da sola no (rete B: un nodo «hypervisor» fatto di host fusi su un MAC). Lo stato dello spanning tree vale
// come prova solo se attivo: `disabled` vuol dire spanning tree spento, e su una porta giù ogni stato vale «giù».
test("I65 — «hypervisor» solo con una prova; `disabled`, o uno stato su una porta giù, non è una prova di spanning tree", () => {
  const i = baseInput({
    devices: [
      dev(60, { name: "SW-60" }), dev(61, { name: "SW-61" }), dev(62, { name: "SW-62" }),
      dev(63, { name: "HV-63", device_type: "server", vendor: "proxmox", proxmox_scan: 1 }),
    ],
    // due host fusi sullo stesso MAC, classificati hypervisor (la forma del caso della rete B, che ne ha diciotto)
    hosts: [50, 51].map((k) => host(k, { ip: `10.0.1.${k}`, mac: "02:00:00:00:00:50", hostname: "HV-FUSO", classification: "hypervisor" })),
    ports: [
      { device_id: 60, port_index: 1, port_name: "Port 1", speed: null, status: "up", stp_state: "disabled" },
      { device_id: 61, port_index: 1, port_name: "Port 1", speed: null, status: "down", stp_state: "forwarding" },
      { device_id: 62, port_index: 1, port_name: "Port 1", speed: null, status: "up", stp_state: "forwarding" },
    ],
  });
  assert.deepEqual([prove(i, "dev:60"), prove(i, "dev:61"), prove(i, "dev:62")], [[], [], ["spanning_tree"]]);
  assert.equal(classeInMappa({ type: "hypervisor" }, ["scansione"], null), "hyper", "un hypervisor censito e letto resta hypervisor");
  const m = buildTopologyModel(i);
  assert.deepEqual(m.daSistemare?.map((d) => d.id), ["dev:60", "dev:61"]);
  assert.equal(m.classiMappa?.["host:50"], "att", "classificato hypervisor, senza VM né scansione: un attaccato");
  assert.equal(m.classiMappa?.["dev:63"], undefined, "un hypervisor censito e letto resta hypervisor");
  assert.equal(classeInMappa({ type: "hypervisor" }, ["vm"], null), "hyper", "chi ospita VM è un hypervisor");
});
