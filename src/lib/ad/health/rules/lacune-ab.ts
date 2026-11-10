/**
 * Lacune rispetto ad ad-doctor, blocchi A e B del piano
 * docs/superpowers/plans/2026-11-10-ad-health-evidenze-e-percorsi.md.
 *
 * Solo LDAP, sola lettura. Nessuna regola legge un valore segreto: degli attributi che
 * contengono password si legge la presenza, dei gMSA si legge chi può chiederne la password.
 * Gli indizi che da soli non dimostrano niente sono `diagnostic` (fuori dal punteggio).
 */

import { expandAllPrivileges, type PrivilegeExpansion } from "../membership";
import type { PrivilegeGroupKey } from "../privileged-catalog";
import type { AdGroupRow, RuleContext, RuleDef } from "../types";
import { UAC, hasFlag } from "../uac";
import { aggFinding } from "./helpers";

type Expansions = Map<PrivilegeGroupKey, PrivilegeExpansion>;

function expansions(ctx: RuleContext): Expansions {
  return expandAllPrivileges(ctx.groups, ctx.users);
}

/** I gruppi che danno privilegio: Domain Controllers e Protected Users non sono un rischio. */
function privileged(exp: Expansions): PrivilegeExpansion[] {
  return [...exp.values()].filter((e) => e.def.countsAsPrivilege && e.group != null);
}

