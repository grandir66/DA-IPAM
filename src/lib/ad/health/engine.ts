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
import { collectAclExtras } from "./acl/acl-collect";
import type { AclExtras } from "./acl/types";
import { collectLdapExtras, type LdapExtras } from "./ldap-extras";
import { buildPrivilegeMatrix } from "./membership";
import { collectWinrmProbe } from "./winrm-probe";
import type { WinrmProbeResult } from "./types";
import {
  ensureAdHealthSchema,
  finishRun,
  getRunningRun,
  insertFindings,
  insertRun,
  reclaimStaleRunningRuns,
} from "./persist";
import { ALL_RULES } from "./rules";
import { aggregateScores, severityFromPoints } from "./score";
import type {
  AdComputerRow,
  AdGroupRow,
  AdUserRow,
  HealthFinding,
  HealthScore,
  PrivilegeMatrix,
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
      primaryGroupId: extras.userPrimaryGroupIdBySam.get(sam) ?? null,
      adminCount: extras.userAdminCountBySam.get(sam) ?? null,
      description: extras.userDescriptionBySam.get(sam) ?? null,
      sidHistory: extras.userSidHistoryBySam.get(sam) ?? [],
      allowedToDelegateTo: extras.userAllowedToDelegateToBySam.get(sam) ?? [],
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
      passwordLastSetAt: extras.computerPwdLastSetBySam.get(sam) ?? null,
      operatingSystem: c.operating_system,
      uac: extras.computerUacBySam.get(sam) ?? null,
      isDomainController: extras.computerIsDcBySam.get(sam) ?? false,
      isRodc: extras.computerIsRodcBySam.get(sam) ?? false,
      allowedToDelegateTo: extras.computerAllowedToDelegateToBySam.get(sam) ?? [],
      allowedToActOnBehalfOf: extras.computerAllowedToActOnBehalfOfBySam.get(sam) ?? false,
      lapsPasswordPresent: extras.computerLapsPasswordPresentBySam.has(sam)
        ? (extras.computerLapsPasswordPresentBySam.get(sam) ?? null)
        : null,
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
): Promise<{
  runId: number;
  score: HealthScore;
  findings: HealthFinding[];
  privilegeMatrix: PrivilegeMatrix | null;
  acl: AclExtras | null;
  winrm: WinrmProbeResult | null;
  phase6: Record<string, unknown> | null;
}> {
  const db = getDb();
  ensureAdHealthSchema(db);

  // Reclaim stuck runs before conflict check so a crashed process cannot block forever.
  reclaimStaleRunningRuns(db, integrationId);

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

    // Fail the run on collect failure — do not degrade to empty extras / false positives.
    const extras = await collectLdapExtras(integrationId);

    // ACL collect is best-effort (Phase 4) — never fails the whole run.
    const acl = await collectAclExtras(integrationId);
    stats.acl = {
      meta: acl.meta,
      interestingAceCount: acl.meta.interestingAceCount,
      domainSid: acl.domainSid,
      interestingAces: acl.interestingAces,
    };

    // WinRM probe best-effort (Phase 5b / 6).
    const winrm = await collectWinrmProbe(integrationId);
    stats.winrm = winrm;
    stats.phase5 = {
      gpoCount: extras.gpos.length,
      siteCount: extras.siteCount,
      subnetCount: extras.subnetCount,
      gmsaCount: extras.gmsaCount,
    };
    const phase6 = {
      psoCount: extras.psoCount,
      shadowCredentialCount: extras.shadowCredentialDns.length,
      adcsStatus: extras.adcs.status,
      templateCount: extras.adcs.templates.length,
      esc1Count: extras.adcs.esc1Names.length,
      esc2Count: extras.adcs.esc2Names.length,
      esc1Names: extras.adcs.esc1Names.slice(0, 20),
      esc2Names: extras.adcs.esc2Names.slice(0, 20),
    };
    stats.phase6 = phase6;
    stats.adcs = {
      status: extras.adcs.status,
      errorMessage: extras.adcs.errorMessage,
      esc1Names: extras.adcs.esc1Names,
      esc2Names: extras.adcs.esc2Names,
      templateCount: extras.adcs.templates.length,
    };

    const users = toUserRows(dbUsers, extras);
    const groups = toGroupRows(dbGroups, extras);
    const now = new Date();
    const privilegeMatrix = buildPrivilegeMatrix(groups, users, now);
    stats.privilegeMatrix = privilegeMatrix;
    stats.privilegeSummary = {
      privilegedUsers: privilegeMatrix.users.filter((u) => u.enabled).length,
      columns: privilegeMatrix.groups.map((g) => ({
        key: g.key,
        members: g.memberCount,
        found: g.found,
      })),
    };

    const ctx: RuleContext = {
      now,
      domainFqdn: integration.domain,
      users,
      computers: toComputerRows(dbComputers, extras),
      groups,
      trusts: extras.trusts,
      krbtgtPasswordLastSetAt: extras.krbtgtPasswordLastSetAt,
      guestEnabled: extras.guestEnabled,
      recycleBinEnabled: extras.recycleBinEnabled,
      minPwdLength: extras.minPwdLength,
      lockoutThreshold: extras.lockoutThreshold,
      machineAccountQuota: extras.machineAccountQuota,
      lapsSchemaPresent: extras.lapsSchemaPresent,
      ldapsConfigured: extras.integrationUseSsl,
      privilegeMatrix,
      acl,
      gpos: extras.gpos,
      siteCount: extras.siteCount,
      subnetCount: extras.subnetCount,
      gmsaCount: extras.gmsaCount,
      winrm,
      adcs: extras.adcs,
      psoCount: extras.psoCount,
      shadowCredentialDns: extras.shadowCredentialDns,
    };

    const { score, findings } = evaluateContext(ctx);
    insertFindings(db, runId, findings);
    finishRun(db, runId, { status: "ok", score, statsJson: stats });
    return { runId, score, findings, privilegeMatrix, acl, winrm, phase6 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    finishRun(db, runId, { status: "error", errorMessage: message, statsJson: stats });
    throw err;
  }
}

/** Parse privilegeMatrix from a run's stats_json, if present. */
export function privilegeMatrixFromStatsJson(
  statsJson: string | null | undefined,
): PrivilegeMatrix | null {
  if (!statsJson) return null;
  try {
    const parsed = JSON.parse(statsJson) as { privilegeMatrix?: unknown };
    const m = parsed.privilegeMatrix;
    if (!m || typeof m !== "object") return null;
    const obj = m as PrivilegeMatrix;
    if (!Array.isArray(obj.groups) || !Array.isArray(obj.users)) return null;
    return obj;
  } catch {
    return null;
  }
}

/** Parse acl extras from a run's stats_json, if present. */
export function aclFromStatsJson(
  statsJson: string | null | undefined,
): AclExtras | null {
  if (!statsJson) return null;
  try {
    const parsed = JSON.parse(statsJson) as { acl?: unknown };
    const a = parsed.acl;
    if (!a || typeof a !== "object") return null;
    const obj = a as AclExtras;
    if (!obj.meta || !Array.isArray(obj.interestingAces)) return null;
    return obj;
  } catch {
    return null;
  }
}
