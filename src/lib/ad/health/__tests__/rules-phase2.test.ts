import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_RULES, phase2Rules } from "../rules";
import { UAC } from "../uac";
import type { AdComputerRow, AdGroupRow, AdUserRow, RuleContext } from "../types";

const NOW = new Date("2026-07-25T12:00:00.000Z");
const RECENT = "2026-07-20T00:00:00.000Z";

function user(
  partial: Partial<AdUserRow> & Pick<AdUserRow, "samAccountName" | "distinguishedName">,
): AdUserRow {
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
    allowedToDelegateTo: [],
    allowedToActOnBehalfOf: false,
    lapsPasswordPresent: null,
    ...partial,
  };
}

function group(
  partial: Partial<AdGroupRow> & Pick<AdGroupRow, "samAccountName" | "distinguishedName">,
): AdGroupRow {
  return { memberDns: [], ...partial };
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
    minPwdLength: 14,
    lockoutThreshold: 5,
    machineAccountQuota: 0,
    lapsSchemaPresent: null,
    ldapsConfigured: true,
    ...overrides,
  };
}

function ruleById(id: string) {
  const r = phase2Rules.find((x) => x.id === id);
  assert.ok(r, `missing rule ${id}`);
  return r;
}

test("phase2Rules exports the twelve DA-* ids", () => {
  assert.equal(phase2Rules.length, 12);
  assert.deepEqual(
    phase2Rules.map((r) => r.id).sort(),
    [
      "DA-A-LapsCoverage",
      "DA-A-LdapsNotUsed",
      "DA-A-MachineAccountQuota",
      "DA-A-PreWin2000",
      "DA-A-PwdInDescription",
      "DA-A-PwdPolicy",
      "DA-A-SidHistory",
      "DA-P-AdminCountOrphan",
      "DA-P-ConstrainedDelegation",
      "DA-P-ProtectedUsersGap",
      "DA-P-ProtocolTransition",
      "DA-P-RBCD",
    ],
  );
});

test("ALL_RULES has 32 unique rule ids", () => {
  assert.equal(ALL_RULES.length, 32);
  const ids = ALL_RULES.map((r) => r.id);
  assert.equal(new Set(ids).size, 32);
  assert.ok(!ids.includes("DA-A-DomainScore"));
});

test("DA-A-PwdPolicy: match on short minPwd or lockout 0; skip when unread", () => {
  assert.equal(ruleById("DA-A-PwdPolicy").run(baseCtx()), null);
  assert.equal(
    ruleById("DA-A-PwdPolicy").run(
      baseCtx({ minPwdLength: null, lockoutThreshold: null }),
    ),
    null,
  );

  const short = ruleById("DA-A-PwdPolicy").run(baseCtx({ minPwdLength: 8 }));
  assert.equal(short?.ruleId, "DA-A-PwdPolicy");
  assert.equal(short?.points, 20);

  const lockout = ruleById("DA-A-PwdPolicy").run(
    baseCtx({ minPwdLength: 14, lockoutThreshold: 0 }),
  );
  assert.equal(lockout?.ruleId, "DA-A-PwdPolicy");
});

