import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_RULES, auditRules } from "../rules";
import type { RuleContext, WinrmProbeResult } from "../types";

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

function winrm(partial: Partial<WinrmProbeResult> = {}): WinrmProbeResult {
  return {
    configured: true,
    status: "ok",
    lastHotfixAt: "2026-07-01T00:00:00.000Z",
    missingCriticalKbs: [],
    cpasswordPaths: [],
    durationMs: 10,
    ...partial,
  };
}

function run(id: string, ctx: RuleContext) {
  const rule = auditRules.find((r) => r.id === id);
  assert.ok(rule, id);
  return rule.run(ctx);
}

test("ALL_RULES includes the audit rules", () => {
  assert.ok(auditRules.every((r) => ALL_RULES.some((a) => a.id === r.id)));
});

test("DA-A-AuditPolicyGaps reports the switched-off subcategories", () => {
  const f = run(
    "DA-A-AuditPolicyGaps",
    baseCtx({
      winrm: winrm({
        auditGaps: [
          {
            guid: "0CCE9237-69AE-11D9-BED3-505054503030",
            labelIt: "Gestione gruppi di sicurezza",
            needs: "success",
            eventIds: ["4728", "4732", "4756"],
            why: "…",
            current: "none",
          },
        ],
      }),
    }),
  );
  assert.ok(f);
  assert.equal(f!.objectCount, 1);
  assert.ok(f!.description.includes("Gestione gruppi di sicurezza"));
  assert.ok(f!.description.includes("4728"));
});

test("no gaps means no finding", () => {
  assert.equal(run("DA-A-AuditPolicyGaps", baseCtx({ winrm: winrm({ auditGaps: [] }) })), null);
});

test("auditpol not read is silence, not a finding", () => {
  // null = non abbiamo letto la policy: concludere "audit spento" sarebbe inventare
  assert.equal(run("DA-A-AuditPolicyGaps", baseCtx({ winrm: winrm({ auditGaps: null }) })), null);
  assert.equal(run("DA-A-AuditPolicyGaps", baseCtx({ winrm: winrm() })), null);
});

test("without a WinRM probe the rule stays quiet", () => {
  assert.equal(run("DA-A-AuditPolicyGaps", baseCtx()), null);
  assert.equal(
    run("DA-A-AuditPolicyGaps", baseCtx({ winrm: winrm({ status: "unavailable" }) })),
    null,
  );
});

// ── Correlazione con gli alert Wazuh ────────────────────────────────────────

import { phase2Rules } from "../rules";
import type { WazuhSignals } from "../wazuh-signals";

function signals(partial: Partial<WazuhSignals> = {}): WazuhSignals {
  return {
    available: true,
    windowDays: 7,
    authFailureOccurrences: 0,
    authFailureTargets: [],
    lockoutOccurrences: 0,
    ...partial,
  };
}

test("DA-A-BruteForceActivity fires on sustained failed logons", () => {
  const f = run(
    "DA-A-BruteForceActivity",
    baseCtx({
      wazuh: signals({
        authFailureOccurrences: 1500,
        authFailureTargets: [
          { targetUser: "amministratore", agentName: "SRV-DC", occurrences: 1200, lastSeenAt: "2026-07-27T10:00:00Z" },
        ],
      }),
    }),
  );
  assert.ok(f);
  assert.ok(f!.description.includes("1500"));
  assert.ok(f!.description.includes("amministratore"));
});

test("without Wazuh data the correlation rule stays quiet", () => {
  assert.equal(run("DA-A-BruteForceActivity", baseCtx()), null);
  assert.equal(
    run("DA-A-BruteForceActivity", baseCtx({ wazuh: signals({ available: false }) })),
    null,
  );
});

test("a handful of failures is normal noise, not a finding", () => {
  assert.equal(
    run("DA-A-BruteForceActivity", baseCtx({ wazuh: signals({ authFailureOccurrences: 3 }) })),
    null,
  );
});

test("PwdPolicy says out loud that lockout is off while attacks are running", () => {
  const rule = phase2Rules.find((r) => r.id === "DA-A-PwdPolicy")!;
  const f = rule.run(
    baseCtx({
      lockoutThreshold: 0,
      wazuh: signals({ authFailureOccurrences: 1500, lockoutOccurrences: 0 }),
    }),
  );
  assert.ok(f);
  assert.ok(/1500/.test(f!.description));
  assert.ok(/nessun account.*bloccat/i.test(f!.description));
});

test("PwdPolicy keeps its plain wording when there is no Wazuh evidence", () => {
  const rule = phase2Rules.find((r) => r.id === "DA-A-PwdPolicy")!;
  const f = rule.run(baseCtx({ lockoutThreshold: 0 }));
  assert.ok(f);
  assert.ok(!/1500/.test(f!.description));
});
