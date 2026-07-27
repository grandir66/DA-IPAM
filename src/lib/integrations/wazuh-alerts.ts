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
  /**
   * Categoria assegnata solo per riclassificazione, mai per corrispondenza sui
   * rule.groups: non partecipa a categorizeAlert, alla query, ne' alla soglia.
   */
  assignedOnly?: boolean;
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
      "invalid_login",
      "sshd",
      "pam",
    ],
    // Soglia 5, non 8: misurato sul campo, 1.505 logon falliti su 1.506 scattano
    // come "Logon Failure - Unknown user or bad password" a livello 5. Solo la
    // regola di correlazione ("Multiple Windows Logon Failures") arriva a 10, e
    // filtrare a 8 rendeva invisibile praticamente tutto il segnale. Il dedup
    // per (agent, regola) impedisce che il volume diventi rumore.
    minLevel: 5,
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
    // I fallimenti di accesso Microsoft 365 scattano a livello 3: filtrare piu'
    // in alto li rendeva invisibili. Il gruppo contiene pero' anche gli accessi
    // RIUSCITI, separati in normalizeAlert guardando l'Operation.
    id: "cloud_auth_failure",
    labelIt: "Fallimenti accesso cloud (Microsoft 365)",
    groups: ["AzureActiveDirectoryStsLogon"],
    minLevel: 3,
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
  {
    // DA-IPAM autentica davvero contro gli host Windows (probe WinRM, patch
    // management, inventario software): con una credenziale scaduta genererebbe
    // valanghe di 4625 e poi le segnalerebbe come attacco. Resta visibile —
    // serve accorgersi che una nostra credenziale non funziona piu' — ma non e'
    // una minaccia e non concorre a DA-A-BruteForceActivity.
    id: "self_probe",
    labelIt: "Attività delle nostre sonde",
    groups: ["authentication_failed", "authentication_failures"],
    minLevel: 1,
    diagnostic: true,
    assignedOnly: true,
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
  return [...new Set(ALERT_CATEGORIES.filter((c) => !c.assignedOnly).flatMap((c) => c.groups))];
}

/**
 * Soglia di livello per la query: la più bassa richiesta da una qualsiasi
 * categoria. Filtrare più in alto scarterebbe alert nell'indexer prima che le
 * soglie per-categoria possano vederli, e il dato sarebbe perso per sempre.
 */
export function minSelectedLevel(): number {
  return ALERT_CATEGORIES.filter((c) => !c.assignedOnly).reduce(
    (min, c) => Math.min(min, c.minLevel),
    Number.MAX_SAFE_INTEGER,
  );
}

/** First category whose groups intersect `groups`; null when none matches. */
export function categorizeAlert(groups: string[] | undefined): string | null {
  if (!groups || groups.length === 0) return null;
  const set = new Set(groups);
  const hit = ALERT_CATEGORIES.find(
    (c) => !c.assignedOnly && c.groups.some((g) => set.has(g)),
  );
  return hit ? hit.id : null;
}

/**
 * Identita' con cui DA-IPAM stesso (o lo Scanner-Edge) si presenta agli host.
 * Serve a non scambiare le nostre sonde per un attacco.
 */
export interface SelfIdentity {
  ips: string[];
  accounts: string[];
}

/** "::ffff:172.16.1.154" → "172.16.1.154". Windows logga la forma mappata. */
export function normalizeIp(ip: string | null | undefined): string | null {
  if (ip == null) return null;
  const t = ip.trim();
  if (t === "" || t === "-") return null;
  return t.replace(/^::ffff:/i, "");
}

/** "DTS\\domarc" e "domarc@dts.local" sono lo stesso account. */
export function normalizeAccount(user: string | null | undefined): string | null {
  if (user == null) return null;
  let t = user.trim();
  if (t === "" || t === "-") return null;
  const slash = t.lastIndexOf("\\");
  if (slash >= 0) t = t.slice(slash + 1);
  const at = t.indexOf("@");
  if (at > 0) t = t.slice(0, at);
  return t.toLowerCase();
}

