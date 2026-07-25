import { isObsoleteOs } from "../obsolete-os";
import { THRESHOLDS } from "../thresholds";
import type { RuleDef } from "../types";
import { hasFlag, UAC } from "../uac";
import { aggFinding, daysSince } from "./helpers";

function isInactive(lastLogonAt: string | null, now: Date): boolean {
  if (lastLogonAt == null) return true;
  const days = daysSince(lastLogonAt, now);
  if (days == null) return true;
  return days >= THRESHOLDS.inactiveDays;
}

export const staleRules: RuleDef[] = [
  {
    id: "DA-S-InactiveUser",
    axis: "stale",
    points: 10,
    title: "Inactive enabled users",
    run(ctx) {
      const dns = ctx.users
        .filter((u) => u.enabled && isInactive(u.lastLogonAt, ctx.now))
        .map((u) => u.distinguishedName);
      if (dns.length === 0) return null;
      return aggFinding({
        ruleId: "DA-S-InactiveUser",
        axis: "stale",
        points: 10,
        title: "Inactive enabled users",
        description: `${dns.length} enabled user(s) with no logon or last logon ≥ ${THRESHOLDS.inactiveDays} days`,
        dns,
      });
    },
  },
  {
    id: "DA-S-InactiveComputer",
    axis: "stale",
    points: 10,
    title: "Inactive enabled computers",
    run(ctx) {
      const dns = ctx.computers
        .filter((c) => c.enabled && isInactive(c.lastLogonAt, ctx.now))
        .map((c) => c.distinguishedName);
      if (dns.length === 0) return null;
      return aggFinding({
        ruleId: "DA-S-InactiveComputer",
        axis: "stale",
        points: 10,
        title: "Inactive enabled computers",
        description: `${dns.length} enabled computer(s) with no logon or last logon ≥ ${THRESHOLDS.inactiveDays} days`,
        dns,
      });
    },
  },
  {
    id: "DA-S-ObsoleteOS",
    axis: "stale",
    points: 20,
    title: "Obsolete operating systems",
    run(ctx) {
      const dns = ctx.computers
        .filter((c) => c.enabled && isObsoleteOs(c.operatingSystem))
        .map((c) => c.distinguishedName);
      if (dns.length === 0) return null;
      return aggFinding({
        ruleId: "DA-S-ObsoleteOS",
        axis: "stale",
        points: 20,
        title: "Obsolete operating systems",
        description: `${dns.length} enabled computer(s) running an unsupported OS`,
        dns,
      });
    },
  },
  {
    id: "DA-S-PwdNeverExpires",
    axis: "stale",
    points: 10,
    title: "Password never expires",
    run(ctx) {
      const dns = ctx.users
        .filter((u) => u.enabled && hasFlag(u.uac, UAC.DONT_EXPIRE_PASSWORD))
        .map((u) => u.distinguishedName);
      if (dns.length === 0) return null;
      return aggFinding({
        ruleId: "DA-S-PwdNeverExpires",
        axis: "stale",
        points: 10,
        title: "Password never expires",
        description: `${dns.length} enabled user(s) with DONT_EXPIRE_PASSWORD`,
        dns,
      });
    },
  },
  {
    id: "DA-S-PwdNotRequired",
    axis: "stale",
    points: 30,
    title: "Password not required",
    run(ctx) {
      const dns = ctx.users
        .filter((u) => u.enabled && hasFlag(u.uac, UAC.PASSWD_NOTREQD))
        .map((u) => u.distinguishedName);
      if (dns.length === 0) return null;
      return aggFinding({
        ruleId: "DA-S-PwdNotRequired",
        axis: "stale",
        points: 30,
        title: "Password not required",
        description: `${dns.length} enabled user(s) with PASSWD_NOTREQD`,
        dns,
      });
    },
  },
  {
    id: "DA-S-NoPreAuth",
    axis: "stale",
    points: 20,
    title: "Kerberos pre-authentication disabled",
    run(ctx) {
      const dns = ctx.users
        .filter((u) => u.enabled && hasFlag(u.uac, UAC.DONT_REQ_PREAUTH))
        .map((u) => u.distinguishedName);
      if (dns.length === 0) return null;
      return aggFinding({
        ruleId: "DA-S-NoPreAuth",
        axis: "stale",
        points: 20,
        title: "Kerberos pre-authentication disabled",
        description: `${dns.length} enabled user(s) with DONT_REQ_PREAUTH`,
        dns,
      });
    },
  },
];
