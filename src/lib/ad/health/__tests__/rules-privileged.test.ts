import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_RULES } from "../rules";
import { privilegedRules, resolveDomainAdminUsers } from "../rules/privileged";
import { trustRules } from "../rules/trust";
import { UAC } from "../uac";
import type { AdComputerRow, AdGroupRow, AdUserRow, RuleContext } from "../types";

const NOW = new Date("2026-07-25T12:00:00.000Z");
const RECENT = "2026-07-20T00:00:00.000Z";
const OLD_PWD = "2024-01-01T00:00:00.000Z"; // > 365 days before NOW

function user(partial: Partial<AdUserRow> & Pick<AdUserRow, "samAccountName" | "distinguishedName">): AdUserRow {
  return {
    enabled: true,
    lastLogonAt: RECENT,
    passwordLastSetAt: RECENT,
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

function computer(
  partial: Partial<AdComputerRow> & Pick<AdComputerRow, "samAccountName" | "distinguishedName">,
): AdComputerRow {
  return {
    enabled: true,
    lastLogonAt: RECENT,
    operatingSystem: "Windows Server 2019",
    uac: 0,
    isDomainController: false,
    passwordLastSetAt: null,
    isRodc: false,
    allowedToDelegateTo: [],
    allowedToActOnBehalfOf: false,
    lapsPasswordPresent: null,
    ...partial,
  };
}

function group(
  partial: Partial<AdGroupRow> & Pick<AdGroupRow, "samAccountName" | "distinguishedName">,
): AdGroupRow {
  return {
    memberDns: [],
    ...partial,
  };
}

function baseCtx(overrides: Partial<RuleContext> = {}): RuleContext {
  return {
    now: NOW,
    domainFqdn: "contoso.local",
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
    ...overrides,
  };
}

function ruleById(id: string) {
  const r = privilegedRules.find((x) => x.id === id);
  assert.ok(r, `missing rule ${id}`);
  return r;
}

/** Nested DA: Domain Admins → NestedAdmins → 4 users + 2 direct = 6 enabled (>5) */
function nestedDaFixture(): RuleContext {
  const daDn = "CN=Domain Admins,CN=Users,DC=contoso,DC=local";
  const nestedDn = "CN=NestedAdmins,CN=Users,DC=contoso,DC=local";
  const deepDn = "CN=TooDeep,CN=Users,DC=contoso,DC=local";

  const users = [
    user({ samAccountName: "da1", distinguishedName: "CN=da1,DC=contoso,DC=local", passwordLastSetAt: OLD_PWD }),
    user({ samAccountName: "da2", distinguishedName: "CN=da2,DC=contoso,DC=local", passwordLastSetAt: RECENT }),
    user({ samAccountName: "n1", distinguishedName: "CN=n1,DC=contoso,DC=local", passwordLastSetAt: null }),
    user({ samAccountName: "n2", distinguishedName: "CN=n2,DC=contoso,DC=local" }),
    user({ samAccountName: "n3", distinguishedName: "CN=n3,DC=contoso,DC=local" }),
    user({ samAccountName: "n4", distinguishedName: "CN=n4,DC=contoso,DC=local" }),
    user({
      samAccountName: "deep",
      distinguishedName: "CN=deep,DC=contoso,DC=local",
    }),
    user({
      samAccountName: "disabled-da",
      distinguishedName: "CN=disabled-da,DC=contoso,DC=local",
      enabled: false,
    }),
  ];

  const groups = [
    group({
      samAccountName: "Domain Admins",
      distinguishedName: daDn,
      memberDns: [
        "CN=da1,DC=contoso,DC=local",
        "CN=da2,DC=contoso,DC=local",
        nestedDn,
        "CN=disabled-da,DC=contoso,DC=local",
      ],
    }),
    group({
      samAccountName: "NestedAdmins",
      distinguishedName: nestedDn,
      memberDns: [
        "CN=n1,DC=contoso,DC=local",
        "CN=n2,DC=contoso,DC=local",
        "CN=n3,DC=contoso,DC=local",
        "CN=n4,DC=contoso,DC=local",
        deepDn,
      ],
    }),
    group({
      samAccountName: "TooDeep",
      distinguishedName: deepDn,
      memberDns: ["CN=deep,DC=contoso,DC=local"],
    }),
  ];

  return baseCtx({ users, groups });
}

test("privilegedRules exports the four DA-P-* ids", () => {
  assert.deepEqual(
    privilegedRules.map((r) => r.id).sort(),
    [
      "DA-P-AdminPwdAge",
      "DA-P-DomainAdminsCount",
      "DA-P-Kerberoastable",
      "DA-P-UnconstrainedDelegation",
    ],
  );
});

test("DA-P-DomainAdminsCount expands nested groups max 2 levels and matches when >5 enabled", () => {
  const ctx = nestedDaFixture();
  const finding = ruleById("DA-P-DomainAdminsCount").run(ctx);
  assert.equal(finding?.ruleId, "DA-P-DomainAdminsCount");
  // da1, da2, n1–n4 = 6; deep is level 3 → excluded; disabled excluded
  assert.equal(finding?.objectCount, 6);
  assert.equal(finding?.points, 15);
  assert.ok(!finding?.sampleDns.includes("CN=deep,DC=contoso,DC=local"));
});

test("DA-P-DomainAdminsCount returns null when count ≤5", () => {
  const daDn = "CN=Domain Admins,CN=Users,DC=contoso,DC=local";
  const ctx = baseCtx({
    users: [
      user({ samAccountName: "a", distinguishedName: "CN=a,DC=contoso,DC=local" }),
      user({ samAccountName: "b", distinguishedName: "CN=b,DC=contoso,DC=local" }),
    ],
    groups: [
      group({
        samAccountName: "Domain Admins",
        distinguishedName: daDn,
        memberDns: ["CN=a,DC=contoso,DC=local", "CN=b,DC=contoso,DC=local"],
      }),
    ],
  });
  assert.equal(ruleById("DA-P-DomainAdminsCount").run(ctx), null);
});

test("DA-P-AdminPwdAge matches DA members with null or old passwordLastSet", () => {
  const ctx = nestedDaFixture();
  const finding = ruleById("DA-P-AdminPwdAge").run(ctx);
  assert.equal(finding?.ruleId, "DA-P-AdminPwdAge");
  // da1 (old), n1 (null) among the 6 enabled DA members
  assert.equal(finding?.objectCount, 2);
  assert.equal(finding?.points, 20);
});

test("DA-P-UnconstrainedDelegation matches users/computers with flag, excludes DCs", () => {
  const ctx = baseCtx({
    users: [
      user({
        samAccountName: "deleg",
        distinguishedName: "CN=deleg,DC=contoso,DC=local",
        uac: UAC.TRUSTED_FOR_DELEGATION,
      }),
      user({ samAccountName: "ok", distinguishedName: "CN=ok,DC=contoso,DC=local", uac: 0 }),
    ],
    computers: [
      computer({
        samAccountName: "ws$",
        distinguishedName: "CN=ws,DC=contoso,DC=local",
        uac: UAC.TRUSTED_FOR_DELEGATION,
      }),
      computer({
        samAccountName: "dc$",
        distinguishedName: "CN=dc,DC=contoso,DC=local",
        uac: UAC.TRUSTED_FOR_DELEGATION,
        isDomainController: true,
      }),
    ],
  });
  const finding = ruleById("DA-P-UnconstrainedDelegation").run(ctx);
  assert.equal(finding?.ruleId, "DA-P-UnconstrainedDelegation");
  assert.equal(finding?.objectCount, 2);
  assert.equal(finding?.points, 30);
  assert.ok(!finding?.sampleDns.includes("CN=dc,DC=contoso,DC=local"));
});

test("DA-P-Kerberoastable matches enabled users with SPNs", () => {
  const ctx = baseCtx({
    users: [
      user({
        samAccountName: "svc",
        distinguishedName: "CN=svc,DC=contoso,DC=local",
        servicePrincipalNames: ["HTTP/app.contoso.local"],
      }),
      user({
        samAccountName: "off",
        distinguishedName: "CN=off,DC=contoso,DC=local",
        enabled: false,
        servicePrincipalNames: ["HTTP/old.contoso.local"],
      }),
      user({ samAccountName: "ok", distinguishedName: "CN=ok,DC=contoso,DC=local" }),
    ],
  });
  const finding = ruleById("DA-P-Kerberoastable").run(ctx);
  assert.equal(finding?.ruleId, "DA-P-Kerberoastable");
  assert.equal(finding?.objectCount, 1);
  assert.equal(finding?.points, 15);
});

test("DA-T-TrustInventory matches external trusts only (WITHIN_FOREST excluded)", () => {
  const trustRule = trustRules.find((r) => r.id === "DA-T-TrustInventory");
  assert.ok(trustRule);
  const empty = baseCtx();
  assert.equal(trustRule.run(empty), null);

  // Only WITHIN_FOREST (0x20) → no match
  assert.equal(
    trustRule.run(
      baseCtx({
        trusts: [
          { name: "child.contoso.local", trustDirection: 3, trustType: 2, trustAttributes: 0x20 },
        ],
      }),
    ),
    null,
  );

  const ctx = baseCtx({
    trusts: [
      { name: "partner.local", trustDirection: 3, trustType: 2, trustAttributes: 0 },
      { name: "lab.local", trustDirection: 1, trustType: 1, trustAttributes: 0 },
      { name: "child.contoso.local", trustDirection: 3, trustType: 2, trustAttributes: 0x20 },
    ],
  });
  const finding = trustRule.run(ctx);
  assert.equal(finding?.ruleId, "DA-T-TrustInventory");
  assert.equal(finding?.points, 5);
  assert.equal(finding?.objectCount, 2);
  assert.match(finding?.description ?? "", /partner\.local/);
  assert.match(finding?.description ?? "", /lab\.local/);
  assert.ok(!finding?.description?.includes("child.contoso.local"));
});

test("resolveDomainAdminUsers includes primaryGroupID=512", () => {
  const daDn = "CN=Domain Admins,CN=Users,DC=contoso,DC=local";
  const ctx = baseCtx({
    users: [
      user({ samAccountName: "listed", distinguishedName: "CN=listed,DC=contoso,DC=local" }),
      user({
        samAccountName: "primary",
        distinguishedName: "CN=primary,DC=contoso,DC=local",
        primaryGroupId: 512,
      }),
    ],
    groups: [
      group({
        samAccountName: "Domain Admins",
        distinguishedName: daDn,
        memberDns: ["CN=listed,DC=contoso,DC=local"],
      }),
    ],
  });
  const members = resolveDomainAdminUsers(ctx);
  const dns = members.map((u) => u.distinguishedName).sort();
  assert.deepEqual(dns, ["CN=listed,DC=contoso,DC=local", "CN=primary,DC=contoso,DC=local"]);
});

test("ALL_RULES has 54 unique rule ids", () => {
  assert.equal(ALL_RULES.length, 54);
  const ids = ALL_RULES.map((r) => r.id);
  assert.equal(new Set(ids).size, 54);
  assert.ok(!ids.includes("DA-A-DomainScore"));
});
