/**
 * Phase 3 rules: nested admin paths, operator groups, privilege set size.
 */

import {
  expandAllPrivileges,
  nestedIntoDomainAdmins,
  privilegedUserSet,
} from "../membership";
import { OPERATOR_KEYS } from "../privileged-catalog";
import { LARGE_PRIVILEGED_SET_ABOVE, type RuleContext, type RuleDef } from "../types";
import { aggFinding } from "./helpers";

function expansions(ctx: RuleContext) {
  return expandAllPrivileges(ctx.groups, ctx.users);
}

export const phase3Rules: RuleDef[] = [
  {
    id: "DA-P-NestedIntoDomainAdmins",
    axis: "privileged",
    points: 20,
    title: "Nested membership into Domain Admins",
    run(ctx) {
      const hits = nestedIntoDomainAdmins(expansions(ctx));
      if (hits.length === 0) return null;
      const dns = hits.map((h) => h.user.distinguishedName);
      return aggFinding({
        ruleId: "DA-P-NestedIntoDomainAdmins",
        axis: "privileged",
        points: 20,
        title: "Nested membership into Domain Admins",
        description:
          `${hits.length} enabled user(s) reach Domain Admins via nested group(s) ` +
          `(not direct/primary) — review intermediate groups`,
        dns,
        raw: {
          paths: hits.slice(0, 50).map((h) => ({
            sam: h.user.samAccountName,
            path: h.path,
          })),
        },
      });
    },
  },
  {
    id: "DA-P-OperatorsPopulated",
    axis: "privileged",
    points: 25,
    title: "Built-in Operators groups populated",
    run(ctx) {
      const exp = expansions(ctx);
      const dns: string[] = [];
      const byGroup: Record<string, string[]> = {};
      for (const key of OPERATOR_KEYS) {
        const e = exp.get(key);
        if (!e || e.enabledUsers.length === 0) continue;
        byGroup[key] = e.enabledUsers.map((u) => u.samAccountName);
        for (const u of e.enabledUsers) dns.push(u.distinguishedName);
      }
      if (dns.length === 0) return null;
      const unique = [...new Set(dns)];
      return aggFinding({
        ruleId: "DA-P-OperatorsPopulated",
        axis: "privileged",
        points: 25,
        title: "Built-in Operators groups populated",
        description:
          `Account/Backup/Server/Print Operators contain ${unique.length} enabled member(s) — ` +
          `these groups grant powerful rights and should usually be empty`,
        dns: unique,
        raw: { byGroup },
      });
    },
  },
  {
    id: "DA-P-DnsAdminsPopulated",
    axis: "privileged",
    points: 20,
    title: "DnsAdmins group populated",
    run(ctx) {
      const e = expansions(ctx).get("dns-admins");
      if (!e?.group) return null;
      if (e.enabledUsers.length === 0) return null;
      return aggFinding({
        ruleId: "DA-P-DnsAdminsPopulated",
        axis: "privileged",
        points: 20,
        title: "DnsAdmins group populated",
        description:
          `DnsAdmins has ${e.enabledUsers.length} enabled member(s) — ` +
          `DnsAdmins can escalate to Domain Admin via DNSAdmin abuse techniques`,
        dns: e.enabledUsers.map((u) => u.distinguishedName),
      });
    },
  },
  {
    id: "DA-P-GpoCreatorsPopulated",
    axis: "privileged",
    points: 15,
    title: "Group Policy Creator Owners populated",
    run(ctx) {
      const e = expansions(ctx).get("gpo-creators");
      if (!e?.group) return null;
      if (e.enabledUsers.length === 0) return null;
      return aggFinding({
        ruleId: "DA-P-GpoCreatorsPopulated",
        axis: "privileged",
        points: 15,
        title: "Group Policy Creator Owners populated",
        description:
          `Group Policy Creator Owners has ${e.enabledUsers.length} enabled member(s) — ` +
          `GPO creators can often escalate domain-wide`,
        dns: e.enabledUsers.map((u) => u.distinguishedName),
      });
    },
  },
  {
    id: "DA-P-EmptyProtectedUsers",
    axis: "privileged",
    points: 10,
    title: "Protected Users empty while Domain Admins exist",
    run(ctx) {
      const exp = expansions(ctx);
      const pu = exp.get("protected-users");
      const da = exp.get("domain-admins");
      if (!pu?.group) return null; // group missing → skip (older domains / no feature)
      if (pu.enabledUsers.length > 0) return null;
      const daCount = da?.enabledUsers.length ?? 0;
      if (daCount === 0) return null;
      return aggFinding({
        ruleId: "DA-P-EmptyProtectedUsers",
        axis: "privileged",
        points: 10,
        title: "Protected Users empty while Domain Admins exist",
        description:
          `Protected Users has no enabled members while Domain Admins has ${daCount} — ` +
          `privileged accounts should typically be in Protected Users`,
        dns: [],
        raw: { domainAdminsEnabled: daCount },
      });
    },
  },
  {
    id: "DA-A-LargePrivilegedSet",
    axis: "anomaly",
    points: 15,
    title: "Large privileged user set",
    run(ctx) {
      const set = privilegedUserSet(expansions(ctx));
      if (set.length <= LARGE_PRIVILEGED_SET_ABOVE) return null;
      return aggFinding({
        ruleId: "DA-A-LargePrivilegedSet",
        axis: "anomaly",
        points: 15,
        title: "Large privileged user set",
        description:
          `${set.length} enabled users have a path into high-privilege groups ` +
          `(warn above ${LARGE_PRIVILEGED_SET_ABOVE}) — review the privilege matrix`,
        dns: set.map((u) => u.distinguishedName),
        raw: { count: set.length, threshold: LARGE_PRIVILEGED_SET_ABOVE },
      });
    },
  },
];
