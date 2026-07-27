/**
 * Curated selection of Wazuh alerts worth surfacing in DA-IPAM.
 *
 * Pure module (no I/O): query building, categorisation and normalisation, so
 * the selection can be unit-tested without an indexer.
 *
 * Why a selection and not "all alerts": measured on a live appliance, the
 * `wazuh-alerts-*` index held ~390M documents, and even at rule.level >= 10 the
 * top entry was operational noise. Forwarding everything would bury the signal.
 * The groups below were chosen against that real distribution; the ones
 * deliberately left out are documented in EXCLUDED_GROUPS.
 */

export interface AlertCategory {
  id: string;
  labelIt: string;
  /** Wazuh rule.groups that map to this category. */
  groups: string[];
  /** Minimum rule.level worth storing for this category. */
  minLevel: number;
  /**
   * Reports collector/agent health rather than a threat — same distinction the
   * AD Health engine makes for its diagnostic findings.
   */
  diagnostic?: boolean;
}

export const ALERT_CATEGORIES: AlertCategory[] = [
  {
    id: "ransomware",
    labelIt: "Sospetto ransomware",
    groups: ["ransomware_detection"],
    minLevel: 10,
  },
  {
    id: "auth_failure",
    labelIt: "Fallimenti di autenticazione",
    groups: [
      "authentication_failures",
      "authentication_failed",
      "win_authentication_failed",
      "sshd",
      "pam",
    ],
    minLevel: 8,
  },
  {
    id: "privileged_change",
    labelIt: "Modifiche ad account e gruppi privilegiati",
    groups: [
      "policy_changed",
      "account_changed",
      "adduser",
      "windows_security_group_changed",
    ],
    minLevel: 8,
  },
  {
    id: "log_tampering",
    labelIt: "Manomissione dei log",
    groups: ["audit_log_cleared", "logs_cleared"],
    minLevel: 8,
  },
  {
    id: "agent_health",
    labelIt: "Salute degli agent",
    groups: ["agent_flooding", "agent_disconnected"],
    minLevel: 8,
    diagnostic: true,
  },
];

/**
 * Groups intentionally NOT collected, with the reason. Kept in code so the
 * omission is a decision on record rather than an oversight.
 */
export const EXCLUDED_GROUPS: Record<string, string> = {
  windows_system: "rumore operativo ('Multiple System error events')",
  windows_application: "rumore operativo ('Multiple Windows error application events')",
  "vulnerability-detector": "già coperto dal sync CVE esistente (wazuh_vuln)",
};

/** All groups pulled from the indexer. */
export function selectedGroups(): string[] {
  return ALERT_CATEGORIES.flatMap((c) => c.groups);
}

/** First category whose groups intersect `groups`; null when none matches. */
export function categorizeAlert(groups: string[] | undefined): string | null {
  if (!groups || groups.length === 0) return null;
  const set = new Set(groups);
  const hit = ALERT_CATEGORIES.find((c) => c.groups.some((g) => set.has(g)));
  return hit ? hit.id : null;
}

export function categoryById(id: string): AlertCategory | undefined {
  return ALERT_CATEGORIES.find((c) => c.id === id);
}

export interface WazuhAlertDoc {
  "@timestamp": string;
  agent?: { id?: string; name?: string };
  rule?: {
    id?: string;
    level?: number;
    description?: string;
    groups?: string[];
  };
  data?: {
    win?: {
      system?: { eventID?: string };
      eventdata?: Record<string, string | undefined>;
    };
  };
}

export interface NormalizedAlert {
  id: string;
  timestamp: string;
  agentId: string | null;
  agentName: string | null;
  ruleId: string | null;
  ruleLevel: number;
  ruleDescription: string;
  groups: string[];
  category: string | null;
  /** Windows Security event id (4625, 4740, …) when the alert carries one. */
  eventId: string | null;
  targetUser: string | null;
  sourceIp: string | null;
}

export function normalizeAlert(doc: WazuhAlertDoc, hitId: string): NormalizedAlert {
  const groups = doc.rule?.groups ?? [];
  const ed = doc.data?.win?.eventdata;
  return {
    id: hitId,
    timestamp: doc["@timestamp"],
    agentId: doc.agent?.id ?? null,
    agentName: doc.agent?.name ?? null,
    ruleId: doc.rule?.id ?? null,
    ruleLevel: doc.rule?.level ?? 0,
    ruleDescription: doc.rule?.description ?? "",
    groups,
    category: categorizeAlert(groups),
    eventId: doc.data?.win?.system?.eventID ?? null,
    targetUser: ed?.targetUserName ?? ed?.subjectUserName ?? null,
    sourceIp: ed?.ipAddress ?? null,
  };
}

/**
 * Collapses the same rule repeating on the same agent, so a brute-force burst
 * becomes one open event instead of hundreds.
 */
export function dedupKey(a: NormalizedAlert): string {
  return `${a.agentId ?? "?"}|${a.ruleId ?? "?"}`;
}

type RangeFilter = {
  range: {
    "@timestamp"?: { gte: string };
    "rule.level"?: { gte: number };
  };
};
type TermsFilter = { terms: { "rule.groups": string[] } };

export interface AlertsQuery {
  size: number;
  query: { bool: { filter: Array<RangeFilter | TermsFilter> } };
  sort: Array<Record<string, string>>;
  search_after?: unknown[];
}

export function buildAlertsQuery(args: {
  since: string;
  minLevel: number;
  size: number;
  searchAfter?: unknown[];
}): AlertsQuery {
  const q: AlertsQuery = {
    size: args.size,
    query: {
      bool: {
        filter: [
          { range: { "@timestamp": { gte: args.since } } },
          { range: { "rule.level": { gte: args.minLevel } } },
          { terms: { "rule.groups": selectedGroups() } },
        ],
      },
    },
    // Ascending + tiebreak on _id so search_after paging never skips or repeats
    sort: [{ "@timestamp": "asc" }, { _id: "asc" }],
  };
  if (args.searchAfter) q.search_after = args.searchAfter;
  return q;
}
