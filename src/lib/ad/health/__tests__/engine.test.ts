import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateContext } from "../engine";
import type { RuleContext } from "../types";

const NOW = new Date("2026-07-25T12:00:00.000Z");

function baseCtx(overrides: Partial<RuleContext> = {}): RuleContext {
  return {
    now: NOW,
    domainFqdn: "contoso.local",
    users: [],
    computers: [],
    groups: [],
    trusts: [],
    krbtgtPasswordLastSetAt: "2026-06-01T00:00:00.000Z",
    guestEnabled: false,
    recycleBinEnabled: true,
    ...overrides,
  };
}

test("evaluateContext with empty clean domain yields DomainScore only (global 0)", () => {
  const { score, findings } = evaluateContext(baseCtx());
  assert.deepEqual(score, {
    global: 0,
    stale: 0,
    privileged: 0,
    trust: 0,
    anomaly: 0,
  });
  assert.equal(findings.length, 1);
  const ds = findings[0]!;
  assert.equal(ds.ruleId, "DA-A-DomainScore");
  assert.equal(ds.axis, "score");
  assert.equal(ds.points, 0);
  assert.equal(ds.severity, "Low");
  assert.match(ds.description, /contoso\.local/);
  assert.match(ds.description, /stale:\s*0/i);
  assert.match(ds.description, /privileged:\s*0/i);
  assert.match(ds.description, /trust:\s*0/i);
  assert.match(ds.description, /anomaly:\s*0/i);
});

test("evaluateContext aggregates rule findings then appends DomainScore", () => {
  const { score, findings } = evaluateContext(
    baseCtx({
      guestEnabled: true,
      recycleBinEnabled: false,
      trusts: [{ name: "partner.local", trustDirection: 3, trustType: 2, trustAttributes: 0 }],
    }),
  );

  // Guest 20 + RecycleBin 15 + Trust 5 → anomaly 35, trust 5, global 35
  assert.equal(score.anomaly, 35);
  assert.equal(score.trust, 5);
  assert.equal(score.global, 35);

  const ruleIds = findings.map((f) => f.ruleId);
  assert.ok(ruleIds.includes("DA-A-GuestEnabled"));
  assert.ok(ruleIds.includes("DA-A-RecycleBin"));
  assert.ok(ruleIds.includes("DA-T-TrustInventory"));
  assert.equal(ruleIds[ruleIds.length - 1], "DA-A-DomainScore");

  const ds = findings.find((f) => f.ruleId === "DA-A-DomainScore")!;
  assert.equal(ds.axis, "score");
  assert.equal(ds.points, 35);
  assert.equal(ds.severity, "Critical");
  assert.match(ds.description, /anomaly:\s*35/i);
  assert.match(ds.description, /trust:\s*5/i);
});

test("DomainScore is not counted twice in aggregateScores", () => {
  const { score, findings } = evaluateContext(
    baseCtx({ guestEnabled: true }),
  );
  // Guest alone → anomaly 20; DomainScore must not inflate axes
  assert.equal(score.anomaly, 20);
  assert.equal(score.global, 20);
  assert.equal(findings.filter((f) => f.ruleId === "DA-A-DomainScore").length, 1);
});