test("DA-A-LapsCoverage: null schema skips; absent matches; >25% gap matches", () => {
  assert.equal(ruleById("DA-A-LapsCoverage").run(baseCtx({ lapsSchemaPresent: null })), null);

  const absent = ruleById("DA-A-LapsCoverage").run(
    baseCtx({
      lapsSchemaPresent: false,
      computers: [
        computer({ samAccountName: "ws1$", distinguishedName: "CN=ws1,DC=contoso,DC=local" }),
      ],
    }),
  );
  assert.equal(absent?.ruleId, "DA-A-LapsCoverage");
  assert.equal(absent?.points, 15);

  // 1 with LAPS, 3 without → 75% > 25%
  const gap = ruleById("DA-A-LapsCoverage").run(
    baseCtx({
      lapsSchemaPresent: true,
      computers: [
        computer({
          samAccountName: "ok$",
          distinguishedName: "CN=ok,DC=contoso,DC=local",
          lapsPasswordPresent: true,
        }),
        computer({
          samAccountName: "a$",
          distinguishedName: "CN=a,DC=contoso,DC=local",
          lapsPasswordPresent: false,
        }),
        computer({
          samAccountName: "b$",
          distinguishedName: "CN=b,DC=contoso,DC=local",
          lapsPasswordPresent: false,
        }),
        computer({
          samAccountName: "c$",
          distinguishedName: "CN=c,DC=contoso,DC=local",
          lapsPasswordPresent: false,
        }),
        computer({
          samAccountName: "dc$",
          distinguishedName: "CN=dc,DC=contoso,DC=local",
          isDomainController: true,
          lapsPasswordPresent: false,
        }),
      ],
    }),
  );
  assert.equal(gap?.ruleId, "DA-A-LapsCoverage");
  assert.equal(gap?.objectCount, 3);

  // 3 with, 1 without → 25% not greater than 25%
  assert.equal(
    ruleById("DA-A-LapsCoverage").run(
      baseCtx({
        lapsSchemaPresent: true,
        computers: [
          computer({
            samAccountName: "ok1$",
            distinguishedName: "CN=ok1,DC=contoso,DC=local",
            lapsPasswordPresent: true,
          }),
          computer({
            samAccountName: "ok2$",
            distinguishedName: "CN=ok2,DC=contoso,DC=local",
            lapsPasswordPresent: true,
          }),
          computer({
            samAccountName: "ok3$",
            distinguishedName: "CN=ok3,DC=contoso,DC=local",
            lapsPasswordPresent: true,
          }),
          computer({
            samAccountName: "miss$",
            distinguishedName: "CN=miss,DC=contoso,DC=local",
            lapsPasswordPresent: false,
          }),
        ],
      }),
    ),
    null,
  );
});

test("DA-P-ConstrainedDelegation matches non-DC with AllowedToDelegateTo", () => {
  assert.equal(ruleById("DA-P-ConstrainedDelegation").run(baseCtx()), null);
  const finding = ruleById("DA-P-ConstrainedDelegation").run(
    baseCtx({
      users: [
        user({
          samAccountName: "svc",
          distinguishedName: "CN=svc,DC=contoso,DC=local",
          allowedToDelegateTo: ["HTTP/app.contoso.local"],
        }),
      ],
      computers: [
        computer({
          samAccountName: "ws$",
          distinguishedName: "CN=ws,DC=contoso,DC=local",
          allowedToDelegateTo: ["cifs/fs.contoso.local"],
        }),
        computer({
          samAccountName: "dc$",
          distinguishedName: "CN=dc,DC=contoso,DC=local",
          isDomainController: true,
          allowedToDelegateTo: ["ldap/dc.contoso.local"],
        }),
      ],
    }),
  );
  assert.equal(finding?.objectCount, 2);
  assert.equal(finding?.points, 20);
  assert.ok(!finding?.sampleDns.includes("CN=dc,DC=contoso,DC=local"));
});

test("DA-P-ProtocolTransition matches TRUSTED_TO_AUTH_FOR_DELEGATION", () => {
  assert.equal(ruleById("DA-P-ProtocolTransition").run(baseCtx()), null);
  const finding = ruleById("DA-P-ProtocolTransition").run(
    baseCtx({
      users: [
        user({
          samAccountName: "pt",
          distinguishedName: "CN=pt,DC=contoso,DC=local",
          uac: UAC.TRUSTED_TO_AUTH_FOR_DELEGATION,
        }),
      ],
    }),
  );
  assert.equal(finding?.ruleId, "DA-P-ProtocolTransition");
  assert.equal(finding?.points, 25);
  assert.equal(finding?.objectCount, 1);
});

