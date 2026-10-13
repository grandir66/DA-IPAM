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
