import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLinkOverrideBody, parseSiteTopologyBody, parseDeviceLocationBody, parseStaleDaysBody } from "@/lib/topology/api-input";

test("correzione: nodi nella forma dev:N / host:N, azione nota, porte facoltative", () => {
  assert.deepEqual(parseLinkOverrideBody({ action: "add", a_node: "dev:1", b_node: "host:2" }), {
    ok: true, data: { action: "add", a_node: "dev:1", a_port: "", b_node: "host:2", b_port: "", note: null },
  });
  assert.equal(parseLinkOverrideBody({ action: "add", a_node: "dev:1", b_node: "dev:1" }).ok, false, "un nodo con se stesso");
  assert.equal(parseLinkOverrideBody({ action: "sposta", a_node: "dev:1", b_node: "dev:2" }).ok, false);
  assert.equal(parseLinkOverrideBody({ action: "add", a_node: "ext:x", b_node: "dev:2" }).ok, false);
});

test("sede: testa e subnet facoltative, interi positivi", () => {
  assert.deepEqual(parseSiteTopologyBody({ head_device_id: null, network_ids: [1, 2] }), { ok: true, data: { headDeviceId: null, networkIds: [1, 2] } });
  assert.deepEqual(parseSiteTopologyBody({}), { ok: true, data: {} });
  assert.equal(parseSiteTopologyBody({ network_ids: [-1] }).ok, false);
});

test("sede dell'apparato e soglia", () => {
  assert.deepEqual(parseDeviceLocationBody({ location_id: null }), { ok: true, data: { locationId: null } });
  assert.equal(parseDeviceLocationBody({}).ok, false);
  assert.deepEqual(parseStaleDaysBody({ staleDays: 3 }), { ok: true, data: 3 });
  assert.equal(parseStaleDaysBody({ staleDays: 0 }).ok, false);
});

test("i rifiuti parlano italiano: nessun messaggio predefinito di Zod arriva all'admin", () => {
  const rifiuti = [
    parseLinkOverrideBody(null),
    parseLinkOverrideBody({ action: "sposta", a_node: "dev:1", b_node: "dev:2" }),
    parseLinkOverrideBody({ action: "add", a_node: 5, b_node: "dev:2" }),
    parseLinkOverrideBody({ action: "add", a_node: "dev:1", b_node: "dev:2", a_port: "x".repeat(101) }),
    parseLinkOverrideBody({ action: "add", a_node: "dev:1", b_node: "dev:2", note: "x".repeat(501) }),
    parseSiteTopologyBody(null),
    parseSiteTopologyBody({ head_device_id: "3" }),
    parseSiteTopologyBody({ network_ids: [-1] }),
    parseSiteTopologyBody({ network_ids: "1,2" }),
    parseDeviceLocationBody(null),
    parseDeviceLocationBody({}),
    parseDeviceLocationBody({ location_id: 1.5 }),
  ];
  for (const r of rifiuti) {
    assert.equal(r.ok, false);
    if (r.ok) continue;
    assert.doesNotMatch(r.error, /Invalid|expected|Too (small|big)|received/, r.error);
  }
});

test("mappe: nome 1-80 caratteri, nodi dev:N/host:N, al massimo 2000 per colpo", async () => {
  const m = await import("@/lib/topology/api-input");
  assert.deepEqual(m.parseMapCreateBody({ name: "  Sede  ", roots: ["dev:1"], nodes: ["dev:1", "host:2"] }), {
    ok: true, data: { name: "Sede", roots: ["dev:1"], nodes: ["dev:1", "host:2"] },
  });
  assert.deepEqual(m.parseMapCreateBody({ name: "x" }), { ok: true, data: { name: "x", roots: [], nodes: [] } });
  for (const bad of [{ name: "" }, { name: "   " }, { name: "a".repeat(81) }, { name: "x", nodes: ["ext:1"] }, { name: "x", roots: ["dev:x"] },
    { name: "x", nodes: Array.from({ length: 2001 }, (_, i) => `dev:${i + 1}`) }]) {
    const r = m.parseMapCreateBody(bad);
    assert.equal(r.ok, false);
    if (!r.ok) assert.doesNotMatch(r.error, /Invalid|expected/i);
  }
  assert.equal(m.parseMapPatchBody({}).ok, false, "una modifica vuota");
  assert.deepEqual(m.parseMapPatchBody({ name: "Nuovo" }), { ok: true, data: { name: "Nuovo" } });
  assert.deepEqual(m.parseMapNodesBody({ add: ["dev:3"] }), { ok: true, data: { add: ["dev:3"], remove: [] } });
  assert.equal(m.parseMapNodesBody({ add: ["x"] }).ok, false);
  assert.deepEqual(m.parseAutoHeadBody({ head_node: null }), { ok: true, data: { headNode: null } });
  assert.equal(m.parseAutoHeadBody({ head_node: "foo" }).ok, false);
});

test("ritocchi e nascondi: vista auto o mappa:N; hidden solo dev:N", async () => {
  const m = await import("@/lib/topology/api-input");
  assert.deepEqual(m.parsePositionsBody({ view: "mappa:4", tweaks: [{ nodeId: "dev:1", x: 1.5, y: -2, sig: "abc" }] }), {
    ok: true, data: { view: "mappa:4", clear: false, tweaks: [{ nodeId: "dev:1", x: 1.5, y: -2, sig: "abc" }] },
  });
  assert.deepEqual(m.parsePositionsBody({ view: "auto", clear: true }), { ok: true, data: { view: "auto", clear: true, tweaks: [] } });
  assert.equal(m.parsePositionsBody({ view: "default", tweaks: [] }).ok, false);
  assert.equal(m.parsePositionsBody({ view: "auto" }).ok, false, "né ritocchi né riordino");
  assert.equal(m.parsePositionsBody({ view: "auto", tweaks: [{ nodeId: "dev:1", x: "a", y: 0, sig: "" }] }).ok, false);
  assert.deepEqual(m.parseHiddenBody({ node_id: "dev:7", hidden: true }), { ok: true, data: { deviceId: 7, hidden: true } });
  assert.equal(m.parseHiddenBody({ node_id: "host:7", hidden: true }).ok, false);
  assert.equal(m.parseHiddenBody({ node_id: "dev:7" }).ok, false);
});
