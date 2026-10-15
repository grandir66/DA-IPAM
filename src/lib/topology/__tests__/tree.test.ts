import { test } from "node:test";
import assert from "node:assert/strict";
import { autoVisible, buildTree, chiaveScelta, missingNeighbors, proposeHead } from "@/lib/topology/tree";
import { LINK_ATTRS_DEFAULT, type LinkSource, MapLink, MapNode, SiteInfo, TopologyModel } from "@/lib/topology/model-types";

function node(id: string, type: string, over: Partial<MapNode> = {}): MapNode {
  const [k, n] = id.split(":");
  return {
    id, kind: k === "dev" ? "device" : "host", refId: Number(n), name: id, type, mgmtIp: null,
    fusedHostIds: [], addresses: [], aliases: [], siteId: null, rackId: null, siteProposed: false, hidden: false, vendor: null, ...over,
  };
}
function link(a: string, b: string, source: LinkSource = "lldp", stale = false): MapLink {
  return { id: `${a}~${b}~${source}`, a, aPort: "p", b, bPort: "p", source, sources: [source], uplinkFrom: null, lastSeen: null, daysUnseen: null, stale, ...LINK_ATTRS_DEFAULT };
}
function model(nodes: MapNode[], links: MapLink[], over: Partial<TopologyModel> = {}): TopologyModel {
  return {
    nodes, links, sites: [], promote: [], unmatched: [], isolated: [], suspicious: [], withoutSite: [],
    counts: {} as TopologyModel["counts"], portClients: [], clientCount: {}, canonical: {}, vms: [], ...over,
  };
}
const all = (m: TopologyModel) => new Set(m.nodes.map((n) => n.id));
function canon(children: Map<string, string[]>) {
  return JSON.stringify([...children.keys()].sort().map((k) => [k, children.get(k)]));
}

test("a parità di nodi vince il collegamento non vecchio, poi il rango migliore", () => {
  const m = model(
    [node("dev:1", "router"), node("dev:2", "switch"), node("dev:3", "switch"), node("dev:4", "switch"), node("dev:5", "switch")],
    [
      link("dev:1", "dev:2"), link("dev:1", "dev:3"),
      link("dev:2", "dev:4", "unifi_uplink", true), link("dev:3", "dev:4", "mac_table"),
      link("dev:2", "dev:5", "mac_table"), link("dev:3", "dev:5", "lldp"),
    ],
  );
  const t = buildTree(m, all(m), ["dev:1"]);
  assert.equal(t.via.get("dev:4")!.id, "dev:3~dev:4~mac_table");
  assert.equal(t.via.get("dev:5")!.id, "dev:3~dev:5~lldp");
  assert.deepEqual(t.roots, ["dev:1"]);
});

test("attaccati e client sono foglie: un server su due switch non fa da ponte", () => {
  const m = model(
    [node("dev:1", "router"), node("dev:2", "switch"), node("dev:3", "switch"), node("host:9", "server"), node("host:8", "workstation")],
    [link("dev:1", "dev:2"), link("dev:1", "host:9", "mac_table"), link("dev:3", "host:9", "mac_table"), link("dev:3", "host:8", "mac_table")],
  );
  const t = buildTree(m, all(m), ["dev:1"]);
  assert.deepEqual(t.children.get("host:9"), []);
  assert.ok(!t.children.get("dev:1")!.includes("dev:3"));
  assert.ok(t.roots.includes("dev:3"), "dev:3 non è raggiungibile se non attraverso il server: radice in più");
  assert.equal(t.via.get("host:9")!.a, "dev:1");
});

test("un nodo non raggiungibile diventa radice: prima infrastruttura, poi numero di collegamenti, poi id", () => {
  const m = model(
    [node("dev:1", "router"), node("host:5", "server"), node("dev:7", "access_point"), node("dev:6", "switch"), node("dev:4", "switch"), node("dev:3", "switch"), node("dev:2", "switch")],
    [link("dev:4", "dev:3"), link("dev:4", "dev:2")],
  );
  const t = buildTree(m, all(m), ["dev:1"]);
  // dev:4 ha 2 collegamenti; poi dev:2/3 (dev:2 prima per id) ma sono già nell'albero di dev:4
  assert.deepEqual(t.roots, ["dev:1", "dev:4", "dev:6", "dev:7", "host:5"]);
  assert.deepEqual([...t.children.get("dev:4")!].sort(), ["dev:2", "dev:3"]);
});

