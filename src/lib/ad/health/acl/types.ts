/** ACL collect types for AD Health Phase 4. */

export type AclObjectKind =
  | "domain"
  | "adminsdholder"
  | "ou"
  | "user"
  | "group"
  | "computer";

export type AclCollectStatus = "ok" | "partial" | "unavailable";

export interface AclCollectMeta {
  status: AclCollectStatus;
  objectsScanned: number;
  sdParsed: number;
  interestingAceCount: number;
  truncated: boolean;
  timedOut: boolean;
  errorMessage?: string;
  durationMs: number;
}

export interface InterestingAce {
  objectDn: string;
  objectKind: AclObjectKind;
  trusteeSid: string;
  trusteeSam: string | null;
  rights: string[];
  aceType: "allowed" | "allowed_object";
  inherited: boolean;
}

export interface SidPrincipal {
  sid: string;
  sam: string | null;
  dn: string;
  kind: AclObjectKind | "other";
}

export interface AclExtras {
  meta: AclCollectMeta;
  interestingAces: InterestingAce[];
  /** Domain object SID (for RID-relative expected trustees). */
  domainSid: string | null;
}

export interface ParsedAce {
  aceType: number;
  aceFlags: number;
  mask: number;
  sid: string;
  objectTypeGuid: string | null;
  inheritedObjectTypeGuid: string | null;
}

export interface ParsedSecurityDescriptor {
  ownerSid: string | null;
  groupSid: string | null;
  aces: ParsedAce[];
}

export const ACL_SD_CAP = 8_000;
export const ACL_TIMEOUT_MS = 90_000;
export const ACL_INTERESTING_CAP = 500;
export const SD_FLAGS_OWNER_GROUP_DACL = 7;
