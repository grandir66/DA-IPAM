import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyTemplate,
  collectAdcsExtras,
  CT_ENROLLEE_SUPPLIES_SUBJECT,
  CT_PEND_ALL_REQUESTS,
  EKU_ANY_PURPOSE,
  EKU_CLIENT_AUTH,
} from "../adcs";
import { ALL_RULES, phase6Rules } from "../rules";
import { parseWinrmProbeJson } from "../winrm-probe";
import type { Client } from "ldapts";
import type { RuleContext, WinrmProbeResult } from "../types";

const NOW = new Date("2026-07-26T12:00:00.000Z");

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
  const rule = phase6Rules.find((r) => r.id === id);
  assert.ok(rule, id);
  return rule.run(ctx);
}

function okWinrm(hardening: NonNullable<WinrmProbeResult["hardening"]>): WinrmProbeResult {
  return {
    configured: true,
    status: "ok",
    lastHotfixAt: "2026-07-01T00:00:00.000Z",
    missingCriticalKbs: [],
    cpasswordPaths: [],
    durationMs: 100,
    hardening,
  };
}

test("ALL_RULES has 82 unique rule ids", () => {
  assert.equal(ALL_RULES.length, 82);
  assert.equal(new Set(ALL_RULES.map((r) => r.id)).size, 82);
});

test("classifyTemplate ESC1 on enrollee subject + client auth", () => {
  const t = classifyTemplate({
    name: "Bad",
    distinguishedName: "CN=Bad",
    nameFlags: CT_ENROLLEE_SUPPLIES_SUBJECT,
    enrollmentFlags: 0,
    raSignatures: 0,
    ekus: [EKU_CLIENT_AUTH],
  });
  assert.equal(t.esc1, true);
  assert.equal(t.esc2, false);
});

test("classifyTemplate ESC1 skipped with manager approval", () => {
  const t = classifyTemplate({
    name: "Approved",
    distinguishedName: "CN=Approved",
    nameFlags: CT_ENROLLEE_SUPPLIES_SUBJECT,
    enrollmentFlags: CT_PEND_ALL_REQUESTS,
    raSignatures: 0,
    ekus: [EKU_CLIENT_AUTH],
  });
  assert.equal(t.esc1, false);
});

test("classifyTemplate ESC2 on Any Purpose", () => {
  const t = classifyTemplate({
    name: "Any",
    distinguishedName: "CN=Any",
    nameFlags: 0,
    enrollmentFlags: 0,
    raSignatures: 0,
    ekus: [EKU_ANY_PURPOSE],
  });
  assert.equal(t.esc2, true);
  assert.equal(t.esc1, false);
});

test("parseWinrmProbeJson reads hardening", () => {
  const raw = JSON.stringify({
    lastHotfixAt: null,
    installedKbs: [],
    cpasswordPaths: [],
    hardening: {
      ldapServerIntegrity: 1,
      ldapEnforceChannelBinding: 0,
      smbRequireSecuritySignature: 0,
      lmCompatibilityLevel: 2,
      wdigestUseLogonCredential: 1,
      spoolerRunning: true,
    },
  });
  const p = parseWinrmProbeJson(raw);
  assert.equal(p.hardening.ldapServerIntegrity, 1);
  assert.equal(p.hardening.spoolerRunning, true);
});

test("DA-A-LdapSigningOff fires when integrity < 2", () => {
  const f = run(
    "DA-A-LdapSigningOff",
    baseCtx({
      winrm: okWinrm({
        ldapServerIntegrity: 1,
        ldapEnforceChannelBinding: 2,
        smbRequireSecuritySignature: 1,
        lmCompatibilityLevel: 5,
        wdigestUseLogonCredential: 0,
        spoolerRunning: false,
      }),
    }),
  );
  assert.ok(f);
});

test("DA-A-AdcsEsc1 fires on esc1 names", () => {
  const f = run(
    "DA-A-AdcsEsc1",
    baseCtx({
      adcs: {
        status: "ok",
        templates: [
          {
            name: "Vuln",
            distinguishedName: "CN=Vuln",
            enrolleeSuppliesSubject: true,
            managerApproval: false,
            raSignatures: 0,
            ekus: [EKU_CLIENT_AUTH],
            esc1: true,
            esc2: false,
          },
        ],
        esc1Names: ["Vuln"],
        esc2Names: [],
      },
    }),
  );
  assert.ok(f);
  assert.equal(f!.objectCount, 1);
  assert.equal(f!.diagnostic, true);
  assert.equal(f!.points, 0);
});

test("DA-A-ShadowCredentials fires", () => {
  const f = run(
    "DA-A-ShadowCredentials",
    baseCtx({ shadowCredentialDns: ["CN=u,DC=lab"] }),
  );
  assert.ok(f);
});

test("DA-A-NoPso fires when count is 0", () => {
  const f = run("DA-A-NoPso", baseCtx({ psoCount: 0 }));
  assert.ok(f);
});

test("DA-A-NoPso skips when unread", () => {
  const f = run("DA-A-NoPso", baseCtx({ psoCount: null }));
  assert.equal(f, null);
});

test("AD CS usa il contesto della foresta e incrocia pubblicazione per CN", async () => {
  const dn = "CN=Configuration,DC=forest,DC=local";
  const search = async (base: string) => {
    assert.ok(base.endsWith(dn));
    const searchEntries = base.startsWith("CN=Enrollment Services")
      ? [{ cn: "CA1", certificateTemplates: ["pubblicato"] }]
      : [
          { cn: "Pubblicato", displayName: "Nome visualizzato", distinguishedName: "CN=Pubblicato", "msPKI-Certificate-Name-Flag": "1" },
          { cn: "Sospeso", distinguishedName: "CN=Sospeso", "msPKI-Certificate-Name-Flag": "1" },
        ];
    return { searchEntries };
  };
  const client = { search } as unknown as Client;
  const adcs = await collectAdcsExtras(client, dn);
  assert.deepEqual(adcs.templates.map((t) => t.publishedBy), [["CA1"], []]);
  assert.deepEqual(adcs.esc1Names, ["Nome visualizzato"]);
  assert.deepEqual(adcs.esc2Names, ["Nome visualizzato"]);
  const missingCa = { search: async (base: string) => {
    if (base.startsWith("CN=Enrollment Services")) throw new Error("access denied");
    return search(base);
  } } as unknown as Client;
  const partial = await collectAdcsExtras(missingCa, dn);
  assert.deepEqual(partial.templates.map((t) => t.publishedBy), [null, null]);
  assert.equal(partial.esc1Names.length, 2);
});

test("ESC4 espone i gruppi ampi osservati senza alzare il punteggio", () => {
  const adcs = {
    status: "ok" as const, esc1Names: [], esc2Names: [],
    templates: [{
      ...classifyTemplate({ name: "Test", distinguishedName: "CN=Test", nameFlags: 0, enrollmentFlags: 0, raSignatures: 0, ekus: [EKU_CLIENT_AUTH] }),
      delegation: { ownerSid: "S-1-5-18", enrollSids: [], editSids: ["S-1-5-11"], truncated: false },
    }],
  };
  const f = run("DA-A-AdcsEsc4", baseCtx({ adcs }));
  assert.equal(f?.diagnostic, true);
  assert.equal(f?.points, 0);
  assert.deepEqual(f?.sampleDns, ["CN=Test"]);
});