test("determinismo: ordine diverso di nodi e collegamenti, stesso albero", () => {
  const nodes = [node("dev:1", "router"), node("dev:2", "switch"), node("dev:3", "switch"), node("dev:4", "switch"), node("host:5", "server"), node("dev:6", "access_point")];
  const links = [
    link("dev:1", "dev:2"), link("dev:1", "dev:3"), link("dev:2", "dev:4", "mac_table"), link("dev:3", "dev:4", "mac_table"),
    link("dev:2", "host:5", "mac_table"), link("dev:4", "dev:6", "unifi_uplink"),
  ];
  const m1 = model(nodes, links);
  const m2 = model([...nodes].reverse(), [...links].reverse());
  const a = buildTree(m1, all(m1), ["dev:1"]);
  const b = buildTree(m2, new Set([...all(m2)].reverse()), ["dev:1"]);
  assert.equal(canon(a.children), canon(b.children));
  assert.deepEqual(a.roots, b.roots);
  assert.deepEqual([...a.via.keys()].sort().map((k) => [k, a.via.get(k)!.id]), [...b.via.keys()].sort().map((k) => [k, b.via.get(k)!.id]));
});

test("proposeHead: testa confermata, altrimenti router più connesso coi collegamenti non vecchi, id più basso, null", () => {
  const site = (headNodeId: string | null, headProposed: boolean): SiteInfo => ({ locationId: 1, name: "S", headNodeId, headProposed, nodeIds: [] });
  const nodes = [node("dev:1", "router"), node("dev:2", "router"), node("dev:3", "switch"), node("dev:4", "switch"), node("dev:5", "switch")];
  const links = [link("dev:1", "dev:3"), link("dev:2", "dev:4"), link("dev:4", "dev:5"), link("dev:1", "dev:5", "lldp", true)];
  assert.equal(proposeHead(model(nodes, links, { sites: [site("dev:3", false)] })), "dev:3");
  // testa solo proposta: non vale come confermata. dev:2 raggiunge 3 nodi, dev:1 solo 2 (il collegamento a dev:5 è vecchio)
  assert.equal(proposeHead(model(nodes, links, { sites: [site("dev:3", true)] })), "dev:2");
  // parità: vince l'id più basso
  assert.equal(proposeHead(model(nodes, [link("dev:1", "dev:3"), link("dev:2", "dev:4")])), "dev:1");
  assert.equal(proposeHead(model([node("dev:3", "switch")], [])), null);
});

test("missingNeighbors non conta i client né i nodi già visibili", () => {
  const m = model(
    [node("dev:1", "switch"), node("dev:2", "switch"), node("dev:3", "switch"), node("host:4", "workstation"), node("host:5", "server")],
    [link("dev:1", "dev:2"), link("dev:1", "dev:3"), link("dev:1", "host:4", "mac_table"), link("dev:1", "host:5", "mac_table"), link("dev:2", "dev:3")],
  );
  const r = missingNeighbors(m, "dev:1", new Set(["dev:1", "dev:2"]));
  assert.deepEqual(r.map((l) => l.id).sort(), ["dev:1~dev:3~lldp", "dev:1~host:5~mac_table"]);
});

test("autoVisible: niente client, isolati, nascosti", () => {
  const m = model(
    [node("dev:1", "router"), node("dev:2", "switch", { hidden: true }), node("dev:3", "switch"), node("host:4", "workstation")],
    [], { isolated: ["dev:3"] },
  );
  assert.deepEqual([...autoVisible(m)], ["dev:1"]);
});

