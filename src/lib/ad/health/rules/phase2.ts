/**
 * Phase 2 ADPulse-inspired rules (DA-* Domarc IDs only).
 */

import type { AdGroupRow, AdUserRow, RuleContext, RuleDef } from "../types";
import { hasFlag, UAC } from "../uac";
import { resolveDomainAdminUsers } from "./privileged";
import { aggFinding } from "./helpers";

const PWD_IN_DESC_RE = /(password|pwd|passw|passwd)\s*[:=]/i;
const PRE_WIN2000_RE = /pre-windows\s*2000\s*compatible\s*access/i;
const PROTECTED_USERS_RE = /^protected users$/i;
const EA_NAME = "enterprise admins";
const SCHEMA_ADMINS_NAME = "schema admins";

const SCHEMA_ADMINS_RID = 518;
const ENTERPRISE_ADMINS_RID = 519;

function groupByDn(groups: AdGroupRow[]): Map<string, AdGroupRow> {
  const m = new Map<string, AdGroupRow>();
  for (const g of groups) m.set(g.distinguishedName.toLowerCase(), g);
  return m;
}

function userByDn(users: AdUserRow[]): Map<string, AdUserRow> {
  const m = new Map<string, AdUserRow>();
  for (const u of users) m.set(u.distinguishedName.toLowerCase(), u);
  return m;
}

function groupCn(g: AdGroupRow): string {
  const cn = g.distinguishedName.split(",")[0]?.replace(/^CN=/i, "").trim() ?? "";
  return cn;
}

function isNamedGroup(g: AdGroupRow, nameLower: string): boolean {
  if (g.samAccountName.toLowerCase() === nameLower) return true;
  return groupCn(g).toLowerCase() === nameLower;
}

/** Expand named privileged group members (nested ≤2) + matching primaryGroupID RID. */
function resolveNamedGroupUsers(
  ctx: RuleContext,
  nameLower: string,
  primaryGroupRid: number | null,
): AdUserRow[] {
  const groups = groupByDn(ctx.groups);
  const users = userByDn(ctx.users);
  const seenUserDns = new Set<string>();
  const result: AdUserRow[] = [];

  const root = ctx.groups.find((g) => isNamedGroup(g, nameLower));
  if (root) {
    type QueueItem = { dn: string; depth: number };
    const queue: QueueItem[] = root.memberDns.map((dn) => ({ dn, depth: 1 }));
    const seenGroupDns = new Set<string>([root.distinguishedName.toLowerCase()]);

    while (queue.length > 0) {
      const { dn, depth } = queue.shift()!;
      const key = dn.toLowerCase();

      const user = users.get(key);
      if (user) {
        if (!seenUserDns.has(key)) {
          seenUserDns.add(key);
          result.push(user);
        }
        continue;
      }

      const nested = groups.get(key);
      if (!nested) continue;
      if (seenGroupDns.has(key)) continue;
      seenGroupDns.add(key);
      if (depth >= 2) continue;
      for (const child of nested.memberDns) {
        queue.push({ dn: child, depth: depth + 1 });
      }
    }
  }

  if (primaryGroupRid != null) {
    for (const u of ctx.users) {
      if (u.primaryGroupId !== primaryGroupRid) continue;
      const key = u.distinguishedName.toLowerCase();
      if (seenUserDns.has(key)) continue;
      seenUserDns.add(key);
      result.push(u);
    }
  }

  return result;
}

function privilegedAdminDns(ctx: RuleContext): Set<string> {
  const dns = new Set<string>();
  for (const u of resolveDomainAdminUsers(ctx)) {
    dns.add(u.distinguishedName.toLowerCase());
  }
  for (const u of resolveNamedGroupUsers(ctx, EA_NAME, ENTERPRISE_ADMINS_RID)) {
    dns.add(u.distinguishedName.toLowerCase());
  }
  for (const u of resolveNamedGroupUsers(ctx, SCHEMA_ADMINS_NAME, SCHEMA_ADMINS_RID)) {
    dns.add(u.distinguishedName.toLowerCase());
  }
  return dns;
}

