/**
 * Phase 6: DC hardening (WinRM registry) + ADCS ESC + PSO / shadow credentials.
 */

import { aggFinding } from "./helpers";
import type { RuleContext, RuleDef } from "../types";

function hardening(ctx: RuleContext) {
  const w = ctx.winrm;
  if (!w || w.status !== "ok" || !w.hardening) return null;
  return w.hardening;
}

export const phase6Rules: RuleDef[] = [
  {
    id: "DA-A-LdapSigningOff",
    axis: "anomaly",
    points: 25,
    title: "LDAP signing not required on DC",
    run(ctx) {
      const h = hardening(ctx);
      if (!h || h.ldapServerIntegrity == null) return null;
      // 2 = Require signing
      if (h.ldapServerIntegrity >= 2) return null;
      return aggFinding({
        ruleId: "DA-A-LdapSigningOff",
        axis: "anomaly",
        points: 25,
        title: "LDAP signing not required on DC",
        description: `LDAPServerIntegrity=${h.ldapServerIntegrity} (recommend 2=Require)`,
        dns: [],
        raw: { ldapServerIntegrity: h.ldapServerIntegrity },
      });
    },
  },
  {
    id: "DA-A-LdapChannelBindingOff",
    axis: "anomaly",
    points: 25,
    title: "LDAP channel binding not enforced",
    run(ctx) {
      const h = hardening(ctx);
      if (!h || h.ldapEnforceChannelBinding == null) return null;
      // 0 = Never
      if (h.ldapEnforceChannelBinding > 0) return null;
      return aggFinding({
        ruleId: "DA-A-LdapChannelBindingOff",
        axis: "anomaly",
        points: 25,
        title: "LDAP channel binding not enforced",
        description: `LDAPEnforceChannelBinding=${h.ldapEnforceChannelBinding} (0=Never)`,
        dns: [],
        raw: { ldapEnforceChannelBinding: h.ldapEnforceChannelBinding },
      });
    },
  },
  {
    id: "DA-A-SmbSigningOff",
    axis: "anomaly",
    points: 20,
    title: "SMB signing not required on DC",
    run(ctx) {
      const h = hardening(ctx);
      if (!h || h.smbRequireSecuritySignature == null) return null;
      if (h.smbRequireSecuritySignature !== 0) return null;
      return aggFinding({
        ruleId: "DA-A-SmbSigningOff",
        axis: "anomaly",
        points: 20,
        title: "SMB signing not required on DC",
        description: "LanmanServer RequireSecuritySignature=0",
        dns: [],
        raw: { smbRequireSecuritySignature: h.smbRequireSecuritySignature },
      });
    },
  },
  {
    id: "DA-A-NtlmV1Allowed",
    axis: "anomaly",
    points: 25,
    title: "NTLMv1 / LM compatibility allows weak auth",
    run(ctx) {
      const h = hardening(ctx);
      if (!h || h.lmCompatibilityLevel == null) return null;
      // < 3 allows NTLMv1 / LM responses
      if (h.lmCompatibilityLevel >= 3) return null;
      return aggFinding({
        ruleId: "DA-A-NtlmV1Allowed",
        axis: "anomaly",
        points: 25,
        title: "NTLMv1 / LM compatibility allows weak auth",
        description: `LmCompatibilityLevel=${h.lmCompatibilityLevel} (recommend ≥3)`,
        dns: [],
        raw: { lmCompatibilityLevel: h.lmCompatibilityLevel },
      });
    },
  },
  {
    id: "DA-A-WdigestEnabled",
    axis: "anomaly",
    points: 30,
    title: "WDigest UseLogonCredential enabled",
    run(ctx) {
      const h = hardening(ctx);
      if (!h || h.wdigestUseLogonCredential == null) return null;
      if (h.wdigestUseLogonCredential !== 1) return null;
      return aggFinding({
        ruleId: "DA-A-WdigestEnabled",
        axis: "anomaly",
        points: 30,
        title: "WDigest UseLogonCredential enabled",
        description: "WDigest stores cleartext credentials in memory when UseLogonCredential=1",
        dns: [],
        raw: { wdigestUseLogonCredential: h.wdigestUseLogonCredential },
      });
    },
  },
  {
    id: "DA-A-SpoolerOnDc",
    axis: "anomaly",
    points: 15,
    title: "Print Spooler running on Domain Controller",
    run(ctx) {
      const h = hardening(ctx);
      if (!h || h.spoolerRunning == null) return null;
      if (!h.spoolerRunning) return null;
      return aggFinding({
        ruleId: "DA-A-SpoolerOnDc",
        axis: "anomaly",
        points: 15,
        title: "Print Spooler running on Domain Controller",
        description: "Spooler service is Running on DC (PrintNightmare / lateral movement surface)",
        dns: [],
      });
    },
  },
  {
    id: "DA-A-AdcsEsc1",
    axis: "anomaly",
    points: 40,
    title: "ADCS ESC1 misconfigured certificate template",
    run(ctx) {
      const adcs = ctx.adcs;
      if (!adcs || adcs.status !== "ok") return null;
      if (adcs.esc1Names.length === 0) return null;
      return aggFinding({
        ruleId: "DA-A-AdcsEsc1",
        axis: "anomaly",
        points: 40,
        title: "ADCS ESC1 misconfigured certificate template",
        description:
          `${adcs.esc1Names.length} template(s) allow enrollee-supplied subject + auth EKU without approval: ` +
          adcs.esc1Names.slice(0, 10).join(", "),
        dns: adcs.templates.filter((t) => t.esc1).map((t) => t.distinguishedName),
        raw: { esc1Names: adcs.esc1Names },
      });
    },
  },
  {
    id: "DA-A-AdcsEsc2",
    axis: "anomaly",
    points: 25,
    title: "ADCS ESC2 Any Purpose / empty EKU template",
    run(ctx) {
      const adcs = ctx.adcs;
      if (!adcs || adcs.status !== "ok") return null;
      if (adcs.esc2Names.length === 0) return null;
      return aggFinding({
        ruleId: "DA-A-AdcsEsc2",
        axis: "anomaly",
        points: 25,
        title: "ADCS ESC2 Any Purpose / empty EKU template",
        description:
          `${adcs.esc2Names.length} template(s) with Any Purpose or empty EKU: ` +
          adcs.esc2Names.slice(0, 10).join(", "),
        dns: adcs.templates.filter((t) => t.esc2).map((t) => t.distinguishedName),
        raw: { esc2Names: adcs.esc2Names },
      });
    },
  },
  {
    id: "DA-A-ShadowCredentials",
    axis: "anomaly",
    points: 30,
    title: "Shadow credentials (KeyCredentialLink) present",
    run(ctx) {
      const dns = ctx.shadowCredentialDns ?? [];
      if (dns.length === 0) return null;
      return aggFinding({
        ruleId: "DA-A-ShadowCredentials",
        axis: "anomaly",
        points: 30,
        title: "Shadow credentials (KeyCredentialLink) present",
        description: `${dns.length} user(s) have msDS-KeyCredentialLink set (verify legitimate Entra/hybrid usage)`,
        dns,
      });
    },
  },
  {
    id: "DA-A-NoPso",
    axis: "anomaly",
    points: 5,
    title: "No fine-grained Password Settings Objects",
    run(ctx) {
      if (ctx.psoCount == null) return null;
      if (ctx.psoCount > 0) return null;
      return aggFinding({
        ruleId: "DA-A-NoPso",
        axis: "anomaly",
        points: 5,
        title: "No fine-grained Password Settings Objects",
        description:
          "No msDS-PasswordSettings found — privileged accounts share domain password policy",
        dns: [],
        raw: { psoCount: 0 },
      });
    },
  },
];
