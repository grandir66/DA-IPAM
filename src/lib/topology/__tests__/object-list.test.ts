import { test } from "node:test";
import assert from "node:assert/strict";
import { listedNodes } from "@/lib/topology/object-list";
import { buildNodeIndex } from "@/lib/topology/node-index";
import type { MapNode } from "@/lib/topology/model-types";
import { dev } from "./support/righe";

function node(id: string, over: Partial<MapNode> = {}): MapNode {
  const [k, n] = id.split(":");
  return {
    id, kind: k === "dev" ? "device" : "host", refId: Number(n), name: `N${n}`, type: "switch", mgmtIp: null,
    fusedHostIds: [], addresses: [], aliases: [], siteId: null, rackId: null, siteProposed: false, hidden: false, vendor: null, ...over,
  };
}

/*
 * Decisione di Riccardo, 2026-10-15: l'elenco a sinistra della Topologia non mostra gli apparati disabilitati
 * (network_devices.enabled = 0). Sulla mappa restano come prima: cambia solo l'elenco.
 */
test("l'elenco non mostra gli apparati disabilitati, tiene tutto il resto", () => {
  const nodes = [node("dev:1"), node("dev:2", { disabled: true }), node("host:3"), node("dev:4")];
  assert.deepEqual(listedNodes(nodes).map((n) => n.id), ["dev:1", "host:3", "dev:4"]);
});

test("un modello senza il campo (risposta di prima) mostra tutto", () => {
  const nodes = [node("dev:1"), node("host:2")];
  assert.deepEqual(listedNodes(nodes), nodes);
});

test("l'elenco filtrato non altera la lista di partenza (la mappa usa quella intera)", () => {
  const nodes = [node("dev:1", { disabled: true })];
  listedNodes(nodes);
  assert.equal(nodes.length, 1);
});

test("il modello segna disabilitato l'apparato con enabled = 0, e solo quello", () => {
  const idx = buildNodeIndex([dev(1, { enabled: 0 }), dev(2, { enabled: 1 })], [], []);
  assert.equal(idx.nodes.get("dev:1")?.disabled, true);
  assert.equal(idx.nodes.get("dev:2")?.disabled, undefined);
});
