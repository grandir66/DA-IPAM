import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveMapView } from "@/lib/topology/map-view";

const ids = new Set(["dev:1", "dev:3", "host:9"]);
const canonical = { "host:7": "dev:3", "host:8": "dev:3", "host:12": "host:9" };

test("un membro assorbito in un apparato rende visibile l'apparato e non è «non più presente» (I5)", () => {
  const v = resolveMapView({ members: ["dev:1", "host:7"], roots: ["host:7"], tweaks: [], head: null }, ids, canonical);
  assert.deepEqual(v.visible, ["dev:1", "dev:3"]);
  assert.deepEqual(v.missing, []);
  assert.deepEqual(v.roots, ["dev:3"]);
  assert.deepEqual(v.renames, [{ from: "host:7", to: "dev:3" }]);
});

test("solo un id senza nodo e senza alias è «non più presente»; i doppi si riducono", () => {
  const v = resolveMapView(
    { members: ["dev:3", "host:7", "host:8", "dev:99", "host:12"], roots: ["host:8", "dev:3", "dev:99"], tweaks: [], head: null },
    ids, canonical,
  );
  assert.deepEqual(v.visible, ["dev:3", "host:9"]);
  assert.deepEqual(v.missing, ["dev:99"]);
  assert.deepEqual(v.roots, ["dev:3", "dev:99"]);
  assert.deepEqual(v.renames, [{ from: "host:7", to: "dev:3" }, { from: "host:8", to: "dev:3" }, { from: "host:12", to: "host:9" }]);
});

test("ritocchi e testa seguono l'id canonico; il ritocco già sull'id canonico vince", () => {
  const v = resolveMapView({
    members: [],
    roots: [],
    tweaks: [{ nodeId: "host:7", x: 1, y: 1, sig: "a", orientation: "tb" }, { nodeId: "dev:3", x: 2, y: 2, sig: "b", orientation: "tb" }, { nodeId: "host:12", x: 3, y: 3, sig: "c", orientation: "tb" }],
    head: "host:12",
  }, ids, canonical);
  assert.deepEqual(v.tweaks, [{ nodeId: "dev:3", x: 2, y: 2, sig: "b", orientation: "tb" }, { nodeId: "host:9", x: 3, y: 3, sig: "c", orientation: "tb" }]);
  assert.equal(v.head, "host:9");
  assert.deepEqual(v.renames, [{ from: "host:7", to: "dev:3" }, { from: "host:12", to: "host:9" }]);
  assert.equal(resolveMapView({ members: [], roots: [], tweaks: [], head: "dev:99" }, ids, canonical).head, null);
});

test("niente alias: niente da riscrivere", () => {
  const v = resolveMapView({ members: ["dev:1"], roots: ["dev:1"], tweaks: [], head: "dev:1" }, ids, canonical);
  assert.deepEqual(v.renames, []);
});
