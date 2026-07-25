import { DOMAIN_ADMINS_RID } from "@/lib/ad/ldap-utils";
import { THRESHOLDS } from "../thresholds";
import type { AdGroupRow, AdUserRow, RuleContext, RuleDef } from "../types";
import { hasFlag, UAC } from "../uac";
import { aggFinding, daysSince } from "./helpers";

const DA_NAME = "domain admins";

function isDomainAdminsGroup(g: AdGroupRow): boolean {
  if (g.samAccountName.toLowerCase() === DA_NAME) return true;
  const cn = g.distinguishedName.split(",")[0]?.replace(/^CN=/i, "").trim();
  return cn?.toLowerCase() === DA_NAME;
}

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

/**
 * Expand Domain Admins members up to 2 levels of nesting (DA = level 0),
 * plus users whose primaryGroupID is the Domain Admins RID (512).
 * Primary-group membership is not listed in the group's `member` attribute.
 */
export function resolveDomainAdminUsers(ctx: RuleContext): AdUserRow[] {
  const groups = groupByDn(ctx.groups);
  const users = userByDn(ctx.users);
  const seenUserDns = new Set<string>();
  const result: AdUserRow[] = [];

  const da = ctx.groups.find(isDomainAdminsGroup);
  if (da) {
    type QueueItem = { dn: string; depth: number };
    const queue: QueueItem[] = da.memberDns.map((dn) => ({ dn, depth: 1 }));
    const seenGroupDns = new Set<string>([da.distinguishedName.toLowerCase()]);

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
      if (depth >= 2) continue; // do not expand groups beyond level 2
      for (const child of nested.memberDns) {
        queue.push({ dn: child, depth: depth + 1 });
      }
    }
  }

  for (const u of ctx.users) {
    if (u.primaryGroupId !== DOMAIN_ADMINS_RID) continue;
    const key = u.distinguishedName.toLowerCase();
    if (seenUserDns.has(key)) continue;
    seenUserDns.add(key);
    result.push(u);
  }

  return result;
}

function enabledDomainAdmins(ctx: RuleContext): AdUserRow[] {
  return resolveDomainAdminUsers(ctx).filter((u) => u.enabled);
}

export const privilegedRules: RuleDef[] = [
  {
    id: "DA-P-DomainAdminsCount",
    axis: "privileged",
    points: 15,
    title: "Too many Domain Admins",
    run(ctx) {
      const members = enabledDomainAdmins(ctx);
      if (members.length <= THRESHOLDS.domainAdminsWarnAbove) return null;
      const dns = members.map((u) => u.distinguishedName);
      return aggFinding({
        ruleId: "DA-P-DomainAdminsCount",
        axis: "privileged",
        points: 15,
        title: "Too many Domain Admins",
        description: `${members.length} enabled Domain Admin(s) (nested ≤2 levels; warn above ${THRESHOLDS.domainAdminsWarnAbove})`,
        dns,
      });
    },
  },
  {
    id: "DA-P-AdminPwdAge",
    axis: "privileged",
    points: 20,
    title: "Domain Admin password age",
    run(ctx) {
      const dns = enabledDomainAdmins(ctx)
        .filter((u) => {
          if (u.passwordLastSetAt == null) return true;
          const days = daysSince(u.passwordLastSetAt, ctx.now);
          if (days == null) return true;
          return days > THRESHOLDS.adminPwdMaxDays;
        })
        .map((u) => u.distinguishedName);
      if (dns.length === 0) return null;
      return aggFinding({
        ruleId: "DA-P-AdminPwdAge",
        axis: "privileged",
        points: 20,
        title: "Domain Admin password age",
        description: `${dns.length} Domain Admin(s) with password never set or older than ${THRESHOLDS.adminPwdMaxDays} days`,
        dns,
      });
    },
  },
  {
    id: "DA-P-UnconstrainedDelegation",
    axis: "privileged",
    points: 30,
    title: "Unconstrained delegation",
    run(ctx) {
      const userDns = ctx.users
        .filter((u) => hasFlag(u.uac, UAC.TRUSTED_FOR_DELEGATION))
        .map((u) => u.distinguishedName);
      const computerDns = ctx.computers
        .filter(
          (c) =>
            !c.isDomainController && hasFlag(c.uac, UAC.TRUSTED_FOR_DELEGATION),
        )
        .map((c) => c.distinguishedName);
      const dns = [...userDns, ...computerDns];
      if (dns.length === 0) return null;
      return aggFinding({
        ruleId: "DA-P-UnconstrainedDelegation",
        axis: "privileged",
        points: 30,
        title: "Unconstrained delegation",
        description: `${dns.length} account(s) with TRUSTED_FOR_DELEGATION (Domain Controllers excluded)`,
        dns,
      });
    },
  },
  {
    id: "DA-P-Kerberoastable",
    axis: "privileged",
    points: 15,
    title: "Kerberoastable users",
    run(ctx) {
      const dns = ctx.users
        .filter((u) => u.enabled && u.servicePrincipalNames.length > 0)
        .map((u) => u.distinguishedName);
      if (dns.length === 0) return null;
      return aggFinding({
        ruleId: "DA-P-Kerberoastable",
        axis: "privileged",
        points: 15,
        title: "Kerberoastable users",
        description: `${dns.length} enabled user(s) with servicePrincipalName set`,
        dns,
      });
    },
  },
];
