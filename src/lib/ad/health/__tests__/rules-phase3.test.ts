import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_RULES, phase3Rules } from "../rules";
import type { AdComputerRow, AdGroupRow, AdUserRow, RuleContext } from "../types";

const NOW = new Date("2026-07-25T12:00:00.000Z");

function user(
  partial: Partial<AdUserRow> & Pick<AdUserRow, "samAccountName" | "distinguishedName">,
): AdUserRow {
  return {
    enabled: true,
    lastLogonAt: null,
    passwordLastSetAt: null,
    uac: 0,
    servicePrincipalNames: [],
    memberOfDns: [],
    primaryGroupId: null,
    adminCount: null,
    description: null,
    sidHistory: [],
    allowedToDelegateTo: [],
    ...partial,
  };
}

function group(
  partial: Partial<AdGroupRow> & Pick<AdGroupRow, "samAccountName" | "distinguishedName">,
): AdGroupRow {
  return { memberDns: [], ...partial };
}

function baseCtx(partial: Partial<RuleContext> = {}): RuleContext {
  return {
    now: NOW,
    domainFqdn: "lab.local",
    users: [],
    computers: [] as AdComputerRow[],
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

function runRule(id: string, ctx: RuleContext) {
  const rule = phase3Rules.find((r) => r.id === id);
  assert.ok(rule, `missing rule ${id}`);
  return rule.run(ctx);
}

test("ALL_RULES has 58 unique rule ids", () => {
  assert.equal(ALL_RULES.length, 58);
  const ids = ALL_RULES.map((r) => r.id);
  assert.equal(new Set(ids).size, 58);
});

test("DA-P-NestedIntoDomainAdmins fires on nested only", () => {
  const ctx = baseCtx({
    groups: [
      group({
        samAccountName: "Domain Admins",
        distinguishedName: "CN=Domain Admins,CN=Users,DC=lab,DC=local",
        memberDns: [
          "CN=alice,CN=Users,DC=lab,DC=local",
          "CN=Tier0,CN=Users,DC=lab,DC=local",
        ],
      }),
      group({
        samAccountName: "Tier0",
        distinguishedName: "CN=Tier0,CN=Users,DC=lab,DC=local",
        memberDns: ["CN=bob,CN=Users,DC=lab,DC=local"],
      }),
    ],
    users: [
      user({ samAccountName: "alice", distinguishedName: "CN=alice,CN=Users,DC=lab,DC=local" }),
      user({ samAccountName: "bob", distinguishedName: "CN=bob,CN=Users,DC=lab,DC=local" }),
    ],
  });
  const f = runRule("DA-P-NestedIntoDomainAdmins", ctx);
  assert.ok(f);
  assert.equal(f!.objectCount, 1);
  assert.ok(f!.sampleDns[0]!.includes("bob"));
});

test("DA-P-OperatorsPopulated fires", () => {
  const ctx = baseCtx({
    groups: [
      group({
        samAccountName: "Backup Operators",
        distinguishedName: "CN=Backup Operators,CN=Builtin,DC=lab,DC=local",
        memberDns: ["CN=svc-backup,CN=Users,DC=lab,DC=local"],
      }),
    ],
    users: [
      user({
        samAccountName: "svc-backup",
        distinguishedName: "CN=svc-backup,CN=Users,DC=lab,DC=local",
      }),
    ],
  });
  const f = runRule("DA-P-OperatorsPopulated", ctx);
  assert.ok(f);
  assert.equal(f!.points, 25);
});

test("DA-P-EmptyProtectedUsers fires when PU empty and DA populated", () => {
  const ctx = baseCtx({
    groups: [
      group({
        samAccountName: "Domain Admins",
        distinguishedName: "CN=Domain Admins,CN=Users,DC=lab,DC=local",
        memberDns: ["CN=admin,CN=Users,DC=lab,DC=local"],
      }),
      group({
        samAccountName: "Protected Users",
        distinguishedName: "CN=Protected Users,CN=Users,DC=lab,DC=local",
        memberDns: [],
      }),
    ],
    users: [
      user({ samAccountName: "admin", distinguishedName: "CN=admin,CN=Users,DC=lab,DC=local" }),
    ],
  });
  const f = runRule("DA-P-EmptyProtectedUsers", ctx);
  assert.ok(f);
  assert.equal(f!.points, 10);
});

test("DA-A-LargePrivilegedSet fires above threshold", () => {
  const users = Array.from({ length: 16 }, (_, i) =>
    user({
      samAccountName: `u${i}`,
      distinguishedName: `CN=u${i},CN=Users,DC=lab,DC=local`,
    }),
  );
  const ctx = baseCtx({
    groups: [
      group({
        samAccountName: "Domain Admins",
        distinguishedName: "CN=Domain Admins,CN=Users,DC=lab,DC=local",
        memberDns: users.map((u) => u.distinguishedName),
      }),
    ],
    users,
  });
  const f = runRule("DA-A-LargePrivilegedSet", ctx);
  assert.ok(f);
  assert.equal(f!.objectCount, 16);
});
