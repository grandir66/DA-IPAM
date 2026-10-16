import { test } from "node:test";
import assert from "node:assert/strict";
import { decideClassification, shouldTouchClassification } from "../engine";
import type { ClassificationEvidence } from "../types";

function ev(partial: Partial<ClassificationEvidence> & Pick<ClassificationEvidence, "source" | "attribute" | "value">): ClassificationEvidence {
  return {
    weight: 0.9,
    confidence: 0.95,
    observed: true,
    timestamp: "2026-07-26T00:00:00Z",
    ...partial,
  };
}

test("ESXi http evidence beats nmap linux for best slug", () => {
  const decision = decideClassification([
    ev({ source: "http", attribute: "title", value: "VMware ESXi", votes_for: "hypervisor", weight: 0.9, confidence: 0.95 }),
    ev({ source: "nmap", attribute: "os_guess", value: "Linux 5.x", votes_for: "server_linux", weight: 0.45, confidence: 0.62 }),
  ], { cascade_slug: "hypervisor" });
  assert.equal(decision.classification, "hypervisor");
  assert.ok(decision.confidence >= 56);
  assert.match(decision.reason, /ESXi|hypervisor|overrides/i);
});

test("manual lock: shouldTouchClassification.apply = false", () => {
  const decision = decideClassification([
    ev({ source: "snmp", attribute: "sysObjectID", value: "1.2.3", votes_for: "switch" }),
  ], { cascade_slug: "switch" });
  const r = shouldTouchClassification(
    { classification: "workstation", confidence: 40 },
    decision,
    true,
  );
  assert.equal(r.apply, false);
});

test("upgrade only when new confidence >= previous", () => {
  const decision = decideClassification([
    ev({ source: "snmp", attribute: "sysObjectID", value: "1.2.3", votes_for: "switch", weight: 0.95, confidence: 0.9 }),
  ], { cascade_slug: "switch" });
  assert.equal(
    shouldTouchClassification({ classification: "unknown", confidence: 10 }, decision, false).apply,
    true,
  );
  assert.equal(
    shouldTouchClassification({ classification: "switch", confidence: 99 }, decision, false).apply,
    decision.confidence >= 99,
  );
});

test("near scores different slugs produce conflict", () => {
  const decision = decideClassification([
    ev({ source: "http", attribute: "title", value: "a", votes_for: "storage", weight: 0.8, confidence: 0.8 }),
    ev({ source: "smb", attribute: "os", value: "Windows", votes_for: "server_windows", weight: 0.75, confidence: 0.85 }),
  ], {});
  assert.equal(decision.conflicts.length, 1);
  const c = decision.conflicts[0]!;
  assert.deepEqual([c.a, c.b].sort(), ["server_windows", "storage"]);
  assert.ok(c.delta < 10);
});

test("under MIN_APPLY_CONFIDENCE yields unknown", () => {
  // naabu-weight weak vote: 0.2 * 0.8 = 0.16 → overall 16 < 56
  const decision = decideClassification([
    ev({
      source: "naabu",
      attribute: "tcp_ports",
      value: "80,443",
      votes_for: "server",
      weight: 0.2,
      confidence: 0.8,
    }),
  ], {});
  assert.ok(decision.confidence < 56);
  assert.equal(decision.classification, "unknown");
});

test("cascade-only under MIN_APPLY keeps cascade_slug at low confidence", () => {
  // Hostname/rules cascade with no votes_for → floor 40 < 56, must not coerce to unknown
  const decision = decideClassification(
    [
      ev({
        source: "dns",
        attribute: "hostname",
        value: "sw-core-01",
        weight: 0.35,
        confidence: 0.6,
        // no votes_for — cascade-only path
      }),
    ],
    { cascade_slug: "switch", previous_classification: "unknown", previous_confidence: 0 }
  );
  assert.ok(decision.confidence < 56);
  assert.equal(decision.classification, "switch");
  assert.equal(
    shouldTouchClassification(
      { classification: "unknown", confidence: 0 },
      decision,
      false
    ).apply,
    true
  );
  // Still refuse upgrading a known strong previous with weaker cascade
  assert.equal(
    shouldTouchClassification(
      { classification: "server", confidence: 90 },
      decision,
      false
    ).apply,
    false
  );
});
