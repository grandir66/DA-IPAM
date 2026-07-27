/**
 * Collector-integrity rules.
 *
 * These report on the healthcheck itself, not on the domain. Without them a
 * timed-out LDAP query leaves the attribute maps empty and every UAC-based
 * rule silently finds nothing — a clean-looking report on an unexamined domain.
 */

import type { RuleDef } from "../types";
import { aggFinding } from "./helpers";

/** Queries whose failure invalidates most rules, not just one finding. */
const CORE_QUERIES = new Set(["users", "computers", "groups"]);

export const collectRules: RuleDef[] = [
  {
    id: "DA-A-LdapCollectPartial",
    axis: "anomaly",
    points: 0,
    title: "LDAP collect incomplete",
    diagnostic: true,
    run(ctx) {
      const failed = ctx.ldapCollectErrors ?? [];
      if (failed.length === 0) return null;
      const core = failed.filter((q) => CORE_QUERIES.has(q));
      return aggFinding({
        ruleId: "DA-A-LdapCollectPartial",
        axis: "anomaly",
        points: 0,
        title: "LDAP collect incomplete",
        description:
          core.length > 0
            ? `${failed.length} LDAP query(ies) failed, including core data (${core.join(", ")}): results are incomplete and the domain may look cleaner than it is. Failed: ${failed.join(", ")}`
            : `${failed.length} secondary LDAP query(ies) failed: ${failed.join(", ")}. Related rules were skipped.`,
        dns: failed,
        diagnostic: true,
        severity: core.length > 0 ? "High" : "Low",
      });
    },
  },
];
