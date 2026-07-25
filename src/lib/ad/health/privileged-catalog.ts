/**
 * Catalog of high-value / administrative AD groups for privilege matrix + rules.
 * Matching is by sAMAccountName / CN (case-insensitive). RID used for primaryGroupID.
 */

export type PrivilegeGroupKey =
  | "domain-admins"
  | "enterprise-admins"
  | "schema-admins"
  | "administrators"
  | "account-operators"
  | "backup-operators"
  | "server-operators"
  | "print-operators"
  | "gpo-creators"
  | "dns-admins"
  | "domain-controllers"
  | "protected-users";

export interface PrivilegeGroupDef {
  key: PrivilegeGroupKey;
  displayName: string;
  /** Names that match sAMAccountName or CN=… */
  names: string[];
  /** Well-known RID for primaryGroupID, if any. */
  rid: number | null;
  /**
   * If true, membership is desirable (gap when empty for admins).
   * If false, membership is a risk signal when populated.
   */
  membershipDesirable: boolean;
  /** Include as privilege column in the user×group matrix. */
  matrixColumn: boolean;
  /** Count toward "large privileged set" anomaly. */
  countsAsPrivilege: boolean;
}

export const PRIVILEGED_GROUPS: PrivilegeGroupDef[] = [
  {
    key: "domain-admins",
    displayName: "Domain Admins",
    names: ["domain admins"],
    rid: 512,
    membershipDesirable: false,
    matrixColumn: true,
    countsAsPrivilege: true,
  },
  {
    key: "enterprise-admins",
    displayName: "Enterprise Admins",
    names: ["enterprise admins"],
    rid: 519,
    membershipDesirable: false,
    matrixColumn: true,
    countsAsPrivilege: true,
  },
  {
    key: "schema-admins",
    displayName: "Schema Admins",
    names: ["schema admins"],
    rid: 518,
    membershipDesirable: false,
    matrixColumn: true,
    countsAsPrivilege: true,
  },
  {
    key: "administrators",
    displayName: "Administrators",
    names: ["administrators"],
    rid: 544,
    membershipDesirable: false,
    matrixColumn: true,
    countsAsPrivilege: true,
  },
  {
    key: "account-operators",
    displayName: "Account Operators",
    names: ["account operators"],
    rid: 548,
    membershipDesirable: false,
    matrixColumn: true,
    countsAsPrivilege: true,
  },
  {
    key: "backup-operators",
    displayName: "Backup Operators",
    names: ["backup operators"],
    rid: 551,
    membershipDesirable: false,
    matrixColumn: true,
    countsAsPrivilege: true,
  },
  {
    key: "server-operators",
    displayName: "Server Operators",
    names: ["server operators"],
    rid: 549,
    membershipDesirable: false,
    matrixColumn: true,
    countsAsPrivilege: true,
  },
  {
    key: "print-operators",
    displayName: "Print Operators",
    names: ["print operators"],
    rid: 550,
    membershipDesirable: false,
    matrixColumn: true,
    countsAsPrivilege: true,
  },
  {
    key: "gpo-creators",
    displayName: "Group Policy Creator Owners",
    names: ["group policy creator owners"],
    rid: 520,
    membershipDesirable: false,
    matrixColumn: true,
    countsAsPrivilege: true,
  },
  {
    key: "dns-admins",
    displayName: "DnsAdmins",
    names: ["dnsadmins", "dns admins"],
    rid: null,
    membershipDesirable: false,
    matrixColumn: true,
    countsAsPrivilege: true,
  },
  {
    key: "domain-controllers",
    displayName: "Domain Controllers",
    names: ["domain controllers"],
    rid: 516,
    membershipDesirable: false,
    matrixColumn: false,
    countsAsPrivilege: false,
  },
  {
    key: "protected-users",
    displayName: "Protected Users",
    names: ["protected users"],
    rid: null,
    membershipDesirable: true,
    matrixColumn: true,
    countsAsPrivilege: false,
  },
];

export const OPERATOR_KEYS: PrivilegeGroupKey[] = [
  "account-operators",
  "backup-operators",
  "server-operators",
  "print-operators",
];

export function normalizeGroupName(name: string): string {
  return name.trim().toLowerCase();
}

export function cnFromDn(dn: string): string {
  const first = dn.split(",")[0] ?? "";
  return first.replace(/^CN=/i, "").trim();
}

export function matchPrivilegeDef(
  samAccountName: string,
  distinguishedName: string,
): PrivilegeGroupDef | null {
  const sam = normalizeGroupName(samAccountName);
  const cn = normalizeGroupName(cnFromDn(distinguishedName));
  for (const def of PRIVILEGED_GROUPS) {
    if (def.names.some((n) => n === sam || n === cn)) return def;
  }
  return null;
}
