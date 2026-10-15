import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addableLinked,
  connectRefusal,
  edgeMenuItems,
  findManualOverride,
  nodeMenuItems,
  primaryTarget,
  refreshVmDeviceIds,
  vmMenuItems,
  type NodeMenuCtx,
} from "@/lib/topology/map-menus";
import { LINK_ATTRS_DEFAULT, type LinkSource, type MapLink, type MapNode, type MapVm, type TopologyModel } from "@/lib/topology/model-types";
import type { TreeResult } from "@/lib/topology/tree";

function node(id: string, type: string, over: Partial<MapNode> = {}): MapNode {
  const [k, n] = id.split(":");
  return {
    id, kind: k === "dev" ? "device" : "host", refId: Number(n), name: `N${n}`, type, mgmtIp: null,
    fusedHostIds: [], addresses: [], aliases: [], siteId: null, rackId: null, siteProposed: false, hidden: false, vendor: null, ...over,
  };
}
function link(a: string, b: string, source: LinkSource = "lldp", over: Partial<MapLink> = {}): MapLink {
  return {
    id: `link:${a}|${b}`, a, aPort: "Port 1", b, bPort: "eth0", source, sources: [source], uplinkFrom: null,
    lastSeen: null, daysUnseen: null, stale: false, ...LINK_ATTRS_DEFAULT, ...over,
  };
}
function model(nodes: MapNode[], links: MapLink[], over: Partial<TopologyModel> = {}): TopologyModel {
  return {
    nodes, links, sites: [], promote: [], unmatched: [], isolated: [], suspicious: [], withoutSite: [],
    counts: {} as TopologyModel["counts"], portClients: [], clientCount: {}, canonical: {}, vms: [], ...over,
  };
}
const ctx = (over: Partial<NodeMenuCtx> = {}): NodeMenuCtx => ({
  mode: "passo", isAdmin: true, canEditMap: true, inMap: true, isHead: false, isStart: false, isDevice: true, hidden: false,
  isHypervisor: false, vmCount: 0, expanded: false, canRefreshVms: false, infraHost: false, addableCount: 0, isUncensusedVm: false, ...over,
});
const keys = (xs: Array<{ key: string }>) => xs.map((x) => x.key);

test("menu dell'oggetto, passo passo, admin: le voci della spec §11.2 nell'ordine, solo quelle che hanno senso", () => {
  assert.deepEqual(keys(nodeMenuItems(ctx())), ["details", "connect", "start", "remove", "hide"]);
  assert.deepEqual(
    keys(nodeMenuItems(ctx({ isHypervisor: true, vmCount: 4, canRefreshVms: true, addableCount: 2 }))),
    ["details", "toggleVms", "refreshVms", "connect", "addLinked", "start", "remove", "hide"],
  );
  // Un host che è infrastruttura: niente «Nascondi» (solo apparati), sì «Promuovi».
  assert.deepEqual(keys(nodeMenuItems(ctx({ isDevice: false, infraHost: true }))), ["details", "connect", "start", "remove", "promote"]);
});

test("menu dell'oggetto, tutto automatico: testa invece di partenza, niente voci della mappa passo passo", () => {
  assert.deepEqual(keys(nodeMenuItems(ctx({ mode: "auto", canEditMap: false, addableCount: 3 }))), ["details", "connect", "head", "hide"]);
  const head = nodeMenuItems(ctx({ mode: "auto", canEditMap: false, isHead: true })).find((x) => x.key === "head")!;
  assert.equal(head.label, "● è la testa");
  assert.equal(head.disabled, true);
});

test("menu dell'oggetto per chi non è admin: solo Dettagli e Mostra VM (non scrivono)", () => {
  assert.deepEqual(keys(nodeMenuItems(ctx({ isAdmin: false, canEditMap: false }))), ["details"]);
  assert.deepEqual(
    keys(nodeMenuItems(ctx({ isAdmin: false, canEditMap: false, isHypervisor: true, vmCount: 2, canRefreshVms: true }))),
    ["details", "toggleVms"],
  );
});

