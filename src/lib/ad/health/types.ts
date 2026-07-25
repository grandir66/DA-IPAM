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
}

export interface AdComputerRow {
  samAccountName: string;
  distinguishedName: string;
  enabled: boolean;
  lastLogonAt: string | null;
  operatingSystem: string | null;
  uac: number | null;
  isDomainController: boolean;
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
}

export interface RuleDef {
  id: string;
  axis: Exclude<HealthAxis, "score">;
  points: number;
  title: string;
  run: (ctx: RuleContext) => HealthFinding | null; // null = no match
}

export const ENGINE_VERSION = "0.1.0";
export const SAMPLE_CAP = 50;
