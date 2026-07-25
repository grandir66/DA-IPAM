import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_RULES, phase4Rules } from "../rules";
import type { AclExtras } from "../acl/types";
import type { RuleContext } from "../types";

function baseCtx(acl?: AclExtras | null): RuleContext {
  return {
    now: new Date("2026-07-26T00:00:00.000Z"),
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
    acl: acl ?? null,
  };
}

function runRule(id: string, ctx: RuleContext) {
  const rule = phase4Rules.find((r) => r.id === id);
  assert.ok(rule, id);
  return rule.run(ctx);
}

test("ALL_RULES has 36 unique rule ids", () => {
  assert.equal(ALL_RULES.length, 36);
  assert.equal(new Set(ALL_RULES.map((r) => r.id)).size, 36);
});

test("DA-P-DCSyncRights fires on unexpected GenericAll domain ACE", () => {
  const acl: AclExtras = {
    meta: {
      status: "ok",
      objectsScanned: 1,
      sdParsed: 1,
      interestingAceCount: 1,
      truncated: false,
      timedOut: false,
      durationMs: 10,
    },
    domainSid: "S-1-5-21-1-2-3-4",
    interestingAces: [
      {
        objectDn: "DC=lab,DC=local",
        objectKind: "domain",
        trusteeSid: "S-1-5-21-1-2-3-1111",
        trusteeSam: "svc-bad",
        rights: ["GenericAll"],
        aceType: "allowed",
        inherited: false,
      },
    ],
  };
  const f = runRule("DA-P-DCSyncRights", baseCtx(acl));
  assert.ok(f);
  assert.equal(f!.points, 40);
  assert.ok(f!.sampleDns.includes("svc-bad"));
});

test("DA-A-AdminSDHolderAce fires", () => {
  const acl: AclExtras = {
    meta: {
      status: "ok",
      objectsScanned: 1,
      sdParsed: 1,
      interestingAceCount: 1,
      truncated: false,
      timedOut: false,
      durationMs: 1,
    },
    domainSid: null,
    interestingAces: [
      {
        objectDn: "CN=AdminSDHolder,CN=System,DC=lab,DC=local",
        objectKind: "adminsdholder",
        trusteeSid: "S-1-5-21-1-2-3-2222",
        trusteeSam: "backdoor",
        rights: ["WriteDacl"],
        aceType: "allowed",
        inherited: false,
      },
    ],
  };
  assert.ok(runRule("DA-A-AdminSDHolderAce", baseCtx(acl)));
});

test("DA-A-AclCollectPartial fires when unavailable", () => {
  const acl: AclExtras = {
    meta: {
      status: "unavailable",
      objectsScanned: 0,
      sdParsed: 0,
      interestingAceCount: 0,
      truncated: false,
      timedOut: false,
      errorMessage: "ACL unreadable",
      durationMs: 1,
    },
    domainSid: null,
    interestingAces: [],
  };
  const f = runRule("DA-A-AclCollectPartial", baseCtx(acl));
  assert.ok(f);
  // DCSync must not fire when unavailable
  assert.equal(runRule("DA-P-DCSyncRights", baseCtx(acl)), null);
});

test("DA-P-DangerousAcl fires on user GenericAll", () => {
  const acl: AclExtras = {
    meta: {
      status: "ok",
      objectsScanned: 2,
      sdParsed: 2,
      interestingAceCount: 1,
      truncated: false,
      timedOut: false,
      durationMs: 1,
    },
    domainSid: null,
    interestingAces: [
      {
        objectDn: "CN=alice,CN=Users,DC=lab,DC=local",
        objectKind: "user",
        trusteeSid: "S-1-5-21-1-2-3-3333",
        trusteeSam: "helpdesk",
        rights: ["GenericAll"],
        aceType: "allowed",
        inherited: false,
      },
    ],
  };
  const f = runRule("DA-P-DangerousAcl", baseCtx(acl));
  assert.ok(f);
  assert.equal(f!.objectCount, 1);
});