function isEveryoneOrAnonymousDn(dn: string): boolean {
  const lower = dn.toLowerCase();
  if (lower.includes("s-1-1-0")) return true;
  if (lower.includes("s-1-5-7")) return true;
  if (/cn=everyone(,|$)/i.test(dn)) return true;
  if (/cn=anonymous logon(,|$)/i.test(dn)) return true;
  return false;
}

function findGroupByName(ctx: RuleContext, re: RegExp): AdGroupRow | undefined {
  return ctx.groups.find((g) => re.test(g.samAccountName) || re.test(groupCn(g)));
}

function protectedUsersMemberDns(ctx: RuleContext): Set<string> {
  const g = findGroupByName(ctx, PROTECTED_USERS_RE);
  if (!g) return new Set();
  return new Set(g.memberDns.map((dn) => dn.toLowerCase()));
}

export const phase2Rules: RuleDef[] = [
  {
    id: "DA-A-PwdPolicy",
    axis: "anomaly",
    points: 20,
    title: "Weak domain password policy",
    run(ctx) {
      const issues: string[] = [];
      if (ctx.minPwdLength != null && ctx.minPwdLength < 12) {
        issues.push(`minPwdLength=${ctx.minPwdLength} (< 12)`);
      }
      if (ctx.lockoutThreshold != null && ctx.lockoutThreshold === 0) {
        issues.push("lockoutThreshold=0 (lockout disabled)");
      }
      if (issues.length === 0) return null;

      // Incrocio con gli alert Wazuh: la soglia a zero e' una configurazione,
      // ma "zero account bloccati mentre sono in corso N tentativi falliti" e'
      // la prova che quella configurazione sta gia' facendo danno.
      const w = ctx.wazuh;
      const bruteForceEvidence =
        ctx.lockoutThreshold === 0 &&
        w?.available &&
        w.authFailureOccurrences > 0 &&
        w.lockoutOccurrences === 0
          ? ` Negli ultimi ${w.windowDays} giorni Wazuh ha registrato ` +
            `${w.authFailureOccurrences} tentativi di autenticazione falliti e ` +
            `nessun account bloccato: con la soglia a zero il dominio non oppone ` +
            `alcuna resistenza a un attacco a forza bruta.`
          : "";

      return aggFinding({
        ruleId: "DA-A-PwdPolicy",
        axis: "anomaly",
        points: 20,
        title: "Weak domain password policy",
        description: `Domain password policy issues: ${issues.join("; ")}.${bruteForceEvidence}`,
        dns: [ctx.domainFqdn],
        raw: {
          minPwdLength: ctx.minPwdLength,
          lockoutThreshold: ctx.lockoutThreshold,
          ...(bruteForceEvidence
            ? {
                wazuhAuthFailures: w?.authFailureOccurrences,
                wazuhLockouts: w?.lockoutOccurrences,
              }
            : {}),
        },
      });
    },
  },
  {
    id: "DA-A-LapsCoverage",
    axis: "anomaly",
    points: 15,
    title: "LAPS coverage gap",
    run(ctx) {
      if (ctx.lapsSchemaPresent == null) return null;

      const nonDc = ctx.computers.filter((c) => !c.isDomainController);
      if (ctx.lapsSchemaPresent === false) {
        return aggFinding({
          ruleId: "DA-A-LapsCoverage",
          axis: "anomaly",
          points: 15,
          title: "LAPS coverage gap",
          description: "LAPS schema absent or no LAPS passwords readable on computers",
          dns: nonDc.slice(0, 50).map((c) => c.distinguishedName),
          raw: { lapsSchemaPresent: false, nonDcCount: nonDc.length },
        });
      }

      const considered = nonDc.filter((c) => c.lapsPasswordPresent !== null);
      if (considered.length === 0) return null;
      const missing = considered.filter((c) => c.lapsPasswordPresent === false);
      const ratio = missing.length / considered.length;
      if (ratio <= 0.25) return null;
      return aggFinding({
        ruleId: "DA-A-LapsCoverage",
        axis: "anomaly",
        points: 15,
        title: "LAPS coverage gap",
        description: `${missing.length}/${considered.length} non-DC computer(s) without LAPS password (>25%)`,
        dns: missing.map((c) => c.distinguishedName),
        raw: { missing: missing.length, considered: considered.length, ratio },
      });
    },
  },
  {
    id: "DA-P-ConstrainedDelegation",
    axis: "privileged",
    points: 20,
    title: "Constrained delegation",
    run(ctx) {
      const userDns = ctx.users
        .filter((u) => (u.allowedToDelegateTo?.length ?? 0) > 0)
        .map((u) => u.distinguishedName);
      const computerDns = ctx.computers
        .filter(
          (c) =>
            !c.isDomainController && (c.allowedToDelegateTo?.length ?? 0) > 0,
        )
        .map((c) => c.distinguishedName);
      const dns = [...userDns, ...computerDns];
      if (dns.length === 0) return null;
      return aggFinding({
        ruleId: "DA-P-ConstrainedDelegation",
        axis: "privileged",
        points: 20,
        title: "Constrained delegation",
        description: `${dns.length} account(s) with msDS-AllowedToDelegateTo (Domain Controllers excluded)`,
        dns,
      });
    },
  },
  {
    id: "DA-P-ProtocolTransition",
    axis: "privileged",
    points: 25,
    title: "Protocol transition delegation",
    run(ctx) {
      const userDns = ctx.users
        .filter((u) => hasFlag(u.uac, UAC.TRUSTED_TO_AUTH_FOR_DELEGATION))
        .map((u) => u.distinguishedName);
      const computerDns = ctx.computers
        .filter((c) => hasFlag(c.uac, UAC.TRUSTED_TO_AUTH_FOR_DELEGATION))
        .map((c) => c.distinguishedName);
      const dns = [...userDns, ...computerDns];
      if (dns.length === 0) return null;
      return aggFinding({
        ruleId: "DA-P-ProtocolTransition",
        axis: "privileged",
        points: 25,
        title: "Protocol transition delegation",
        description: `${dns.length} account(s) with TRUSTED_TO_AUTH_FOR_DELEGATION (0x1000000)`,
        dns,
      });
    },
  },
  {
    id: "DA-P-RBCD",
    axis: "privileged",
    points: 30,
    title: "Resource-based constrained delegation",
    run(ctx) {
      const dns = ctx.computers
        .filter((c) => c.allowedToActOnBehalfOf)
        .map((c) => c.distinguishedName);
      if (dns.length === 0) return null;
      return aggFinding({
        ruleId: "DA-P-RBCD",
        axis: "privileged",
        points: 30,
        title: "Resource-based constrained delegation",
        description: `${dns.length} computer(s) with msDS-AllowedToActOnBehalfOfOtherIdentity set`,
        dns,
      });
    },
  },
  {
    id: "DA-A-SidHistory",
    axis: "anomaly",
    points: 15,
    title: "Accounts with SID history",
    run(ctx) {
      const dns = ctx.users
        .filter((u) => (u.sidHistory?.length ?? 0) > 0)
        .map((u) => u.distinguishedName);
      if (dns.length === 0) return null;
      return aggFinding({
        ruleId: "DA-A-SidHistory",
        axis: "anomaly",
        points: 15,
        title: "Accounts with SID history",
        description: `${dns.length} user account(s) with sIDHistory populated`,
        dns,
      });
    },
  },
  {
    id: "DA-P-AdminCountOrphan",
    axis: "privileged",
    points: 15,
    title: "Orphan adminCount users",
    run(ctx) {
      const privileged = privilegedAdminDns(ctx);
      const dns = ctx.users
        .filter(
          (u) =>
            u.enabled &&
            u.adminCount === 1 &&
            !privileged.has(u.distinguishedName.toLowerCase()),
        )
        .map((u) => u.distinguishedName);
      if (dns.length === 0) return null;
      return aggFinding({
        ruleId: "DA-P-AdminCountOrphan",
        axis: "privileged",
        points: 15,
        title: "Orphan adminCount users",
        description: `${dns.length} enabled user(s) with adminCount=1 not in Domain/Enterprise/Schema Admins`,
        dns,
      });
    },
  },
  {
    id: "DA-A-PwdInDescription",
    axis: "anomaly",
    points: 25,
    title: "Password-like text in description",
    run(ctx) {
      const dns = ctx.users
        .filter((u) => u.description != null && PWD_IN_DESC_RE.test(u.description))
        .map((u) => u.distinguishedName);
      if (dns.length === 0) return null;
      return aggFinding({
        ruleId: "DA-A-PwdInDescription",
        axis: "anomaly",
        points: 25,
        title: "Password-like text in description",
        description: `${dns.length} user(s) with password-like pattern in description`,
        dns,
      });
    },
  },
  {
    id: "DA-A-PreWin2000",
    axis: "anomaly",
    points: 30,
    title: "Pre-Windows 2000 Compatible Access risk",
    run(ctx) {
      const g = findGroupByName(ctx, PRE_WIN2000_RE);
      if (!g) return null;
      const bad = g.memberDns.filter(isEveryoneOrAnonymousDn);
      if (bad.length === 0) return null;
      return aggFinding({
        ruleId: "DA-A-PreWin2000",
        axis: "anomaly",
        points: 30,
        title: "Pre-Windows 2000 Compatible Access risk",
        description:
          "Pre-Windows 2000 Compatible Access contains Everyone and/or Anonymous Logon",
        dns: bad,
        raw: { groupDn: g.distinguishedName },
      });
    },
  },
  {
    id: "DA-A-MachineAccountQuota",
    axis: "anomaly",
    points: 10,
    title: "Machine account quota enabled",
    run(ctx) {
      if (ctx.machineAccountQuota == null) return null;
      if (ctx.machineAccountQuota <= 0) return null;
      return aggFinding({
        ruleId: "DA-A-MachineAccountQuota",
        axis: "anomaly",
        points: 10,
        title: "Machine account quota enabled",
        description: `ms-DS-MachineAccountQuota=${ctx.machineAccountQuota} (> 0)`,
        dns: [ctx.domainFqdn],
        raw: { machineAccountQuota: ctx.machineAccountQuota },
      });
    },
  },
  {
    id: "DA-A-LdapsNotUsed",
    axis: "anomaly",
    points: 15,
    title: "LDAPS not configured",
    run(ctx) {
      if (ctx.ldapsConfigured) return null;
      return aggFinding({
        ruleId: "DA-A-LdapsNotUsed",
        axis: "anomaly",
        points: 15,
        title: "LDAPS not configured",
        description: `AD integration for ${ctx.domainFqdn} does not force LDAPS (use_ssl=0)`,
        dns: [ctx.domainFqdn],
      });
    },
  },
  {
    id: "DA-P-ProtectedUsersGap",
    axis: "privileged",
    points: 10,
    title: "Domain Admins not in Protected Users",
    run(ctx) {
      const pu = protectedUsersMemberDns(ctx);
      // If Protected Users group missing from inventory, skip (unknown)
      if (!findGroupByName(ctx, PROTECTED_USERS_RE)) return null;
      const dns = resolveDomainAdminUsers(ctx)
        .filter((u) => u.enabled && !pu.has(u.distinguishedName.toLowerCase()))
        .map((u) => u.distinguishedName);
      if (dns.length === 0) return null;
      return aggFinding({
        ruleId: "DA-P-ProtectedUsersGap",
        axis: "privileged",
        points: 10,
        title: "Domain Admins not in Protected Users",
        description: `${dns.length} enabled Domain Admin(s) not in Protected Users`,
        dns,
      });
    },
  },
];
