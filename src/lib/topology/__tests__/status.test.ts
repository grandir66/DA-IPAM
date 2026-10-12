import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveNodeStatus } from "@/lib/topology/status";

const NOW = Date.parse("2026-10-12T10:00:00Z");

test("offline → fail", () => {
  assert.equal(deriveNodeStatus({ hostStatus: "offline", nowMs: NOW }), "fail");
});
test("libreStatus 0 → fail", () => {
  assert.equal(deriveNodeStatus({ libreStatus: 0, nowMs: NOW }), "fail");
});
test("anomalia high → fail", () => {
  assert.equal(deriveNodeStatus({ hostStatus: "online", anomalySeverity: "high", nowMs: NOW }), "fail");
});
test("online + latenza alta → warning", () => {
  assert.equal(deriveNodeStatus({ hostStatus: "online", latencyMs: 300, nowMs: NOW }), "warning");
});
test("online + uplink down → warning", () => {
  assert.equal(deriveNodeStatus({ hostStatus: "online", uplinkDown: true, nowMs: NOW }), "warning");
});
test("online pulito → ok", () => {
  assert.equal(deriveNodeStatus({ hostStatus: "online", latencyMs: 10, nowMs: NOW }), "ok");
});
test("libreStatus 1 pulito → ok", () => {
  assert.equal(deriveNodeStatus({ libreStatus: 1, nowMs: NOW }), "ok");
});
test("device disabilitato senza segnali → unknown (non fail)", () => {
  assert.equal(deriveNodeStatus({ deviceEnabled: false, nowMs: NOW }), "unknown");
});
test("nessun segnale → unknown", () => {
  assert.equal(deriveNodeStatus({ nowMs: NOW }), "unknown");
});
test("online ma last_seen stale e nessun altro segnale → unknown", () => {
  assert.equal(
    deriveNodeStatus({ hostStatus: "online", lastSeen: "2026-10-12 08:00:00", nowMs: NOW, staleSeconds: 900 }),
    "unknown",
  );
});