test("DA-P-RBCD matches computers with AllowedToActOnBehalfOf", () => {
  assert.equal(ruleById("DA-P-RBCD").run(baseCtx()), null);
  const finding = ruleById("DA-P-RBCD").run(
    baseCtx({
      computers: [
        computer({
          samAccountName: "dc$",
          distinguishedName: "CN=dc,DC=contoso,DC=local",
          isDomainController: true,
          allowedToActOnBehalfOf: true,
        }),
      ],
    }),
  );
  assert.equal(finding?.ruleId, "DA-P-RBCD");
  assert.equal(finding?.points, 30);
});

test("DA-A-SidHistory matches users with sidHistory", () => {
  assert.equal(ruleById("DA-A-SidHistory").run(baseCtx()), null);
  const finding = ruleById("DA-A-SidHistory").run(
    baseCtx({
      users: [
        user({
          samAccountName: "migrated",
          distinguishedName: "CN=migrated,DC=contoso,DC=local",
          sidHistory: ["S-1-5-21-1-2-3-1001"],
        }),
      ],
    }),
  );
  assert.equal(finding?.ruleId, "DA-A-SidHistory");
  assert.equal(finding?.points, 15);
});

test("DA-P-AdminCountOrphan matches adminCount=1 outside DA/EA/Schema", () => {
  const daDn = "CN=Domain Admins,CN=Users,DC=contoso,DC=local";
  const finding = ruleById("DA-P-AdminCountOrphan").run(
    baseCtx({
      users: [
        user({
          samAccountName: "orphan",
          distinguishedName: "CN=orphan,DC=contoso,DC=local",
          adminCount: 1,
        }),
        user({
          samAccountName: "da1",
          distinguishedName: "CN=da1,DC=contoso,DC=local",
          adminCount: 1,
        }),
        user({
          samAccountName: "disabled",
          distinguishedName: "CN=disabled,DC=contoso,DC=local",
          enabled: false,
          adminCount: 1,
        }),
      ],
      groups: [
        group({
          samAccountName: "Domain Admins",
          distinguishedName: daDn,
          memberDns: ["CN=da1,DC=contoso,DC=local"],
        }),
      ],
    }),
  );
  assert.equal(finding?.ruleId, "DA-P-AdminCountOrphan");
  assert.equal(finding?.objectCount, 1);
  assert.equal(finding?.sampleDns[0], "CN=orphan,DC=contoso,DC=local");
  assert.equal(finding?.points, 15);
});

test("DA-A-PwdInDescription matches password-like description", () => {
  assert.equal(ruleById("DA-A-PwdInDescription").run(baseCtx()), null);
  const finding = ruleById("DA-A-PwdInDescription").run(
    baseCtx({
      users: [
        user({
          samAccountName: "bad",
          distinguishedName: "CN=bad,DC=contoso,DC=local",
          description: "Password: Summer2024!",
        }),
        user({
          samAccountName: "ok",
          distinguishedName: "CN=ok,DC=contoso,DC=local",
          description: "Helpdesk analyst",
        }),
      ],
    }),
  );
  assert.equal(finding?.objectCount, 1);
  assert.equal(finding?.points, 25);
});

