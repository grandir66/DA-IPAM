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
  operatingSystem: string | null;
  uac: number | null;
  isDomainController: boolean;
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
}

export interface RuleDef {
  id: string;
  axis: Exclude<HealthAxis, "score">;
  points: number;
  title: string;
  run: (ctx: RuleContext) => HealthFinding | null; // null = no match
}

export const ENGINE_VERSION = "0.2.0";
export const SAMPLE_CAP = 50;
