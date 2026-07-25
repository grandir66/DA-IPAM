import { test } from "node:test";
import assert from "node:assert/strict";
import { anomalyRules } from "../rules/anomaly";
import type { RuleContext } from "../types";

const NOW = new Date("2026-07-25T12:00:00.000Z");
const OLD_KRBTGT = "2025-01-01T00:00:00.000Z"; // > 180 days before NOW
const FRESH_KRBTGT = "2026-06-01T00:00:00.000Z";

function baseCtx(overrides: Partial<RuleContext> = {}): RuleContext {
  return {
    now: NOW,
    domainFqdn: "contoso.local",
    users: [],
    computers: [],
    groups: [],
    trusts: [],
    krbtgtPasswordLastSetAt: FRESH_KRBTGT,
    guestEnabled: false,
    recycleBinEnabled: true,
    ...overrides,
  };
}

function ruleById(id: string) {
  const r = anomalyRules.find((x) => x.id === id);
  assert.ok(r, `missing rule ${id}`);
  return r;
}

test("anomalyRules exports the three DA-A-* ids (no DomainScore)", () => {
  assert.deepEqual(
    anomalyRules.map((r) => r.id).sort(),
    ["DA-A-GuestEnabled", "DA-A-KrbtgtAge", "DA-A-RecycleBin"],
  );
});

test("DA-A-KrbtgtAge matches when null or older than 180 days", () => {
  assert.equal(ruleById("DA-A-KrbtgtAge").run(baseCtx({ krbtgtPasswordLastSetAt: FRESH_KRBTGT })), null);

  const old = ruleById("DA-A-KrbtgtAge").run(baseCtx({ krbtgtPasswordLastSetAt: OLD_KRBTGT }));
  assert.equal(old?.ruleId, "DA-A-KrbtgtAge");
  assert.equal(old?.points, 25);
  assert.equal(old?.objectCount, 1);

  const missing = ruleById("DA-A-KrbtgtAge").run(baseCtx({ krbtgtPasswordLastSetAt: null }));
  assert.equal(missing?.ruleId, "DA-A-KrbtgtAge");
  assert.equal(missing?.points, 25);
});

test("DA-A-GuestEnabled matches only when guestEnabled === true", () => {
  assert.equal(ruleById("DA-A-GuestEnabled").run(baseCtx({ guestEnabled: false })), null);
  assert.equal(ruleById("DA-A-GuestEnabled").run(baseCtx({ guestEnabled: null })), null);

  const finding = ruleById("DA-A-GuestEnabled").run(baseCtx({ guestEnabled: true }));
  assert.equal(finding?.ruleId, "DA-A-GuestEnabled");
  assert.equal(finding?.points, 20);
  assert.equal(finding?.objectCount, 1);
});

test("DA-A-RecycleBin: null → no match; false → match; true → no match", () => {
  assert.equal(ruleById("DA-A-RecycleBin").run(baseCtx({ recycleBinEnabled: null })), null);
  assert.equal(ruleById("DA-A-RecycleBin").run(baseCtx({ recycleBinEnabled: true })), null);

  const finding = ruleById("DA-A-RecycleBin").run(baseCtx({ recycleBinEnabled: false }));
  assert.equal(finding?.ruleId, "DA-A-RecycleBin");
  assert.equal(finding?.points, 15);
  assert.equal(finding?.objectCount, 1);
});