test("DA-A-PreWin2000 matches Everyone/Anonymous in Pre-Win2000 group", () => {
  assert.equal(ruleById("DA-A-PreWin2000").run(baseCtx()), null);

  const noBad = ruleById("DA-A-PreWin2000").run(
    baseCtx({
      groups: [
        group({
          samAccountName: "Pre-Windows 2000 Compatible Access",
          distinguishedName:
            "CN=Pre-Windows 2000 Compatible Access,CN=Builtin,DC=contoso,DC=local",
          memberDns: ["CN=Authenticated Users,CN=Builtin,DC=contoso,DC=local"],
        }),
      ],
    }),
  );
  assert.equal(noBad, null);

  const finding = ruleById("DA-A-PreWin2000").run(
    baseCtx({
      groups: [
        group({
          samAccountName: "Pre-Windows 2000 Compatible Access",
          distinguishedName:
            "CN=Pre-Windows 2000 Compatible Access,CN=Builtin,DC=contoso,DC=local",
          memberDns: [
            "CN=S-1-1-0,CN=ForeignSecurityPrincipals,DC=contoso,DC=local",
            "CN=S-1-5-7,CN=ForeignSecurityPrincipals,DC=contoso,DC=local",
          ],
        }),
      ],
    }),
  );
  assert.equal(finding?.ruleId, "DA-A-PreWin2000");
  assert.equal(finding?.points, 30);
  assert.equal(finding?.objectCount, 2);
});

test("DA-A-MachineAccountQuota matches when quota > 0", () => {
  assert.equal(ruleById("DA-A-MachineAccountQuota").run(baseCtx({ machineAccountQuota: 0 })), null);
  assert.equal(
    ruleById("DA-A-MachineAccountQuota").run(baseCtx({ machineAccountQuota: null })),
    null,
  );
  const finding = ruleById("DA-A-MachineAccountQuota").run(
    baseCtx({ machineAccountQuota: 10 }),
  );
  assert.equal(finding?.ruleId, "DA-A-MachineAccountQuota");
  assert.equal(finding?.points, 10);
});

test("DA-A-LdapsNotUsed matches when ldapsConfigured is false", () => {
  assert.equal(ruleById("DA-A-LdapsNotUsed").run(baseCtx({ ldapsConfigured: true })), null);
  const finding = ruleById("DA-A-LdapsNotUsed").run(baseCtx({ ldapsConfigured: false }));
  assert.equal(finding?.ruleId, "DA-A-LdapsNotUsed");
  assert.equal(finding?.points, 15);
});

test("DA-P-ProtectedUsersGap matches enabled DA not in Protected Users", () => {
  const daDn = "CN=Domain Admins,CN=Users,DC=contoso,DC=local";
  const puDn = "CN=Protected Users,CN=Users,DC=contoso,DC=local";

  assert.equal(ruleById("DA-P-ProtectedUsersGap").run(baseCtx()), null);

  const finding = ruleById("DA-P-ProtectedUsersGap").run(
    baseCtx({
      users: [
        user({ samAccountName: "da1", distinguishedName: "CN=da1,DC=contoso,DC=local" }),
        user({ samAccountName: "da2", distinguishedName: "CN=da2,DC=contoso,DC=local" }),
      ],
      groups: [
        group({
          samAccountName: "Domain Admins",
          distinguishedName: daDn,
          memberDns: ["CN=da1,DC=contoso,DC=local", "CN=da2,DC=contoso,DC=local"],
        }),
        group({
          samAccountName: "Protected Users",
          distinguishedName: puDn,
          memberDns: ["CN=da1,DC=contoso,DC=local"],
        }),
      ],
    }),
  );
  assert.equal(finding?.ruleId, "DA-P-ProtectedUsersGap");
  assert.equal(finding?.objectCount, 1);
  assert.equal(finding?.sampleDns[0], "CN=da2,DC=contoso,DC=local");
  assert.equal(finding?.points, 10);

  const allCovered = ruleById("DA-P-ProtectedUsersGap").run(
    baseCtx({
      users: [
        user({ samAccountName: "da1", distinguishedName: "CN=da1,DC=contoso,DC=local" }),
      ],
      groups: [
        group({
          samAccountName: "Domain Admins",
          distinguishedName: daDn,
          memberDns: ["CN=da1,DC=contoso,DC=local"],
        }),
        group({
          samAccountName: "Protected Users",
          distinguishedName: puDn,
          memberDns: ["CN=da1,DC=contoso,DC=local"],
        }),
      ],
    }),
  );
  assert.equal(allCovered, null);
});
