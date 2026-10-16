import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_RULES, collectRules } from "../rules";
import { aggregateScores } from "../score";
import type { RuleContext } from "../types";

const NOW = new Date("2026-07-27T12:00:00.000Z");

function baseCtx(partial: Partial<RuleContext> = {}): RuleContext {
  return {
    now: NOW,
    domainFqdn: "lab.local",
    users: [],
    computers: [],
    groups: [],
    trusts: [],
    krbtgtPasswordLastSetAt: null,
    guestEnabled: null,
    recycleBinEnabled: null,
    minPwdLength: null,
    lockoutThreshold: null,
    machineAccountQuota: null,
    lapsSchemaPresent: null,
    ldapsConfigured: true,
    ...partial,
  };
}

function run(id: string, ctx: RuleContext) {
  const rule = collectRules.find((r) => r.id === id);
  assert.ok(rule, id);
  return rule.run(ctx);
}

test("ALL_RULES includes collect rules", () => {
  assert.ok(collectRules.every((r) => ALL_RULES.some((a) => a.id === r.id)));
});

test("DA-A-LdapCollectPartial stays silent when every query succeeded", () => {
  assert.equal(run("DA-A-LdapCollectPartial", baseCtx({ ldapCollectErrors: [] })), null);
  assert.equal(run("DA-A-LdapCollectPartial", baseCtx()), null);
});

test("DA-A-LdapCollectPartial fires when an LDAP query failed", () => {
  const f = run(
    "DA-A-LdapCollectPartial",
    baseCtx({ ldapCollectErrors: ["users", "groups"] }),
  );
  assert.ok(f);
  assert.equal(f!.objectCount, 2);
  assert.ok(f!.description.includes("users"));
});

test("a failed users query is reported as High, not as a clean domain", () => {
  const f = run("DA-A-LdapCollectPartial", baseCtx({ ldapCollectErrors: ["users"] }));
  assert.ok(f);
  assert.equal(f!.severity, "High");
});

test("a peripheral query failure is reported but stays Low", () => {
  const f = run("DA-A-LdapCollectPartial", baseCtx({ ldapCollectErrors: ["sites"] }));
  assert.ok(f);
  assert.equal(f!.severity, "Low");
});

test("DA-A-LdapCollectPartial never inflates the risk score", () => {
  const f = run("DA-A-LdapCollectPartial", baseCtx({ ldapCollectErrors: ["users"] }));
  assert.ok(f);
  assert.equal(f!.diagnostic, true);
  assert.equal(aggregateScores([f!]).global, 0);
});
