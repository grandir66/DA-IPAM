/**
 * Phase 4 rules: DCSync / AdminSDHolder / dangerous ACL / collect partial.
 */

import { dcsyncPrincipals } from "../acl/interesting-ace";
import type { AclExtras } from "../acl/types";
import type { RuleContext, RuleDef } from "../types";
import { aggFinding } from "./helpers";

function aclOf(ctx: RuleContext): AclExtras | null | undefined {
  return ctx.acl;
}

export const phase4Rules: RuleDef[] = [
  {
    id: "DA-A-AclCollectPartial",
    axis: "anomaly",
    points: 0,
    title: "ACL collect incomplete or unavailable",
    diagnostic: true,
    run(ctx) {
      const acl = aclOf(ctx);
      if (!acl) return null;
      const { meta } = acl;
      if (meta.status === "ok") return null;
      const why =
        meta.errorMessage ??
        (meta.timedOut
          ? "timed out"
          : meta.truncated
            ? "truncated"
            : meta.status);
      return aggFinding({
        ruleId: "DA-A-AclCollectPartial",
        axis: "anomaly",
        points: 0,
        title: "ACL collect incomplete or unavailable",
        description: `Security descriptor collect status=${meta.status} (${why}); scanned=${meta.objectsScanned}, parsed=${meta.sdParsed}`,
        dns: [],
        raw: { meta },
        diagnostic: true,
        severity: "Medium",
      });
    },
  },
  {
    id: "DA-P-DCSyncRights",
    axis: "privileged",
    points: 40,
    title: "Unexpected DCSync rights on domain",
    run(ctx) {
      const acl = aclOf(ctx);
      if (!acl || acl.meta.status === "unavailable") return null;
      const hits = dcsyncPrincipals(acl.interestingAces);
      if (hits.length === 0) return null;
      const dns = hits.map(
        (h) => h.trusteeSam ?? h.trusteeSid,
      );
      return aggFinding({
        ruleId: "DA-P-DCSyncRights",
        axis: "privileged",
        points: 40,
        title: "Unexpected DCSync rights on domain",
        description:
          `${hits.length} principal(s) hold unexpected DCSync / GenericAll on the domain object`,
        dns,
        raw: {
          principals: hits.map((h) => ({
            sid: h.trusteeSid,
            sam: h.trusteeSam,
            rights: h.rights,
          })),
        },
      });
    },
  },
  {
    id: "DA-A-AdminSDHolderAce",
    axis: "anomaly",
    points: 35,
    title: "Unexpected AdminSDHolder ACE",
    run(ctx) {
      const acl = aclOf(ctx);
      if (!acl || acl.meta.status === "unavailable") return null;
      const hits = acl.interestingAces.filter((a) => a.objectKind === "adminsdholder");
      if (hits.length === 0) return null;
      return aggFinding({
        ruleId: "DA-A-AdminSDHolderAce",
        axis: "anomaly",
        points: 35,
        title: "Unexpected AdminSDHolder ACE",
        description:
          `${hits.length} non-default allow ACE(s) on AdminSDHolder — persistence risk via SDProp`,
        dns: hits.map((h) => h.trusteeSam ?? h.trusteeSid),
        raw: {
          aces: hits.slice(0, 50).map((h) => ({
            trustee: h.trusteeSid,
            sam: h.trusteeSam,
            rights: h.rights,
          })),
        },
      });
    },
  },
  {
    id: "DA-P-DangerousAcl",
    axis: "privileged",
    points: 20,
    title: "Dangerous ACL on directory objects",
    run(ctx) {
      const acl = aclOf(ctx);
      if (!acl || acl.meta.status === "unavailable") return null;
      const hits = acl.interestingAces.filter((a) =>
        a.objectKind === "ou" ||
        a.objectKind === "user" ||
        a.objectKind === "group" ||
        a.objectKind === "computer",
      );
      if (hits.length === 0) return null;
      const objectDns = [...new Set(hits.map((h) => h.objectDn))];
      return aggFinding({
        ruleId: "DA-P-DangerousAcl",
        axis: "privileged",
        points: 20,
        title: "Dangerous ACL on directory objects",
        description:
          `${hits.length} interesting ACE(s) on ${objectDns.length} OU/user/group/computer object(s) ` +
          `(GenericAll/WriteDacl/WriteOwner/extended rights)`,
        dns: objectDns,
        raw: { aceCount: hits.length, objectCount: objectDns.length },
      });
    },
  },
];