test("anello fra switch: il collegamento che l'albero non usa è ridondanza; il modello non viene toccato", () => {
  const m = model(
    [node("dev:1", "router"), node("dev:2", "switch"), node("dev:3", "switch")],
    [link("dev:1", "dev:2"), link("dev:1", "dev:3"), link("dev:2", "dev:3", "mac_table")],
  );
  const t = buildTree(m, all(m), ["dev:1"]);
  assert.deepEqual(t.links.filter((l) => l.redundant).map((l) => l.id), ["dev:2~dev:3~mac_table"]);
  assert.equal(t.links.filter((l) => l.primary === "auto").length, 2);
  assert.ok(m.links.every((l) => !l.redundant && l.primary === null), "le copie dell'albero non cambiano il modello");
});

test("un collegamento verso un nodo non visibile non è ridondanza", () => {
  const m = model([node("dev:1", "router"), node("dev:2", "switch"), node("dev:3", "switch")], [link("dev:1", "dev:2"), link("dev:2", "dev:3")]);
  const t = buildTree(m, new Set(["dev:1", "dev:2"]), ["dev:1"]);
  assert.deepEqual(t.links.map((l) => l.id), ["dev:1~dev:2~lldp"]);
});

test("un hypervisor è una foglia raggiungibile da più switch e non fa da ponte", () => {
  const m = model(
    [node("dev:1", "router"), node("dev:2", "switch"), node("dev:3", "switch"), node("dev:4", "server", { vendor: "proxmox" })],
    [link("dev:1", "dev:2"), link("dev:4", "dev:2", "unifi_uplink"), link("dev:4", "dev:3", "mac_table")],
  );
  const t = buildTree(m, all(m), ["dev:1"]);
  assert.deepEqual(t.children.get("dev:4"), []);
  assert.ok(t.roots.includes("dev:3"), "dev:3 si raggiunge solo attraverso l'hypervisor: radice in più");
});

test("una VM che è un nodo censito, senza collegamenti propri, sta dentro il suo hypervisor e non è nella mappa automatica", () => {
  const vm = (nodeId: string | null) => ({ id: "vm:4:100", name: "vm", status: "running", ips: [], hypervisorNodeId: "dev:4", nodeId, scannedAt: null });
  const nodi = [node("dev:1", "router"), node("dev:4", "server", { vendor: "proxmox" }), node("host:9", "server")];
  const m = model(nodi, [link("dev:1", "dev:4")], { vms: [vm("host:9")] });
  assert.deepEqual([...autoVisible(m)].sort(), ["dev:1", "dev:4"]);
  assert.deepEqual([...autoVisible(model(nodi, [link("dev:1", "dev:4"), link("dev:1", "host:9")], { vms: [vm("host:9")] }))].sort(), ["dev:1", "dev:4", "host:9"]);
  assert.deepEqual([...autoVisible(model(nodi, [link("dev:1", "dev:4")], { vms: [vm(null)] }))].sort(), ["dev:1", "dev:4", "host:9"]);
});

// Spec §13.8.1 (D1). Incidente del 14/10: a pari costo vinceva la stringa «da|a» più piccola, e chi è il figlio secondo
// il controller non contava: router 1 prendeva accesso A via ether1-2.5 (2,5G) e core 1 finiva sotto accesso A.
// La fonte va anche a `link`, che ne fa l'id («dev:112~dev:114~unifi_uplink»): passata solo in `over`, l'id restava «~lldp».
const sp = (a: string, b: string, speedMbps: number, over: Partial<MapLink> = {}): MapLink => ({ ...link(a, b, over.source ?? "lldp"), speedMbps, ...over });

test("chiaveScelta: ★, non visto, rango, contro verso, velocità — in quest'ordine", () => {
  assert.deepEqual(chiaveScelta(sp("dev:1", "dev:114", 10000), "dev:1"), [1, 0, 2, 0, -10000]);
  assert.deepEqual(chiaveScelta(sp("dev:112", "dev:114", 10000, { source: "unifi_uplink", sources: ["unifi_uplink"], uplinkFrom: "dev:112" }), "dev:112"), [1, 0, 1, 1, -10000]);
  assert.deepEqual(chiaveScelta({ ...link("dev:1", "dev:9", "manual"), manual: { confirmed: true } }, "dev:1"), [1, 0, 3, 0, -0]);
  assert.deepEqual(chiaveScelta({ ...link("dev:1", "dev:9", "lldp", true), primary: "user" }, "dev:1"), [0, 1, 2, 0, -0]);
});

