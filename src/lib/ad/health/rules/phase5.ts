/**
 * Phase 5: LDAP pack (GPO/sites/trust SID filtering/reversible/DC pwd) + WinRM probes.
 */

import { externalTrusts } from "./trust";
import { aggFinding, daysSince } from "./helpers";
import { hasFlag, UAC } from "../uac";
import {
  DC_HOTFIX_MAX_DAYS,
  DC_PWD_MAX_DAYS,
  TRUST_ATTR_QUARANTINED_DOMAIN,
  type RuleContext,
  type RuleDef,
} from "../types";

export const phase5Rules: RuleDef[] = [
  {
    id: "DA-S-ReversiblePwd",
    axis: "stale",
    points: 30,
    title: "Reversible password encryption enabled",
    run(ctx) {
      const dns = ctx.users
        .filter(
          (u) => u.enabled && hasFlag(u.uac, UAC.ENCRYPTED_TEXT_PWD_ALLOWED),
        )
        .map((u) => u.distinguishedName);
      if (dns.length === 0) return null;
      return aggFinding({
        ruleId: "DA-S-ReversiblePwd",
        axis: "stale",
        points: 30,
        title: "Reversible password encryption enabled",
        description: `${dns.length} enabled user(s) have ENCRYPTED_TEXT_PWD_ALLOWED (reversible storage)`,
        dns,
      });
    },
  },
  {
    id: "DA-S-DcPwdAge",
    axis: "stale",
    points: 20,
    title: "Domain Controller machine password age",
    run(ctx) {
      const dns = ctx.computers
        .filter((c) => c.enabled && c.isDomainController && !c.isRodc)
        .filter((c) => {
          if (c.passwordLastSetAt == null) return true;
          const d = daysSince(c.passwordLastSetAt, ctx.now);
          return d == null || d > DC_PWD_MAX_DAYS;
        })
        .map((c) => c.distinguishedName);
      if (dns.length === 0) return null;
      return aggFinding({
        ruleId: "DA-S-DcPwdAge",
        axis: "stale",
        points: 20,
        title: "Domain Controller machine password age",
        description: `${dns.length} DC(s) with machine password older than ${DC_PWD_MAX_DAYS} days (or never set)`,
        dns,
      });
    },
  },
  {
    id: "DA-T-SidFilteringOff",
    axis: "trust",
    points: 25,
    title: "SID filtering disabled on external trust",
    run(ctx) {
      const bad = externalTrusts(ctx.trusts).filter(
        (t) => ((t.trustAttributes ?? 0) & TRUST_ATTR_QUARANTINED_DOMAIN) === 0,
      );
      if (bad.length === 0) return null;
      return aggFinding({
        ruleId: "DA-T-SidFilteringOff",
        axis: "trust",
        points: 25,
        title: "SID filtering disabled on external trust",
        description:
          `${bad.length} external trust(s) without QUARANTINED_DOMAIN (SID filtering off): ` +
          bad.map((t) => t.name).join(", "),
        dns: bad.map((t) => t.name),
        raw: { trusts: bad },
      });
    },
  },
  {
    id: "DA-A-NoSitesSubnets",
    axis: "anomaly",
    points: 10,
    title: "AD Sites or Subnets missing",
    run(ctx) {
      if (ctx.siteCount == null && ctx.subnetCount == null) return null;
      const sites = ctx.siteCount ?? 0;
      const subnets = ctx.subnetCount ?? 0;
      if (sites > 0 && subnets > 0) return null;
      return aggFinding({
        ruleId: "DA-A-NoSitesSubnets",
        axis: "anomaly",
        points: 10,
        title: "AD Sites or Subnets missing",
        description: `Sites=${sites}, Subnets=${subnets} — incomplete AD topology declaration`,
        dns: [],
        raw: { siteCount: sites, subnetCount: subnets },
      });
    },
  },
  {
    id: "DA-A-GpoOrphanPath",
    axis: "anomaly",
    points: 10,
    title: "GPO without SYSVOL path",
    run(ctx) {
      const gpos = ctx.gpos ?? [];
      const bad = gpos.filter((g) => !g.gpcFileSysPath);
      if (bad.length === 0) return null;
      return aggFinding({
        ruleId: "DA-A-GpoOrphanPath",
        axis: "anomaly",
        points: 10,
        title: "GPO without SYSVOL path",
        description: `${bad.length} GPO(s) missing gPCFileSysPath`,
        dns: bad.map((g) => g.distinguishedName),
      });
    },
  },
  {
    id: "DA-A-WinrmProbeUnavailable",
    axis: "anomaly",
    points: 5,
    title: "WinRM health probe unavailable",
    run(ctx) {
      const w = ctx.winrm;
      if (!w || !w.configured) return null;
      if (w.status !== "unavailable") return null;
      return aggFinding({
        ruleId: "DA-A-WinrmProbeUnavailable",
        axis: "anomaly",
        points: 5,
        title: "WinRM health probe unavailable",
        description: `WinRM configured but probe failed: ${w.errorMessage ?? "unknown"}`,
        dns: [],
        raw: { winrm: w },
      });
    },
  },
  {
    id: "DA-A-DcPatchStale",
    axis: "anomaly",
    points: 20,
    title: "Domain Controller patch age",
    run(ctx) {
      const w = ctx.winrm;
      if (!w || w.status !== "ok") return null;
      if (w.lastHotfixAt == null) {
        return aggFinding({
          ruleId: "DA-A-DcPatchStale",
          axis: "anomaly",
          points: 20,
          title: "Domain Controller patch age",
          description: "No InstalledOn hotfix date readable on DC via WinRM",
          dns: [],
          raw: { missingCriticalKbs: w.missingCriticalKbs },
        });
      }
      const days = daysSince(w.lastHotfixAt, ctx.now);
      if (days == null || days <= DC_HOTFIX_MAX_DAYS) return null;
      return aggFinding({
        ruleId: "DA-A-DcPatchStale",
        axis: "anomaly",
        points: 20,
        title: "Domain Controller patch age",
        description: `Last hotfix on DC is ${days} days old (warn above ${DC_HOTFIX_MAX_DAYS})`,
        dns: [],
        raw: {
          lastHotfixAt: w.lastHotfixAt,
          missingCriticalKbs: w.missingCriticalKbs,
        },
      });
    },
  },
  {
    id: "DA-A-SysvolCpassword",
    axis: "anomaly",
    points: 40,
    title: "GPP cpassword found in SYSVOL",
    run(ctx) {
      const w = ctx.winrm;
      if (!w || w.status !== "ok") return null;
      if (w.cpasswordPaths.length === 0) return null;
      return aggFinding({
        ruleId: "DA-A-SysvolCpassword",
        axis: "anomaly",
        points: 40,
        title: "GPP cpassword found in SYSVOL",
        description: `${w.cpasswordPaths.length} SYSVOL XML path(s) contain cpassword (decryptable credentials)`,
        dns: w.cpasswordPaths,
      });
    },
  },
];
