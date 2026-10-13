import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStatusByNode, statusForModel, worstStatus, type StatusData } from "@/lib/topology/status-map";

const NOW = Date.parse("2026-10-12T10:00:00Z");

function data(over: Partial<StatusData> = {}): StatusData {
  return {
    devices: [],
    hosts: [],
    portsDown: new Set(),
    libreStatus: new Map(),
    anomalyBySeverity: new Map(),
    ...over,
  };
}
const host = (id: number, status: string | null, extra: Partial<StatusData["hosts"][number]> = {}) => ({
  id, network_id: 1, ip: `10.0.0.${id}`, status, last_response_time_ms: 5, last_seen: "2026-10-12 09:59:00", ...extra,
});

test("apparato disattivato → unknown (non fail)", () => {
  const s = computeStatusByNode(data({ devices: [{ id: 1, enabled: 0 }] }), NOW);
  assert.equal(s["dev:1"], "unknown");
});

test("apparato attivo → ok; con un uplink giù → warning", () => {
  const s = computeStatusByNode(data({ devices: [{ id: 1, enabled: 1 }, { id: 2, enabled: 1 }], portsDown: new Set([2]) }), NOW);
  assert.equal(s["dev:1"], "ok");
  assert.equal(s["dev:2"], "warning");
});

test("host offline → fail; online fresco → ok", () => {
  const s = computeStatusByNode(data({ hosts: [host(5, "offline"), host(6, "online")] }), NOW);
  assert.equal(s["host:5"], "fail");
  assert.equal(s["host:6"], "ok");
});

test("LibreNMS e anomalie si leggono per rete+IP e per host", () => {
  const s = computeStatusByNode(
    data({
      hosts: [host(7, null), host(8, "online")],
      libreStatus: new Map([["1|10.0.0.7", 0]]),
      anomalyBySeverity: new Map([["host:8", "medium" as const]]),
    }),
    NOW,
  );
  assert.equal(s["host:7"], "fail");
  assert.equal(s["host:8"], "warning");
});

test("lo stato peggiore fra host: fail > warning > ok > unknown (sconosciuto non batte ok)", () => {
  assert.equal(worstStatus("ok", "fail"), "fail");
  assert.equal(worstStatus("warning", "unknown"), "warning");
  assert.equal(worstStatus("ok", "unknown"), "ok");
  assert.equal(worstStatus("unknown", "ok"), "ok");
  assert.equal(worstStatus("unknown", "unknown"), "unknown");
  assert.equal(worstStatus("ok", "ok"), "ok");
});

test("un apparato usa il SUO stato, non quello degli host fusi; chiavi canoniche", () => {
  const byNode = computeStatusByNode(
    data({ devices: [{ id: 1, enabled: 1 }, { id: 2, enabled: 0 }], hosts: [host(10, "offline"), host(11, "online"), host(12, "online")] }),
    NOW,
  );
  const st = statusForModel(
    [
      { id: "dev:1", kind: "device", fusedHostIds: [10, 11] },
      { id: "dev:2", kind: "device", fusedHostIds: [11] },
      { id: "host:12", kind: "host", fusedHostIds: [] },
    ],
    byNode,
  );
  assert.deepEqual(st, { "dev:1": "ok", "dev:2": "unknown", "host:12": "ok" });
  assert.equal(Object.keys(st).some((k) => k === "host:10" || k === "host:11"), false, "gli host fusi non hanno una chiave loro");
});

test("un nodo senza stato suo prende il peggiore dei suoi host; un host sconosciuto non copre uno ok", () => {
  const byNode = { "host:20": "unknown", "host:21": "ok", "host:30": "warning", "host:31": "unknown", "host:40": "fail", "host:41": "ok" } as const;
  const st = statusForModel(
    [
      { id: "dev:7", kind: "device", fusedHostIds: [20, 21] },
      { id: "dev:8", kind: "device", fusedHostIds: [30, 31] },
      { id: "dev:9", kind: "device", fusedHostIds: [40, 41] },
      { id: "dev:10", kind: "device", fusedHostIds: [20] },
    ],
    byNode,
  );
  assert.deepEqual(st, { "dev:7": "ok", "dev:8": "warning", "dev:9": "fail", "dev:10": "unknown" });
});

test("un nodo senza segnali è unknown, non manca", () => {
  const st = statusForModel([{ id: "host:99", kind: "host", fusedHostIds: [] }], {});
  assert.deepEqual(st, { "host:99": "unknown" });
});