export function isSelfOrigin(
  args: { sourceIp: string | null; targetUser: string | null },
  self: SelfIdentity | undefined,
): boolean {
  if (!self) return false;
  const ip = normalizeIp(args.sourceIp);
  if (ip && self.ips.some((s) => normalizeIp(s) === ip)) return true;
  const user = normalizeAccount(args.targetUser);
  if (user && self.accounts.some((a) => normalizeAccount(a) === user)) return true;
  return false;
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
    /** Decoder generici Wazuh (sshd, pam, sudo, apparati syslog). */
    srcuser?: string;
    dstuser?: string;
    srcip?: string;
    office365?: {
      Operation?: string;
      UserId?: string;
      ClientIP?: string;
    };
  };
}

/** Sistema da cui proviene l'alert: serve a leggere la colonna account. */
export type SourceSystem = "windows" | "microsoft365" | "linux" | "altro";

/** Operazioni Microsoft 365 che rappresentano un accesso FALLITO. */
const O365_FAILURE_OPS = new Set(["UserLoginFailed"]);

/** Un account che finisce con $ e' un account computer, non una persona. */
export function accountKind(user: string | null | undefined): "utente" | "computer" {
  return user && user.trim().endsWith("$") ? "computer" : "utente";
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
  /** Postazione dichiarata dall'evento Windows, quando presente. */
  workstation: string | null;
  sourceSystem: SourceSystem;
  accountKind: "utente" | "computer";
}

export function normalizeAlert(
  doc: WazuhAlertDoc,
  hitId: string,
  self?: SelfIdentity,
): NormalizedAlert {
  const groups = doc.rule?.groups ?? [];
  const ed = doc.data?.win?.eventdata;
  const o365 = doc.data?.office365;

  // Ogni sorgente usa un campo diverso: Windows targetUserName, Microsoft 365
  // UserId, i decoder generici srcuser/dstuser.
  const targetUser =
    ed?.targetUserName ?? o365?.UserId ?? doc.data?.srcuser ?? doc.data?.dstuser ?? ed?.subjectUserName ?? null;
  const sourceIp =
    normalizeIp(ed?.ipAddress) ?? normalizeIp(o365?.ClientIP) ?? normalizeIp(doc.data?.srcip) ?? null;
  const workstation = ed?.workstationName ?? null;

  const sourceSystem: SourceSystem = ed
    ? "windows"
    : o365 || groups.includes("office365")
      ? "microsoft365"
      : doc.data?.srcuser || doc.data?.dstuser || groups.some((g) => g === "sshd" || g === "pam" || g === "sudo")
        ? "linux"
        : "altro";

  let matched = categorizeAlert(groups);
  // Microsoft 365: lo stesso gruppo porta accessi riusciti e falliti. Senza
  // guardare l'Operation si archivierebbero i login riusciti come attacchi.
  if (matched === "cloud_auth_failure" && !O365_FAILURE_OPS.has(o365?.Operation ?? "")) {
    matched = null;
  }
  // Riclassifica solo cio' che sarebbe finito fra i fallimenti di
  // autenticazione: un ransomware non diventa "nostra sonda" per via dell'IP.
  const category =
(matched === "auth_failure" || matched === "cloud_auth_failure") &&
    isSelfOrigin({ sourceIp, targetUser }, self)
      ? "self_probe"
      : matched;
  return {
    id: hitId,
    timestamp: doc["@timestamp"],
    agentId: doc.agent?.id ?? null,
    agentName: doc.agent?.name ?? null,
    ruleId: doc.rule?.id ?? null,
    ruleLevel: doc.rule?.level ?? 0,
    ruleDescription: doc.rule?.description ?? "",
    groups,
    category,
    eventId: doc.data?.win?.system?.eventID ?? null,
    targetUser,
    sourceIp,
    workstation,
    sourceSystem,
    accountKind: accountKind(targetUser),
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
  /** Default: la soglia più bassa fra le categorie selezionate. */
  minLevel?: number;
  size: number;
  searchAfter?: unknown[];
}): AlertsQuery {
  const q: AlertsQuery = {
    size: args.size,
    query: {
      bool: {
        filter: [
          { range: { "@timestamp": { gte: args.since } } },
          { range: { "rule.level": { gte: args.minLevel ?? minSelectedLevel() } } },
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