test("le etichette dicono lo stato: VM mostrate, partenza già scelta, oggetto nascosto", () => {
  const items = nodeMenuItems(ctx({ isHypervisor: true, vmCount: 3, expanded: true, isStart: true, hidden: true }));
  assert.equal(items.find((x) => x.key === "toggleVms")!.label, "Nascondi VM");
  assert.equal(nodeMenuItems(ctx({ isHypervisor: true, vmCount: 3 })).find((x) => x.key === "toggleVms")!.label, "Mostra VM (3)");
  const start = items.find((x) => x.key === "start")!;
  assert.equal(start.label, "▶ è una partenza");
  assert.equal(start.disabled, true);
  assert.equal(items.find((x) => x.key === "hide")!.label, "Rimostra in tutte le mappe");
  // Un oggetto non ancora nella mappa (dall'elenco) non ha «Togli» né «Usa come partenza».
  assert.deepEqual(keys(nodeMenuItems(ctx({ inMap: false }))), ["details", "connect", "hide"]);
});

test("menu della linea: a mano → Modifica porte e Rimuovi; automatica → Ignora; principale scelto → Togli la scelta", () => {
  assert.deepEqual(keys(edgeMenuItems(link("dev:1", "dev:2"), true)), ["primary", "ignore"]);
  assert.deepEqual(
    keys(edgeMenuItems(link("dev:1", "dev:2", "manual", { manual: { confirmed: false } }), true)),
    ["editPorts", "primary", "remove"],
  );
  const user = edgeMenuItems(link("dev:1", "dev:2", "lldp", { primary: "user", primaryFor: "dev:2" }), true);
  assert.deepEqual(keys(user), ["unprimary", "ignore"]);
  assert.equal(edgeMenuItems(link("dev:1", "dev:2", "lldp", { primary: "auto" }), true)[0].label, "★ Fissa come principale");
  assert.equal(edgeMenuItems(link("dev:1", "dev:2", "lldp", { redundant: true }), true)[0].label, "★ Rendi principale");
  assert.deepEqual(edgeMenuItems(link("dev:1", "dev:2"), false), []);
});

test("Rendi principale vale per il nodo più in basso nell'albero, con le sue porte prima", () => {
  const tree: TreeResult = {
    roots: ["dev:1"],
    children: new Map([["dev:1", ["dev:2", "dev:3"]], ["dev:2", ["dev:9"]], ["dev:3", []], ["dev:9", []]]),
    via: new Map(),
    links: [],
  };
  // Ridondanza: hypervisor dev:9 appeso a dev:2, secondo collegamento verso dev:3.
  const l = link("dev:3", "dev:9", "mac_table", { aPort: "Port 7", bPort: "eno2", redundant: true });
  assert.deepEqual(primaryTarget(l, tree), { node_id: "dev:9", other_node: "dev:3", node_port: "eno2", other_port: "Port 7" });
  // Con la scelta già fatta, vale per il suo nodo anche se l'albero è cambiato.
  const chosen = link("dev:9", "dev:3", "mac_table", { aPort: "eno2", bPort: "Port 7", primary: "user", primaryFor: "dev:9" });
  assert.equal(primaryTarget(chosen, tree).node_id, "dev:9");
  // Fuori dall'albero (stessa profondità o assenti): il secondo capo, deterministico.
  assert.equal(primaryTarget(link("dev:2", "dev:3"), tree).node_id, "dev:3");
});

test("la correzione a mano di una linea si trova per coppia di nodi, anche attraverso gli id canonici; vince la più recente", () => {
  const rows = [
    { id: 4, action: "add" as const, a_node: "host:7", a_port: "Port 3", b_node: "dev:1", b_port: "", medium: null },
    { id: 9, action: "ignore" as const, a_node: "dev:1", a_port: "", b_node: "dev:3", b_port: "", medium: null },
    { id: 11, action: "add" as const, a_node: "dev:1", a_port: "Port 4", b_node: "dev:3", b_port: "eno1", medium: "fibra" },
  ];
  const canonical = { "host:7": "dev:3" };
  assert.equal(findManualOverride(rows, link("dev:3", "dev:1", "manual"), canonical)?.id, 11);
  assert.equal(findManualOverride(rows, link("dev:1", "dev:5", "manual"), canonical), null);
});

