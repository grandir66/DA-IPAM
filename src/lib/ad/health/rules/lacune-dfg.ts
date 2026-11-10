/**
 * Lacune rispetto ad ad-doctor, blocchi D (DNS), F (infrastruttura) e G (Entra) del piano
 * docs/superpowers/plans/2026-11-10-ad-health-evidenze-e-percorsi.md.
 *
 * Solo LDAP, sola lettura: i dati arrivano da `infra-extras.ts`. Un dato non letto (`null`)
 * non produce mai un rilievo: lo dice la raccolta, in `collectErrors`.
 */

import { expandAllPrivileges } from "../membership";
import type { RuleContext, RuleDef } from "../types";
import { aggFinding } from "./helpers";

const DAY_MS = 86_400_000;
const AZURE_SSO_MAX_AGE_DAYS = 30;
const BROAD_GROUPS = new Set(["domain users", "domain computers", "authenticated users", "everyone", "users"]);

function cn(dn: string): string {
  return /^CN=((?:\\.|[^,])+)/i.exec(dn)?.[1]?.replace(/\\(.)/g, "$1") ?? dn;
}

/** DN (minuscoli) dei gruppi privilegiati e degli utenti che ne fanno parte, annidati compresi. */
function privilegedDns(ctx: RuleContext): { groups: Set<string>; users: Set<string> } {
  const groups = new Set<string>();
  const users = new Set<string>();
  for (const e of expandAllPrivileges(ctx.groups, ctx.users).values()) {
    if (!e.def.countsAsPrivilege || !e.group) continue;
    groups.add(e.group.distinguishedName.toLowerCase());
    for (const h of e.hits) users.add(h.user.distinguishedName.toLowerCase());
  }
  return { groups, users };
}

function isEntraSyncAccount(sam: string): boolean {
  return /^(MSOL_|AAD_|Sync_)/i.test(sam);
}

function entraConnectPresent(ctx: RuleContext): boolean {
  return ctx.users.some((u) => isEntraSyncAccount(u.samAccountName))
    || ctx.computers.some((c) => c.samAccountName.toUpperCase() === "AZUREADSSOACC$");
}