/** Tutti i DN membri di un gruppo, annidati compresi, che non sono a loro volta gruppi. */
function leafMemberDns(root: AdGroupRow, groups: AdGroupRow[]): string[] {
  const byDn = new Map(groups.map((g) => [g.distinguishedName.toLowerCase(), g]));
  const seen = new Set<string>([root.distinguishedName.toLowerCase()]);
  const leaves = new Map<string, string>();
  const queue: AdGroupRow[] = [root];
  while (queue.length > 0) {
    const group = queue.shift();
    if (!group) break;
    for (const dn of group.memberDns) {
      const key = dn.toLowerCase();
      const nested = byDn.get(key);
      if (!nested) {
        leaves.set(key, dn);
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push(nested);
    }
  }
  return [...leaves.values()];
}

function unique(list: string[]): string[] {
  return [...new Set(list)];
}

export const lacuneAbRules: RuleDef[] = [
  {
    id: "DA-P-PrimaryGroupHidden",
    axis: "privileged",
    points: 15,
    title: "Privileged membership through primaryGroupID",
    run(ctx) {
      const perGroup: Record<string, number> = {};
      const dns: string[] = [];
      for (const e of privileged(expansions(ctx))) {
        const hits = e.hits.filter((h) => h.kind === "primary" && h.user.enabled);
        if (hits.length === 0) continue;
        perGroup[e.def.displayName] = hits.length;
        dns.push(...hits.map((h) => h.user.distinguishedName));
      }
      if (dns.length === 0) return null;
      return aggFinding({
        ruleId: "DA-P-PrimaryGroupHidden",
        axis: "privileged",
        points: 15,
        title: "Privileged membership through primaryGroupID",
        description:
          "Enabled accounts are members of a privileged group only through primaryGroupID: they do not appear in the group's member list, so a review of the members misses them.",
        dns: unique(dns),
        raw: { perGroup },
      });
    },
  },
  {
    id: "DA-P-DisabledInPrivilegedGroup",
    axis: "privileged",
    points: 5,
    title: "Disabled accounts in privileged groups",
    run(ctx) {
      const dns: string[] = [];
      for (const e of privileged(expansions(ctx))) {
        dns.push(...e.hits.filter((h) => !h.user.enabled).map((h) => h.user.distinguishedName));
      }
      if (dns.length === 0) return null;
      return aggFinding({
        ruleId: "DA-P-DisabledInPrivilegedGroup",
        axis: "privileged",
        points: 5,
        title: "Disabled accounts in privileged groups",
        description:
          "Disabled accounts still hold a privileged membership: re-enabling one gives back the privilege without touching the group.",
        dns: unique(dns),
      });
    },
  },
  {
    id: "DA-P-ComputerInPrivilegedGroup",
    axis: "privileged",
    points: 20,
    title: "Computer accounts in privileged groups",
    run(ctx) {
      const computers = new Set(ctx.computers.map((c) => c.distinguishedName.toLowerCase()));
      const perGroup: Record<string, number> = {};
      const dns: string[] = [];
      for (const e of privileged(expansions(ctx))) {
        if (!e.group) continue;
        const found = leafMemberDns(e.group, ctx.groups).filter((dn) => computers.has(dn.toLowerCase()));
        if (found.length === 0) continue;
        perGroup[e.def.displayName] = found.length;
        dns.push(...found);
      }
      if (dns.length === 0) return null;
      return aggFinding({
        ruleId: "DA-P-ComputerInPrivilegedGroup",
        axis: "privileged",
        points: 20,
        title: "Computer accounts in privileged groups",
        description:
          "Computer accounts are members of a privileged group: whoever controls that machine (local admin, relay, coerced authentication) acts with the group's privilege.",
        dns: unique(dns),
        raw: { perGroup },
      });
    },
  },
  {
    id: "DA-P-SchemaAdminsPopulated",
    axis: "privileged",
    points: 10,
    title: "Schema Admins is not empty",
    run(ctx) {
      const e = expansions(ctx).get("schema-admins");
      if (!e || e.enabledUsers.length === 0) return null;
      return aggFinding({
        ruleId: "DA-P-SchemaAdminsPopulated",
        axis: "privileged",
        points: 10,
        title: "Schema Admins is not empty",
        description:
          "Schema Admins has enabled members. The group is needed only while the schema is being extended and should be empty the rest of the time.",
        dns: e.enabledUsers.map((u) => u.distinguishedName),
      });
    },
  },
  {
    id: "DA-P-EnterpriseAdminsPopulated",
    axis: "privileged",
    points: 10,
    title: "Enterprise Admins has members beyond the built-in Administrator",
    run(ctx) {
      const e = expansions(ctx).get("enterprise-admins");
      if (!e) return null;
      // L'Administrator predefinito è riconosciuto dal nome: se è stato rinominato compare qui.
      const extra = e.enabledUsers.filter((u) => u.samAccountName.toLowerCase() !== "administrator");
      if (extra.length === 0) return null;
      return aggFinding({
        ruleId: "DA-P-EnterpriseAdminsPopulated",
        axis: "privileged",
        points: 10,
        title: "Enterprise Admins has members beyond the built-in Administrator",
        description:
          "Enterprise Admins has enabled members other than the account named Administrator (recognised by name: a renamed built-in account is listed too). The group is needed only for forest-wide changes.",
        dns: extra.map((u) => u.distinguishedName),
      });
    },
  },
  {
    id: "DA-P-UnresolvedPrivilegedMember",
    axis: "privileged",
    points: 0,
    title: "Privileged group members that could not be identified",
    diagnostic: true,
    run(ctx) {
      const known = new Set<string>([
        ...ctx.users.map((u) => u.distinguishedName.toLowerCase()),
        ...ctx.computers.map((c) => c.distinguishedName.toLowerCase()),
      ]);
      const foreign: string[] = [];
      const other: string[] = [];
      for (const e of privileged(expansions(ctx))) {
        if (!e.group) continue;
        for (const dn of leafMemberDns(e.group, ctx.groups)) {
          if (known.has(dn.toLowerCase())) continue;
          (/,CN=ForeignSecurityPrincipals,/i.test(dn) ? foreign : other).push(dn);
        }
      }
      const dns = unique([...foreign, ...other]);
      if (dns.length === 0) return null;
      return aggFinding({
        ruleId: "DA-P-UnresolvedPrivilegedMember",
        axis: "privileged",
        points: 0,
        title: "Privileged group members that could not be identified",
        description:
          "Some members of privileged groups are neither a user, a computer nor a group read by this check: principals of another domain (ForeignSecurityPrincipals), gMSA, contacts or objects this account cannot read. They hold the privilege but are not counted elsewhere: to be verified by hand.",
        dns,
        raw: { foreignSecurityPrincipals: unique(foreign).length, other: unique(other).length },
        diagnostic: true,
        severity: "Medium",
      });
    },
  },
  {
    id: "DA-S-DesOnly",
    axis: "stale",
    points: 15,
    title: "Accounts restricted to DES Kerberos keys",
    run(ctx) {
      const dns = [...ctx.users, ...ctx.computers]
        .filter((o) => o.enabled && hasFlag(o.uac, UAC.USE_DES_KEY_ONLY))
        .map((o) => o.distinguishedName);
      if (dns.length === 0) return null;
      return aggFinding({
        ruleId: "DA-S-DesOnly",
        axis: "stale",
        points: 15,
        title: "Accounts restricted to DES Kerberos keys",
        description:
          "Enabled accounts carry USE_DES_KEY_ONLY: their Kerberos tickets use DES, which is broken in hours with commodity hardware.",
        dns,
      });
    },
  },
  {
    id: "DA-A-PwdAttributePresent",
    axis: "anomaly",
    points: 20,
    title: "Password stored in a readable attribute",
    run(ctx) {
      const rows = ctx.passwordAttributeRows;
      if (!rows || rows.length === 0) return null;
      const perAttribute: Record<string, number> = {};
      for (const row of rows) perAttribute[row.attribute] = (perAttribute[row.attribute] ?? 0) + 1;
      return aggFinding({
        ruleId: "DA-A-PwdAttributePresent",
        axis: "anomaly",
        points: 20,
        title: "Password stored in a readable attribute",
        description:
          "Objects have a value in userPassword, unixUserPassword or msSFU30Password. Only the presence was checked, the value was never read: these attributes often hold a cleartext or weakly hashed password and are readable by any authenticated user unless explicitly protected.",
        dns: unique(rows.map((r) => r.dn)),
        raw: { perAttribute },
      });
    },
  },
  {
    id: "DA-S-PreCreatedComputer",
    axis: "stale",
    points: 0,
    title: "Pre-created computer accounts never used",
    diagnostic: true,
    run(ctx) {
      const dns = ctx.computers
        .filter((c) => c.enabled && !c.isDomainController && hasFlag(c.uac, UAC.PASSWD_NOTREQD) && c.lastLogonAt == null)
        .map((c) => c.distinguishedName);
      if (dns.length === 0) return null;
      return aggFinding({
        ruleId: "DA-S-PreCreatedComputer",
        axis: "stale",
        points: 0,
        title: "Pre-created computer accounts never used",
        description:
          "Enabled computer accounts with PASSWD_NOTREQD that never logged on: the shape of an account pre-created and never joined, whose password may be the default one (the computer name). It is a hint, not a proof: no logon was attempted.",
        dns,
        diagnostic: true,
        severity: "Medium",
      });
    },
  },
  {
    id: "DA-P-GmsaBroadReaders",
    axis: "privileged",
    points: 25,
    title: "gMSA password readable by a broad group",
    run(ctx) {
      const rows = (ctx.gmsaReaders ?? []).filter((r) => r.broadSids.length > 0);
      if (rows.length === 0) return null;
      return aggFinding({
        ruleId: "DA-P-GmsaBroadReaders",
        axis: "privileged",
        points: 25,
        title: "gMSA password readable by a broad group",
        description:
          "The delegation msDS-GroupMSAMembership lets Everyone, Authenticated Users, Users, Domain Users or Domain Computers retrieve the password of these gMSA. Only the delegation was read, never the password.",
        dns: rows.map((r) => r.dn),
        raw: { broadSids: unique(rows.flatMap((r) => r.broadSids)) },
      });
    },
  },
];
