import { test } from "node:test";
import assert from "node:assert/strict";
import { staleRules } from "../rules/stale";
import { UAC } from "../uac";
import type { AdComputerRow, AdUserRow, RuleContext } from "../types";

const NOW = new Date("2026-07-25T12:00:00.000Z");
const OLD = "2026-01-01T00:00:00.000Z"; // > 90 days before NOW
const RECENT = "2026-07-20T00:00:00.000Z";

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
  const r = staleRules.find((x) => x.id === id);
  assert.ok(r, `missing rule ${id}`);
  return r;
}

test("staleRules exports the six DA-S-* ids", () => {
  assert.deepEqual(
    staleRules.map((r) => r.id).sort(),
    [
      "DA-S-InactiveComputer",
      "DA-S-InactiveUser",
      "DA-S-NoPreAuth",
      "DA-S-ObsoleteOS",
      "DA-S-PwdNeverExpires",
      "DA-S-PwdNotRequired",
    ],
  );
});

test("DA-S-InactiveUser matches enabled users inactive or never logged on", () => {
  const ctx = baseCtx({
    users: [
      user({ samAccountName: "alice", distinguishedName: "CN=alice,DC=contoso,DC=local", lastLogonAt: OLD }),
      user({ samAccountName: "bob", distinguishedName: "CN=bob,DC=contoso,DC=local", lastLogonAt: null }),
      user({ samAccountName: "carol", distinguishedName: "CN=carol,DC=contoso,DC=local", lastLogonAt: RECENT }),
      user({
        samAccountName: "disabled",
        distinguishedName: "CN=disabled,DC=contoso,DC=local",
        enabled: false,
        lastLogonAt: OLD,
      }),
    ],
  });
  const finding = ruleById("DA-S-InactiveUser").run(ctx);
  assert.equal(finding?.ruleId, "DA-S-InactiveUser");
  assert.equal(finding?.objectCount, 2);
  assert.equal(finding?.points, 10);
  assert.equal(finding?.axis, "stale");
});

test("DA-S-InactiveComputer matches enabled computers inactive or never logged on", () => {
  const ctx = baseCtx({
    computers: [
      computer({ samAccountName: "pc1$", distinguishedName: "CN=pc1,DC=contoso,DC=local", lastLogonAt: OLD }),
      computer({ samAccountName: "pc2$", distinguishedName: "CN=pc2,DC=contoso,DC=local", lastLogonAt: null }),
      computer({ samAccountName: "pc3$", distinguishedName: "CN=pc3,DC=contoso,DC=local", lastLogonAt: RECENT }),
    ],
  });
  const finding = ruleById("DA-S-InactiveComputer").run(ctx);
  assert.equal(finding?.ruleId, "DA-S-InactiveComputer");
  assert.equal(finding?.objectCount, 2);
  assert.equal(finding?.points, 10);
});

test("DA-S-ObsoleteOS matches enabled computers with obsolete OS", () => {
  const ctx = baseCtx({
    computers: [
      computer({
        samAccountName: "legacy$",
        distinguishedName: "CN=legacy,DC=contoso,DC=local",
        operatingSystem: "Windows 7 Professional",
      }),
      computer({
        samAccountName: "modern$",
        distinguishedName: "CN=modern,DC=contoso,DC=local",
        operatingSystem: "Windows Server 2019",
      }),
      computer({
        samAccountName: "off$",
        distinguishedName: "CN=off,DC=contoso,DC=local",
        enabled: false,
        operatingSystem: "Windows Server 2012 R2",
      }),
    ],
  });
  const finding = ruleById("DA-S-ObsoleteOS").run(ctx);
  assert.equal(finding?.ruleId, "DA-S-ObsoleteOS");
  assert.equal(finding?.objectCount, 1);
  assert.equal(finding?.points, 20);
});

test("DA-S-PwdNeverExpires matches enabled users with DONT_EXPIRE_PASSWORD", () => {
  const ctx = baseCtx({
    users: [
      user({
        samAccountName: "svc",
        distinguishedName: "CN=svc,DC=contoso,DC=local",
        uac: UAC.DONT_EXPIRE_PASSWORD,
      }),
      user({ samAccountName: "ok", distinguishedName: "CN=ok,DC=contoso,DC=local", uac: 0 }),
      user({
        samAccountName: "nulluac",
        distinguishedName: "CN=nulluac,DC=contoso,DC=local",
        uac: null,
      }),
    ],
  });
  const finding = ruleById("DA-S-PwdNeverExpires").run(ctx);
  assert.equal(finding?.ruleId, "DA-S-PwdNeverExpires");
  assert.equal(finding?.objectCount, 1);
  assert.equal(finding?.points, 10);
});

test("DA-S-PwdNotRequired matches enabled users with PASSWD_NOTREQD", () => {
  const ctx = baseCtx({
    users: [
      user({
        samAccountName: "weak",
        distinguishedName: "CN=weak,DC=contoso,DC=local",
        uac: UAC.PASSWD_NOTREQD,
      }),
      user({ samAccountName: "ok", distinguishedName: "CN=ok,DC=contoso,DC=local", uac: 0 }),
    ],
  });
  const finding = ruleById("DA-S-PwdNotRequired").run(ctx);
  assert.equal(finding?.ruleId, "DA-S-PwdNotRequired");
  assert.equal(finding?.objectCount, 1);
  assert.equal(finding?.points, 30);
});

test("DA-S-NoPreAuth matches enabled users with DONT_REQ_PREAUTH", () => {
  const ctx = baseCtx({
    users: [
      user({
        samAccountName: "asrep",
        distinguishedName: "CN=asrep,DC=contoso,DC=local",
        uac: UAC.DONT_REQ_PREAUTH,
      }),
      user({ samAccountName: "ok", distinguishedName: "CN=ok,DC=contoso,DC=local", uac: 0 }),
    ],
  });
  const finding = ruleById("DA-S-NoPreAuth").run(ctx);
  assert.equal(finding?.ruleId, "DA-S-NoPreAuth");
  assert.equal(finding?.objectCount, 1);
  assert.equal(finding?.points, 20);
});

test("stale rules return null when no matches", () => {
  const ctx = baseCtx({
    users: [user({ samAccountName: "ok", distinguishedName: "CN=ok,DC=contoso,DC=local" })],
    computers: [
      computer({ samAccountName: "pc$", distinguishedName: "CN=pc,DC=contoso,DC=local" }),
    ],
  });
  for (const rule of staleRules) {
    assert.equal(rule.run(ctx), null, rule.id);
  }
});