export const lacuneDfgRules: RuleDef[] = [
  {
    id: "DA-A-DnsZoneInsecureUpdate",
    axis: "anomaly",
    points: 20,
    title: "DNS zone accepts nonsecure dynamic updates",
    run(ctx) {
      const zones = (ctx.infra?.dnsZones ?? []).filter((z) => z.allowUpdate === 1);
      if (zones.length === 0) return null;
      return aggFinding({
        ruleId: "DA-A-DnsZoneInsecureUpdate",
        axis: "anomaly",
        points: 20,
        title: "DNS zone accepts nonsecure dynamic updates",
        description: `${zones.length} DNS zone(s) accept dynamic updates without authentication: ${zones.map((z) => z.name).join(", ")}.`,
        dns: zones.map((z) => z.dn),
        raw: { zones: zones.map((z) => z.name) },
      });
    },
  },
  {
    id: "DA-A-DnsZoneBroadWrite",
    axis: "anomaly",
    points: 20,
    title: "DNS zone writable by a broad group",
    run(ctx) {
      const zones = (ctx.infra?.dnsZones ?? []).filter((z) => (z.broadWriters?.length ?? 0) > 0);
      if (zones.length === 0) return null;
      return aggFinding({
        ruleId: "DA-A-DnsZoneBroadWrite",
        axis: "anomaly",
        points: 20,
        title: "DNS zone writable by a broad group",
        description: `${zones.length} DNS zone(s) let a broad group change records, ACL or owner: ${zones.map((z) => z.name).join(", ")}.`,
        dns: zones.map((z) => z.dn),
        raw: { zones: Object.fromEntries(zones.map((z) => [z.name, z.broadWriters ?? []])) },
      });
    },
  },
  {
    id: "DA-A-DnsWildcardRecord",
    axis: "anomaly",
    points: 0,
    diagnostic: true,
    title: "Wildcard DNS record present",
    run(ctx) {
      const dns = ctx.infra?.dnsWildcardDns ?? [];
      if (dns.length === 0) return null;
      return aggFinding({
        ruleId: "DA-A-DnsWildcardRecord",
        axis: "anomaly",
        points: 0,
        diagnostic: true,
        severity: "Medium",
        title: "Wildcard DNS record present",
        description: `${dns.length} wildcard record(s) in AD-integrated zones. To verify: who created it and where it points.`,
        dns,
      });
    },
  },
  {
    id: "DA-A-AnonymousLdapOps",
    axis: "anomaly",
    points: 20,
    title: "Anonymous LDAP operations allowed (dSHeuristics)",
    run(ctx) {
      const h = ctx.infra?.dsHeuristics;
      if (h == null || h[6] !== "2") return null;
      return aggFinding({
        ruleId: "DA-A-AnonymousLdapOps",
        axis: "anomaly",
        points: 20,
        title: "Anonymous LDAP operations allowed (dSHeuristics)",
        description: "dSHeuristics has fLDAPBlockAnonOps = 2: the directory answers anonymous LDAP operations.",
        dns: [],
        raw: { dsHeuristics: h },
      });
    },
  },
  {
    id: "DA-P-AdminSdExMask",
    axis: "privileged",
    points: 15,
    title: "AdminSDHolder protection reduced (dSHeuristics)",
    run(ctx) {
      const h = ctx.infra?.dsHeuristics;
      const mask = h?.[15];
      if (h == null || mask == null || mask === "0") return null;
      return aggFinding({
        ruleId: "DA-P-AdminSdExMask",
        axis: "privileged",
        points: 15,
        title: "AdminSDHolder protection reduced (dSHeuristics)",
        description: `dSHeuristics has dwAdminSDExMask = ${mask}: some operator groups are excluded from AdminSDHolder protection.`,
        dns: [],
        raw: { dsHeuristics: h, mask },
      });
    },
  },
  {
    id: "DA-A-SysvolFrs",
    axis: "anomaly",
    points: 15,
    title: "SYSVOL still replicated with FRS",
    run(ctx) {
      const state = ctx.infra?.sysvolReplication;
      if (state !== "frs" && state !== "migrating") return null;
      return aggFinding({
        ruleId: "DA-A-SysvolFrs",
        axis: "anomaly",
        points: 15,
        title: "SYSVOL still replicated with FRS",
        description: state === "frs"
          ? "SYSVOL is replicated with FRS: no DFSR migration has been started."
          : "The SYSVOL migration from FRS to DFSR was started but has not reached the final state.",
        dns: [],
        raw: { state },
      });
    },
  },
  {
    id: "DA-A-DcOutsideDcOu",
    axis: "anomaly",
    points: 15,
    title: "Domain controller outside the Domain Controllers OU",
    run(ctx) {
      const out = ctx.computers.filter((c) =>
        (c.isDomainController || c.isRodc) && c.enabled && !/,OU=Domain Controllers,DC=/i.test(c.distinguishedName));
      if (out.length === 0) return null;
      return aggFinding({
        ruleId: "DA-A-DcOutsideDcOu",
        axis: "anomaly",
        points: 15,
        title: "Domain controller outside the Domain Controllers OU",
        description: `${out.length} domain controller(s) are not in the Domain Controllers OU and do not receive its GPOs.`,
        dns: out.map((c) => c.distinguishedName),
      });
    },
  },
  {
    id: "DA-P-RodcPasswordPolicy",
    axis: "privileged",
    points: 20,
    title: "RODC password replication policy too wide",
    run(ctx) {
      const rodcs = ctx.infra?.rodcPolicies ?? [];
      if (rodcs.length === 0) return null;
      const priv = privilegedDns(ctx);
      const reasons: Record<string, string[]> = {};
      for (const r of rodcs) {
        const why: string[] = [];
        for (const dn of r.revealDns) {
          const key = dn.toLowerCase();
          if (priv.groups.has(key) || priv.users.has(key)) why.push(`privileged allowed: ${cn(dn)}`);
          else if (BROAD_GROUPS.has(cn(dn).toLowerCase())) why.push(`broad group allowed: ${cn(dn)}`);
        }
        if (r.neverRevealDns.length === 0) why.push("empty deny list");
        if (why.length > 0) reasons[r.dn] = why;
      }
      const dns = Object.keys(reasons);
      if (dns.length === 0) return null;
      return aggFinding({
        ruleId: "DA-P-RodcPasswordPolicy",
        axis: "privileged",
        points: 20,
        title: "RODC password replication policy too wide",
        description: `${dns.length} RODC(s) may cache passwords they should never hold (privileged accounts, broad groups or no deny list).`,
        dns,
        raw: { reasons },
      });
    },
  },
  {
    id: "DA-P-DmsaSupersedesPrivileged",
    axis: "privileged",
    points: 25,
    title: "dMSA supersedes a privileged account",
    run(ctx) {
      const dmsas = (ctx.infra?.dmsas ?? []).filter((d) => d.precededByDn);
      if (dmsas.length === 0) return null;
      const priv = privilegedDns(ctx);
      const adminCount = new Set(ctx.users.filter((u) => (u.adminCount ?? 0) > 0).map((u) => u.distinguishedName.toLowerCase()));
      const hits = dmsas.filter((d) => {
        const key = (d.precededByDn ?? "").toLowerCase();
        return priv.users.has(key) || adminCount.has(key);
      });
      if (hits.length === 0) return null;
      return aggFinding({
        ruleId: "DA-P-DmsaSupersedesPrivileged",
        axis: "privileged",
        points: 25,
        title: "dMSA supersedes a privileged account",
        description: `${hits.length} delegated managed service account(s) are linked as successor of a privileged account and inherit its rights (BadSuccessor).`,
        dns: hits.map((d) => d.dn),
        raw: { supersedes: Object.fromEntries(hits.map((d) => [d.dn, d.precededByDn])) },
      });
    },
  },
  {
    id: "DA-S-AzureSsoKeyOld",
    axis: "stale",
    points: 10,
    title: "Entra Seamless SSO key not rotated",
    run(ctx) {
      const acc = ctx.computers.find((c) => c.samAccountName.toUpperCase() === "AZUREADSSOACC$" && c.enabled);
      if (!acc?.passwordLastSetAt) return null;
      const ageDays = Math.floor((ctx.now.getTime() - new Date(acc.passwordLastSetAt).getTime()) / DAY_MS);
      if (!Number.isFinite(ageDays) || ageDays <= AZURE_SSO_MAX_AGE_DAYS) return null;
      return aggFinding({
        ruleId: "DA-S-AzureSsoKeyOld",
        axis: "stale",
        points: 10,
        title: "Entra Seamless SSO key not rotated",
        description: `The Kerberos key of AZUREADSSOACC$ is ${ageDays} days old (recommended: every ${AZURE_SSO_MAX_AGE_DAYS} days).`,
        dns: [acc.distinguishedName],
        raw: { ageDays },
      });
    },
  },
  {
    id: "DA-P-EntraSyncAccountPrivileged",
    axis: "privileged",
    points: 20,
    title: "Entra Connect sync account in a privileged group",
    run(ctx) {
      const priv = privilegedDns(ctx);
      const hits = ctx.users.filter((u) =>
        u.enabled && isEntraSyncAccount(u.samAccountName) && priv.users.has(u.distinguishedName.toLowerCase()));
      if (hits.length === 0) return null;
      return aggFinding({
        ruleId: "DA-P-EntraSyncAccountPrivileged",
        axis: "privileged",
        points: 20,
        title: "Entra Connect sync account in a privileged group",
        description: `${hits.length} Entra Connect sync account(s) are members of a privileged group: the sync server becomes a path to the domain.`,
        dns: hits.map((u) => u.distinguishedName),
      });
    },
  },
  {
    id: "DA-P-PrivilegedSyncedToEntra",
    axis: "privileged",
    points: 15,
    title: "Privileged accounts synchronized to Entra ID",
    run(ctx) {
      const synced = ctx.infra?.entraSyncedPrivilegedDns;
      if (!synced || synced.length === 0 || !entraConnectPresent(ctx)) return null;
      const priv = privilegedDns(ctx);
      const enabled = new Set(ctx.users.filter((u) => u.enabled).map((u) => u.distinguishedName.toLowerCase()));
      const dns = synced.filter((dn) => {
        const key = dn.toLowerCase();
        return priv.users.has(key) && enabled.has(key);
      });
      if (dns.length === 0) return null;
      return aggFinding({
        ruleId: "DA-P-PrivilegedSyncedToEntra",
        axis: "privileged",
        points: 15,
        title: "Privileged accounts synchronized to Entra ID",
        description: `${dns.length} privileged account(s) carry the Entra Connect anchor: a compromise in the cloud reaches the domain, and the other way round.`,
        dns,
      });
    },
  },
];