test("I11 — senza l'uplink di core 1, router 1 → core 1 (10G) vince su router 1 → accesso A (2,5G), non l'alfabeto", () => {
  const m = model(
    [node("dev:1", "router"), node("dev:112", "switch"), node("dev:114", "switch")],
    [
      sp("dev:1", "dev:114", 10000),
      sp("dev:1", "dev:112", 2500),
      sp("dev:112", "dev:114", 10000, { source: "unifi_uplink", sources: ["unifi_uplink"], uplinkFrom: "dev:112" }),
    ],
  );
  const t = buildTree(m, all(m), ["dev:1"]);
  assert.equal(t.via.get("dev:114")!.id, "dev:1~dev:114~lldp");
  assert.equal(t.via.get("dev:112")!.id, "dev:112~dev:114~unifi_uplink", "accesso A sotto core 1, sul suo uplink");
});

test("I10 — il verso non batte il rango: core 1 non va sotto il router di riserva attraverso la porta della WAN", () => {
  const m = model(
    [node("dev:1", "router"), node("dev:112", "switch"), node("dev:114", "switch"), node("dev:7", "router")],
    [
      sp("dev:1", "dev:112", 2500),
      sp("dev:112", "dev:114", 10000, { source: "unifi_uplink", sources: ["unifi_uplink"], uplinkFrom: "dev:112" }),
      sp("dev:7", "dev:114", 1000),
      sp("dev:1", "dev:7", 1000),
    ],
  );
  const t = buildTree(m, all(m), ["dev:1"]);
  assert.equal(t.via.get("dev:114")!.id, "dev:112~dev:114~unifi_uplink");
});

// La radice ha l'id PIÙ ALTO di proposito: con la radice «dev:1» la stringa «dev:1|dev:3» batteva comunque «dev:2|dev:3», e la
// prova passava anche senza il verso nella chiave (vista con la chiave mutata, 15/10). Qui l'alfabeto sceglierebbe
// «dev:2|dev:3» (dev:3 sotto dev:2, contro il verso dell'uplink): solo il verso lo scarta.
test("a pari rango un uplink del controller si percorre dal padre al figlio", () => {
  const m = model(
    [node("dev:9", "router"), node("dev:2", "switch"), node("dev:3", "switch")],
    [sp("dev:9", "dev:2", 1000), sp("dev:9", "dev:3", 1000), sp("dev:2", "dev:3", 1000, { uplinkFrom: "dev:2" })],
  );
  const t = buildTree(m, all(m), ["dev:9"]);
  assert.deepEqual([t.via.get("dev:2")!.id, t.via.get("dev:3")!.id], ["dev:9~dev:2~lldp", "dev:9~dev:3~lldp"]);
});

// I63 (spec §13.8.1, H17; vincolo 9 di Riccardo: niente scelte per ordine di id prima delle prove). Rete B: il router e il
// gateway del controller raggiungono gli stessi nodi, e vinceva l'id più basso, per caso. A pari nodi raggiunti vince il
// router gateway di più reti (`gatewayDi`, contate come per la testa di una sede); l'id resta l'ultimo spareggio (I39).
test("I63 — testa proposta: a pari nodi raggiunti il router gateway di più reti; a pari reti, l'id più basso", () => {
  const nodes = [node("dev:1", "router"), node("dev:5", "router"), node("dev:3", "switch")];
  const links = [link("dev:1", "dev:3"), link("dev:5", "dev:3")];
  assert.equal(proposeHead(model(nodes, links, { gatewayDi: { "dev:5": 2 } })), "dev:5");
  assert.equal(proposeHead(model(nodes, links, { gatewayDi: { "dev:1": 1, "dev:5": 1 } })), "dev:1");
  assert.equal(proposeHead(model(nodes, links)), "dev:1", "senza il conto delle reti (regola spenta): come prima");
  // i nodi raggiunti vengono prima delle reti
  assert.equal(proposeHead(model(nodes, [link("dev:1", "dev:3")], { gatewayDi: { "dev:5": 9 } })), "dev:1");
});
