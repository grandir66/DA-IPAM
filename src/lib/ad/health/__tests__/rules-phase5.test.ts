import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_RULES, phase5Rules } from "../rules";
import { UAC } from "../uac";
import { missingCriticalKbs, parseWinrmProbeJson } from "../winrm-probe";
import type { AdComputerRow, AdUserRow, RuleContext, WinrmProbeResult } from "../types";

const NOW = new Date("2026-07-26T12:00:00.000Z");

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

function computer(
  partial: Partial<AdComputerRow> & Pick<AdComputerRow, "samAccountName" | "distinguishedName">,
): AdComputerRow {
  return {
    enabled: true,
    lastLogonAt: null,
    passwordLastSetAt: null,
    operatingSystem: "Windows Server 2019",
    uac: 0,
    isDomainController: false,
    isRodc: false,
    allowedToDelegateTo: [],
    allowedToActOnBehalfOf: false,
    lapsPasswordPresent: null,
    ...partial,
  };
}

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
  const rule = phase5Rules.find((r) => r.id === id);
  assert.ok(rule, id);
  return rule.run(ctx);
}

test("ALL_RULES includes phase5 rules", () => {
  assert.ok(ALL_RULES.length >= 44);
  assert.ok(phase5Rules.every((r) => ALL_RULES.some((a) => a.id === r.id)));
});

test("DA-S-ReversiblePwd fires on UAC bit", () => {
  const f = run(
    "DA-S-ReversiblePwd",
    baseCtx({
      users: [
        user({
          samAccountName: "rev",
          distinguishedName: "CN=rev,DC=lab",
          uac: UAC.ENCRYPTED_TEXT_PWD_ALLOWED,
        }),
      ],
    }),
  );
  assert.ok(f);
  assert.equal(f!.points, 30);
});

test("DA-S-DcPwdAge fires for old DC password", () => {
  const f = run(
    "DA-S-DcPwdAge",
    baseCtx({
      computers: [
        computer({
          samAccountName: "DC01$",
          distinguishedName: "CN=DC01,OU=Domain Controllers,DC=lab",
          isDomainController: true,
          passwordLastSetAt: "2025-01-01T00:00:00.000Z",
        }),
      ],
    }),
  );
  assert.ok(f);
});

test("DA-T-SidFilteringOff fires when quarantine bit missing", () => {
  const f = run(
    "DA-T-SidFilteringOff",
    baseCtx({
      trusts: [
        { name: "ext.local", trustDirection: 3, trustType: 2, trustAttributes: 0 },
      ],
    }),
  );
  assert.ok(f);
  assert.equal(f!.points, 25);
});

test("DA-A-SysvolCpassword fires when paths present", () => {
  const winrm: WinrmProbeResult = {
    configured: true,
    status: "ok",
    lastHotfixAt: "2026-07-01T00:00:00.000Z",
    missingCriticalKbs: [],
    cpasswordPaths: ["\\\\lab\\SYSVOL\\lab\\Policies\\{x}\\Machine\\Preferences\\Groups\\Groups.xml"],
    durationMs: 10,
  };
  const f = run("DA-A-SysvolCpassword", baseCtx({ winrm }));
  assert.ok(f);
  assert.equal(f!.points, 40);
});

test("parseWinrmProbeJson + missingCriticalKbs", () => {
  const parsed = parseWinrmProbeJson(
    '{"lastHotfixAt":"2026-01-01T00:00:00.000Z","installedKbs":["KB123"],"cpasswordPaths":[]}',
  );
  assert.equal(parsed.installedKbs.length, 1);
  assert.ok(missingCriticalKbs(parsed.installedKbs).includes("KB3011780"));
});
