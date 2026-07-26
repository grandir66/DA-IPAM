import type { AdcsExtras } from "./adcs";
import type { AclExtras } from "./acl/types";

export type HealthAxis = "stale" | "privileged" | "trust" | "anomaly" | "score";
export type HealthSeverity = "Critical" | "High" | "Medium" | "Low";

export interface HealthFinding {
  ruleId: string;
  axis: HealthAxis;
  points: number;
  severity: HealthSeverity;
  title: string;
  description: string;
  objectCount: number;
  sampleDns: string[]; // max 50
  raw?: Record<string, unknown>;
}

export interface HealthScore {
  global: number;
  stale: number;
  privileged: number;
  trust: number;
  anomaly: number;
}

export interface AdUserRow {
  samAccountName: string;
  distinguishedName: string;
  enabled: boolean;
  lastLogonAt: string | null;
  passwordLastSetAt: string | null;
  uac: number | null;
  servicePrincipalNames: string[];
  memberOfDns: string[];
  /** LDAP primaryGroupID (RID); 512 = Domain Admins. */
  primaryGroupId: number | null;
  /** LDAP adminCount; 1 = protected/admin remnant. */
  adminCount: number | null;
  description: string | null;
  /** SID history values (strings); empty if none. */
  sidHistory: string[];
  /** Constrained delegation targets (msDS-AllowedToDelegateTo). */
  allowedToDelegateTo: string[];
}

export interface AdComputerRow {
  samAccountName: string;
  distinguishedName: string;
  enabled: boolean;
  lastLogonAt: string | null;
  passwordLastSetAt: string | null;
  operatingSystem: string | null;
  uac: number | null;
  isDomainController: boolean;
  isRodc: boolean;
  /** Constrained delegation targets (msDS-AllowedToDelegateTo). */
  allowedToDelegateTo: string[];
  /** True if msDS-AllowedToActOnBehalfOfOtherIdentity is present (RBCD). */
  allowedToActOnBehalfOf: boolean;
  /**
   * LAPS password attribute present (ms-Mcs-AdmPwd / msLAPS-Password).
   * null = unknown (ACL denied / query failed for that object).
   */
  lapsPasswordPresent: boolean | null;
}

export interface AdGroupRow {
  samAccountName: string;
  distinguishedName: string;
  memberDns: string[];
}

export interface AdTrustRow {
  name: string;
  trustDirection: number | null;
  trustType: number | null;
  trustAttributes: number | null;
}

/** TRUST_ATTRIBUTE_WITHIN_FOREST — exclude from external trust inventory. */
export const TRUST_ATTR_WITHIN_FOREST = 0x20;
/** TRUST_ATTRIBUTE_QUARANTINED_DOMAIN — SID filtering enabled. */
export const TRUST_ATTR_QUARANTINED_DOMAIN = 0x4;

export interface AdGpoRow {
  displayName: string;
  distinguishedName: string;
  gpcFileSysPath: string | null;
  flags: number | null;
}

/** Registry / service hardening sampled on DC via WinRM (Phase 6). */
export interface DcHardeningProbe {
  ldapServerIntegrity: number | null;
  ldapEnforceChannelBinding: number | null;
  smbRequireSecuritySignature: number | null;
  lmCompatibilityLevel: number | null;
  wdigestUseLogonCredential: number | null;
  spoolerRunning: boolean | null;
}

export interface WinrmProbeResult {
  /** null = WinRM not configured on integration (skip related rules). */
  configured: boolean;
  status: "ok" | "unavailable" | "skipped";
  errorMessage?: string;
  lastHotfixAt: string | null;
  missingCriticalKbs: string[];
  cpasswordPaths: string[];
  durationMs: number;
  /** Present when probe status is ok (may still have null fields). */
  hardening?: DcHardeningProbe | null;
}

/** How a user reaches a privileged group. */
export type PrivilegeMembershipKind = "direct" | "nested" | "primary";

export interface PrivilegeMatrixGroupCol {
  key: string;
  displayName: string;
  /** Enabled user members (any path). */
  memberCount: number;
  /** Whether the group object was found in LDAP cache. */
  found: boolean;
}

export interface PrivilegeMatrixUserRow {
  sam: string;
  dn: string;
  enabled: boolean;
  /** groupKey → membership kind (null = not a member). */
  cells: Record<string, PrivilegeMembershipKind | null>;
  /** Nested path (intermediate group sAMAccountNames) when kind is nested. */
  paths?: Record<string, string[]>;
}

export interface PrivilegeMatrix {
  groups: PrivilegeMatrixGroupCol[];
  users: PrivilegeMatrixUserRow[];
  generatedAt: string;
  truncated: boolean;
}

export interface RuleContext {
  now: Date;
  domainFqdn: string;
  users: AdUserRow[];
  computers: AdComputerRow[];
  groups: AdGroupRow[];
  trusts: AdTrustRow[];
  krbtgtPasswordLastSetAt: string | null;
  guestEnabled: boolean | null;
  recycleBinEnabled: boolean | null;
  /** Domain minPwdLength; null if unreadable. */
  minPwdLength: number | null;
  /** Domain lockoutThreshold; null if unreadable. */
  lockoutThreshold: number | null;
  /** Domain ms-DS-MachineAccountQuota; null if unreadable. */
  machineAccountQuota: number | null;
  /**
   * LAPS schema / collect status:
   * true = attrs readable; false = schema absent (0 coverage after successful read);
   * null = unknown (skip rule — no false positive).
   */
  lapsSchemaPresent: boolean | null;
  /** Domarc integration use_ssl / LDAPS configured. */
  ldapsConfigured: boolean;
  /**
   * Precomputed privilege matrix (engine). Rules may also call expandAllPrivileges.
   * Optional for unit tests that build minimal contexts.
   */
  privilegeMatrix?: PrivilegeMatrix | null;
  /**
   * ACL collect extras (Phase 4). Optional — rules skip when absent/unavailable.
   */
  acl?: AclExtras | null;
  /** GPO inventory (Phase 5). */
  gpos?: AdGpoRow[];
  /** Sites / subnets counts from Configuration NC. */
  siteCount?: number | null;
  subnetCount?: number | null;
  /** gMSA objects found. */
  gmsaCount?: number | null;
  /** WinRM probe on DC (Phase 5b / 6). */
  winrm?: WinrmProbeResult | null;
  /** ADCS certificate templates (Phase 6). */
  adcs?: AdcsExtras | null;
  /** Fine-grained Password Settings Objects count; null = unread. */
  psoCount?: number | null;
  /** Users with msDS-KeyCredentialLink (shadow credentials). */
  shadowCredentialDns?: string[];
}

export interface RuleDef {
  id: string;
  axis: Exclude<HealthAxis, "score">;
  points: number;
  title: string;
  run: (ctx: RuleContext) => HealthFinding | null; // null = no match
}

export const ENGINE_VERSION = "0.6.0";
export const SAMPLE_CAP = 50;

/** Threshold for DA-A-LargePrivilegedSet. */
export const LARGE_PRIVILEGED_SET_ABOVE = 15;

/** DC machine account password age warn (days). */
export const DC_PWD_MAX_DAYS = 45;

/** DC last hotfix age warn (days). */
export const DC_HOTFIX_MAX_DAYS = 90;