test("Aggiungi collegati: i collegati non ancora nella mappa, niente client; gli apparati spuntati, gli host no", () => {
  const m = model(
    [node("dev:1", "switch"), node("dev:2", "switch"), node("host:5", "server"), node("host:6", "workstation"), node("dev:3", "access_point")],
    [link("dev:1", "dev:2"), link("dev:1", "host:5", "mac_table"), link("dev:1", "host:6", "mac_table"), link("dev:3", "dev:1")],
  );
  const out = addableLinked(m, "dev:1", new Set(["dev:1", "dev:3"]));
  assert.deepEqual(out, [
    { id: "dev:2", name: "N2", type: "switch", checked: true },
    { id: "host:5", name: "N5", type: "server", checked: false },
  ]);
});

test("Aggiorna VM: gli apparati che hanno letto le VM di quell'hypervisor; senza VM, l'apparato stesso", () => {
  const vm = (id: string, hyper: string | null): MapVm => ({ id, name: id, status: "running", ips: [], hypervisorNodeId: hyper, nodeId: null, scannedAt: null });
  const vms = [vm("vm:12:100", "dev:4"), vm("vm:12:101", "dev:4"), vm("vm:15:102", "dev:4"), vm("vm:12:103", "dev:5")];
  assert.deepEqual(refreshVmDeviceIds(vms, "dev:4"), [12, 15]);
  assert.deepEqual(refreshVmDeviceIds([], "dev:8"), [8]);
  assert.deepEqual(refreshVmDeviceIds([], "host:8"), []);
});

test("menu della VM: Aggiungi alla mappa solo passo passo con la mappa modificabile; già dentro lo dice", () => {
  assert.deepEqual(vmMenuItems({ canEditMap: true, inMap: false }), [
    { key: "add", label: "Aggiungi alla mappa" },
    { key: "details", label: "Dettagli" },
  ]);
  assert.deepEqual(vmMenuItems({ canEditMap: true, inMap: true })[0], { key: "add", label: "✓ nella mappa", disabled: true });
  assert.deepEqual(vmMenuItems({ canEditMap: false, inMap: false }), [{ key: "details", label: "Dettagli" }]);
});

// Revisione finale I-1: una VM non censita (vm:N:M) è un nodo della pagina, non del modello: un collegamento a
// mano o un principale verso di lei si salverebbe senza mai comparire. Il menu non li propone.
test("I-1: su una VM non censita niente «Collega a…»; una linea con una VM non propone il principale", () => {
  const vm = nodeMenuItems(ctx({ isDevice: false, isUncensusedVm: true }));
  assert.ok(!keys(vm).includes("connect"), "niente «Collega a…» su una VM non censita");
  assert.deepEqual(keys(vm), ["details", "start", "remove"]);
  assert.deepEqual(keys(edgeMenuItems(link("dev:1", "vm:3:100"), true)), ["ignore"]);
  assert.deepEqual(keys(edgeMenuItems(link("vm:3:100", "dev:1", "lldp", { primary: "user" }), true)), ["ignore"]);
  // Il clic sull'oggetto di arrivo (o il pallino) verso una VM si rifiuta in parole; fra apparati e host no.
  assert.match(connectRefusal("dev:1", "vm:3:100") ?? "", /VM non censita/);
  assert.match(connectRefusal("vm:3:100", "host:2") ?? "", /VM non censita/);
  assert.equal(connectRefusal("dev:1", "host:2"), null);
});

test("§13.9: la voce della linea dice che si ignora un cavo, non la coppia", () => {
  assert.equal(edgeMenuItems(link("dev:1", "dev:2"), true).find((x) => x.key === "ignore")!.label, "Ignora questo cavo…");
});
