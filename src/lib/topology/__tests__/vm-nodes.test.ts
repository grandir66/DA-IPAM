import { test } from "node:test";
import assert from "node:assert/strict";
import { hangVmNodes, isRunning, vmChipText, vmNodes, vmSummary } from "@/lib/topology/vm-nodes";
import { CHAR_W } from "@/lib/topology/tree-layout";
import type { MapNode, MapVm, TopologyModel } from "@/lib/topology/model-types";
import type { TreeResult } from "@/lib/topology/tree";

const vm = (id: string, over: Partial<MapVm> = {}): MapVm => ({
  id, name: `vm-${id.split(":")[2]}`, status: "running", ips: [], hypervisorNodeId: "dev:4", nodeId: null, scannedAt: null, ...over,
});
function model(vms: MapVm[]): TopologyModel {
  const n = (id: string, type: string): MapNode => ({
    id, kind: "device", refId: Number(id.split(":")[1]), name: id, type, mgmtIp: null, fusedHostIds: [], addresses: [], aliases: [],
    siteId: null, rackId: null, siteProposed: false, hidden: false, vendor: null,
  });
  return {
    nodes: [n("dev:1", "switch"), n("dev:4", "hypervisor")], links: [], sites: [], promote: [], unmatched: [], isolated: [], suspicious: [],
    withoutSite: [], counts: {} as TopologyModel["counts"], portClients: [], clientCount: {}, canonical: {}, vms,
  };
}

test("▶ accesa, ■ spenta; il riepilogo dice quante sono e quante accese", () => {
  assert.equal(isRunning("running"), true);
  assert.equal(isRunning("stopped"), false);
  assert.equal(isRunning("paused"), false);
  assert.deepEqual(vmSummary([vm("vm:12:1"), vm("vm:12:2", { status: "stopped" }), vm("vm:12:3")]), { total: 3, running: 2, label: "3 VM, 2 accese" });
  assert.equal(vmSummary([vm("vm:12:1")]).label, "1 VM, 1 accesa");
});

test("la scritta della VM: simbolo, nome e IP se ci stanno, mai più larga del riquadro", () => {
  assert.equal(vmChipText(vm("vm:12:1", { name: "dc01", ips: ["192.0.2.10"] }), 150), "▶ dc01 · 192.0.2.10");
  assert.equal(vmChipText(vm("vm:12:1", { name: "dc01", status: "stopped" }), 150), "■ dc01");
  const long = vmChipText(vm("vm:12:1", { name: "un-nome-di-vm-molto-lungo", ips: ["192.0.2.10"] }), 150);
  assert.ok(long.startsWith("▶ un-nome"), long);
  assert.ok(long.endsWith("…"), long);
  assert.ok(long.length * CHAR_W <= 150 - 12, `${long} (${long.length} caratteri) esce dal riquadro`);
});

test("una VM che non è un oggetto censito diventa un nodo solo se ha l'hypervisor; una censita rimanda al suo nodo", () => {
  const out = vmNodes(model([
    vm("vm:12:100", { ips: ["192.0.2.20"] }),
    vm("vm:12:101", { nodeId: "host:7" }),
    vm("vm:12:102", { hypervisorNodeId: null }),
  ]));
  assert.deepEqual(out.nodes.map((n) => [n.id, n.type, n.name, n.mgmtIp]), [["vm:12:100", "vm", "vm-100", "192.0.2.20"]]);
  assert.deepEqual(out.canonical, { "vm:12:101": "host:7" });
  assert.deepEqual([...out.parentOf], [["vm:12:100", "dev:4"]]);
});

test("una VM nella mappa sta appesa al suo hypervisor (se è nella mappa), non è una radice staccata", () => {
  const tree: TreeResult = {
    roots: ["dev:1", "vm:12:100", "vm:12:200"],
    children: new Map([["dev:1", ["dev:4"]], ["dev:4", []], ["vm:12:100", []], ["vm:12:200", []]]),
    via: new Map(),
    links: [],
  };
  const parentOf = new Map([["vm:12:100", "dev:4"], ["vm:12:200", "dev:9"]]);
  const t = hangVmNodes(tree, parentOf);
  assert.deepEqual(t.roots, ["dev:1", "vm:12:200"], "dev:9 non è nella mappa: la VM resta radice");
  assert.deepEqual(t.children.get("dev:4"), ["vm:12:100"]);
  assert.deepEqual(tree.children.get("dev:4"), [], "l'albero di partenza non cambia");
});
