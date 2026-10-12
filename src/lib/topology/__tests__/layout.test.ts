import { test } from "node:test";
import assert from "node:assert/strict";
import { autoLayout } from "@/lib/topology/layout";
import type { TopologyGraph } from "@/lib/topology/types";

const g: TopologyGraph = {
  nodes: [
    { id: "dev:1", kind: "device", refId: 1, name: "A", type: "router", model: null, mgmtIp: null, status: "ok" },
    { id: "dev:2", kind: "device", refId: 2, name: "B", type: "switch", model: null, mgmtIp: null, status: "ok" },
  ],
  edges: [{ id: "e", source: "dev:1", target: "dev:2", protocol: "lldp" }],
};

test("ogni nodo riceve una posizione", () => {
  const pos = autoLayout(g, []);
  assert.equal(pos.length, 2);
  assert.ok(pos.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  assert.ok(pos.every((p) => p.fromSaved === false));
});

test("la posizione salvata vince e viene marcata fromSaved", () => {
  const pos = autoLayout(g, [{ nodeId: "dev:1", x: 42, y: 99, pinned: true }]);
  const p1 = pos.find((p) => p.nodeId === "dev:1")!;
  assert.equal(p1.x, 42);
  assert.equal(p1.y, 99);
  assert.equal(p1.fromSaved, true);
});
