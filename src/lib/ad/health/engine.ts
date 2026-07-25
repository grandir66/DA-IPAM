/**
 * AD Health engine: pure evaluateContext + runAdHealthcheck wrapper.
 */

import {
  getAdComputers,
  getAdGroups,
  getAdIntegrationById,
  getAdUsers,
  getDb,
  type AdComputer,
  type AdGroup,
  type AdUser,
} from "@/lib/db";
import { syncActiveDirectory } from "@/lib/ad/ad-client";
import { collectLdapExtras, type LdapExtras } from "./ldap-extras";
import {
  ensureAdHealthSchema,
  finishRun,
  getRunningRun,
  insertFindings,
  insertRun,
} from "./persist";
import { ALL_RULES } from "./rules";
import { aggregateScores, severityFromPoints } from "./score";
import type {
  AdComputerRow,
  AdGroupRow,
  AdUserRow,
  HealthFinding,
  HealthScore,
  RuleContext,
} from "./types";
import { ENGINE_VERSION } from "./types";

export class AdHealthConflictError extends Error {
  constructor(message = "AD healthcheck already running for this integration") {
    super(message);
    this.name = "AdHealthConflictError";
  }
}

function dnFromUserRaw(rawData: string | null, sam: string): string {
  if (!rawData) return sam;
  try {
    const parsed = JSON.parse(rawData) as Record<string, unknown>;
    const dn = parsed.dn ?? parsed.distinguishedName;
    if (typeof dn === "string" && dn.length > 0) return dn;
  } catch {
    // ignore
  }
  return sam;
}

function mapLookupIgnoreCase(map: Map<string, string[]>, key: string): string[] {
  const direct = map.get(key);
  if (direct) return direct;
  const lower = key.toLowerCase();
  for (const [k, v] of map) {
    if (k.toLowerCase() === lower) return v;
  }
  return [];
}

function toUserRows(users: AdUser[], extras: LdapExtras): AdUserRow[] {
  return users.map((u) => {
    const sam = u.sam_account_name;
    return {
      samAccountName: sam,
      distinguishedName: dnFromUserRaw(u.raw_data, sam),
      enabled: u.enabled === 1,
      lastLogonAt: u.last_logon_at,
      passwordLastSetAt: u.password_last_set_at,
      uac: extras.userUacBySam.get(sam) ?? null,
      servicePrincipalNames: extras.userSpnBySam.get(sam) ?? [],
      memberOfDns: [],
    };
  });
}

function toComputerRows(computers: AdComputer[], extras: LdapExtras): AdComputerRow[] {
  return computers.map((c) => {
    const sam = c.sam_account_name;
    return {
      samAccountName: sam,
      distinguishedName: c.distinguished_name,
      enabled: c.enabled === 1,
      lastLogonAt: c.last_logon_at,
      operatingSystem: c.operating_system,
      uac: extras.computerUacBySam.get(sam) ?? null,
      isDomainController: extras.computerIsDcBySam.get(sam) ?? false,
    };
  });
}

function toGroupRows(groups: AdGroup[], extras: LdapExtras): AdGroupRow[] {
  return groups.map((g) => ({
    samAccountName: g.sam_account_name,
    distinguishedName: g.distinguished_name,
    memberDns: mapLookupIgnoreCase(extras.groupMembersByDn, g.distinguished_name),
  }));
}

function domainScoreFinding(domainFqdn: string, score: HealthScore): HealthFinding {
  return {
    ruleId: "DA-A-DomainScore",
    axis: "score",
    points: score.global,
    severity: severityFromPoints(score.global),
    title: "Domain score",
    description:
      `Domain health score for ${domainFqdn} — global: ${score.global} ` +
      `(stale: ${score.stale}, privileged: ${score.privileged}, ` +
      `trust: ${score.trust}, anomaly: ${score.anomaly})`,
    objectCount: 0,
    sampleDns: [],
    raw: { scores: score },
  };
}

/** Pure: run ALL_RULES, aggregate score, append DA-A-DomainScore. */
export function evaluateContext(ctx: RuleContext): {
  score: HealthScore;
  findings: HealthFinding[];
} {
  const ruleFindings: HealthFinding[] = [];
  for (const rule of ALL_RULES) {
    const f = rule.run(ctx);
    if (f) ruleFindings.push(f);
  }
  const score = aggregateScores(ruleFindings);
  const findings = [...ruleFindings, domainScoreFinding(ctx.domainFqdn, score)];
  return { score, findings };
}

export async function runAdHealthcheck(
  integrationId: number,
  opts?: { refreshSync?: boolean },
): Promise<{ runId: number; score: HealthScore; findings: HealthFinding[] }> {
  const db = getDb();
  ensureAdHealthSchema(db);

  if (getRunningRun(db, integrationId)) {
    throw new AdHealthConflictError();
  }

  const integration = getAdIntegrationById(integrationId);
  if (!integration) {
    throw new Error(`AD integration ${integrationId} not found`);
  }

  const runId = insertRun(db, { integrationId, engineVersion: ENGINE_VERSION });
  const stats: Record<string, unknown> = {};

  try {
    if (opts?.refreshSync !== false) {
      try {
        const syncResult = await syncActiveDirectory(integrationId);
        stats.sync = syncResult;
      } catch (err) {
        stats.syncError = err instanceof Error ? err.message : String(err);
        // best-effort: continue if cache may still be usable
      }
    }

    const dbUsers = getAdUsers(integrationId);
    const dbComputers = getAdComputers(integrationId);
    const dbGroups = getAdGroups(integrationId);
    stats.cacheCounts = {
      users: dbUsers.length,
      computers: dbComputers.length,
      groups: dbGroups.length,
    };

    let extras: LdapExtras;
    try {
      extras = await collectLdapExtras(integrationId);
    } catch (err) {
      stats.ldapExtrasError = err instanceof Error ? err.message : String(err);
      extras = {
        userUacBySam: new Map(),
        userSpnBySam: new Map(),
        computerUacBySam: new Map(),
        computerIsDcBySam: new Map(),
        trusts: [],
        krbtgtPasswordLastSetAt: null,
        guestEnabled: null,
        recycleBinEnabled: null,
        groupMembersByDn: new Map(),
      };
    }

    const ctx: RuleContext = {
      now: new Date(),
      domainFqdn: integration.domain,
      users: toUserRows(dbUsers, extras),
      computers: toComputerRows(dbComputers, extras),
      groups: toGroupRows(dbGroups, extras),
      trusts: extras.trusts,
      krbtgtPasswordLastSetAt: extras.krbtgtPasswordLastSetAt,
      guestEnabled: extras.guestEnabled,
      recycleBinEnabled: extras.recycleBinEnabled,
    };

    const { score, findings } = evaluateContext(ctx);
    insertFindings(db, runId, findings);
    finishRun(db, runId, { status: "ok", score, statsJson: stats });
    return { runId, score, findings };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    finishRun(db, runId, { status: "error", errorMessage: message, statsJson: stats });
    throw err;
  }
}
