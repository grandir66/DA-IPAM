/**
 * Classify and filter interesting ACE from parsed security descriptors.
 */

import {
  ACCESS_ALLOWED_ACE_TYPE,
  ACCESS_ALLOWED_OBJECT_ACE_TYPE,
  INHERITED_ACE,
} from "./security-descriptor";
import {
  isExpectedAdminSdHolderTrustee,
  isExpectedDomainTrustee,
} from "./well-known-sids";
import type {
  AclObjectKind,
  InterestingAce,
  ParsedAce,
  SidPrincipal,
} from "./types";

/** Access masks (ADS_RIGHT / ACCESS_MASK). */
export const MASK_GENERIC_ALL = 0x10000000;
export const MASK_WRITE_DACL = 0x00040000;
export const MASK_WRITE_OWNER = 0x00080000;
export const MASK_DS_CONTROL_ACCESS = 0x00000100;
export const MASK_DS_WRITE_PROP = 0x00000020;

export const GUID_DS_REPL_GET_CHANGES = "1131f6aa-9c07-11d1-f79f-00c04fc2dcd2";
export const GUID_DS_REPL_GET_CHANGES_ALL = "1131f6ad-9c07-11d1-f79f-00c04fc2dcd2";
export const GUID_FORCE_CHANGE_PASSWORD = "00299570-246d-11d0-a768-00aa006e0529";
export const GUID_MEMBER = "bf9679c0-0de6-11d0-a285-00aa003049e2";

function normGuid(g: string | null): string | null {
  return g ? g.toLowerCase() : null;
}

/** Rights labels for a single allow ACE (empty = not interesting). */
export function classifyAceRights(ace: ParsedAce): string[] {
  if (
    ace.aceType !== ACCESS_ALLOWED_ACE_TYPE &&
    ace.aceType !== ACCESS_ALLOWED_OBJECT_ACE_TYPE
  ) {
    return [];
  }
  const rights: string[] = [];
  const mask = ace.mask >>> 0;
  const ot = normGuid(ace.objectTypeGuid);

  if (mask & MASK_GENERIC_ALL) rights.push("GenericAll");
  if (mask & MASK_WRITE_DACL) rights.push("WriteDacl");
  if (mask & MASK_WRITE_OWNER) rights.push("WriteOwner");

  if (ot === GUID_DS_REPL_GET_CHANGES) rights.push("DCSync-GetChanges");
  if (ot === GUID_DS_REPL_GET_CHANGES_ALL) rights.push("DCSync-GetChangesAll");
  if (ot === GUID_FORCE_CHANGE_PASSWORD) rights.push("ForceChangePassword");
  if (ot === GUID_MEMBER && mask & MASK_DS_WRITE_PROP) rights.push("AddMember");

  // Control access without specific object type ≈ AllExtendedRights
  if (
    ace.aceType === ACCESS_ALLOWED_ACE_TYPE &&
    mask & MASK_DS_CONTROL_ACCESS &&
    !ot
  ) {
    rights.push("AllExtendedRights");
  }
  if (
    ace.aceType === ACCESS_ALLOWED_OBJECT_ACE_TYPE &&
    mask & MASK_DS_CONTROL_ACCESS &&
    !ot &&
    rights.length === 0
  ) {
    rights.push("AllExtendedRights");
  }

  return [...new Set(rights)];
}

export function aceToInteresting(
  ace: ParsedAce,
  objectDn: string,
  objectKind: AclObjectKind,
  sidMap: Map<string, SidPrincipal>,
): InterestingAce | null {
  const rights = classifyAceRights(ace);
  if (rights.length === 0) return null;
  const trusteeSid = ace.sid;
  const principal = sidMap.get(trusteeSid.toUpperCase()) ?? sidMap.get(trusteeSid);
  return {
    objectDn,
    objectKind,
    trusteeSid,
    trusteeSam: principal?.sam ?? null,
    rights,
    aceType: ace.aceType === ACCESS_ALLOWED_OBJECT_ACE_TYPE ? "allowed_object" : "allowed",
    inherited: (ace.aceFlags & INHERITED_ACE) !== 0,
  };
}

/**
 * Keep interesting ACEs, dropping expected trustees on domain / AdminSDHolder
 * for DCSync/GenericAll/extended rights noise.
 */
export function shouldKeepInteresting(
  ace: InterestingAce,
  domainSid: string | null,
): boolean {
  if (ace.objectKind === "domain") {
    const dcsyncOrGa = ace.rights.some(
      (r) =>
        r === "GenericAll" ||
        r === "DCSync-GetChanges" ||
        r === "DCSync-GetChangesAll" ||
        r === "AllExtendedRights" ||
        r === "WriteDacl" ||
        r === "WriteOwner",
    );
    if (dcsyncOrGa && isExpectedDomainTrustee(ace.trusteeSid, domainSid)) {
      return false;
    }
  }
  if (ace.objectKind === "adminsdholder") {
    if (isExpectedAdminSdHolderTrustee(ace.trusteeSid, domainSid)) {
      return false;
    }
  }
  return true;
}

export function filterInterestingFromAces(args: {
  aces: ParsedAce[];
  objectDn: string;
  objectKind: AclObjectKind;
  domainSid: string | null;
  sidMap: Map<string, SidPrincipal>;
}): InterestingAce[] {
  const out: InterestingAce[] = [];
  for (const ace of args.aces) {
    const interesting = aceToInteresting(
      ace,
      args.objectDn,
      args.objectKind,
      args.sidMap,
    );
    if (!interesting) continue;
    if (!shouldKeepInteresting(interesting, args.domainSid)) continue;
    out.push(interesting);
  }
  return out;
}

/** Aggregate: trustee has both DCSync GUIDs (or GenericAll) on domain. */
/** Higher = more important when capping persisted ACE list. */
export function interestingAcePriority(ace: InterestingAce): number {
  const rights = new Set(ace.rights);
  if (rights.has("GenericAll") || rights.has("DCSync-GetChangesAll") || rights.has("DCSync-GetChanges")) {
    return 100;
  }
  if (rights.has("WriteDacl") || rights.has("WriteOwner") || rights.has("AllExtendedRights")) {
    return 80;
  }
  if (ace.objectKind === "adminsdholder") return 70;
  if (rights.has("AddMember")) return 50;
  // ForceChangePassword alone on domain is common Azure/MSOL noise
  if (rights.has("ForceChangePassword") && ace.rights.length === 1) return 15;
  return 40;
}

/** Sort + diversify before applying the persistence cap. */
export function rankInterestingAces(aces: InterestingAce[]): InterestingAce[] {
  return [...aces].sort((a, b) => {
    const p = interestingAcePriority(b) - interestingAcePriority(a);
    if (p !== 0) return p;
    if (a.objectKind !== b.objectKind) return a.objectKind.localeCompare(b.objectKind);
    return (a.trusteeSam ?? a.trusteeSid).localeCompare(b.trusteeSam ?? b.trusteeSid);
  });
}

export function dcsyncPrincipals(aces: InterestingAce[]): InterestingAce[] {
  const domain = aces.filter((a) => a.objectKind === "domain");
  const bySid = new Map<string, Set<string>>();
  const samples = new Map<string, InterestingAce>();
  for (const a of domain) {
    const set = bySid.get(a.trusteeSid) ?? new Set();
    for (const r of a.rights) set.add(r);
    bySid.set(a.trusteeSid, set);
    samples.set(a.trusteeSid, a);
  }
  const hits: InterestingAce[] = [];
  for (const [sid, rights] of bySid) {
    const ga = rights.has("GenericAll");
    const both =
      rights.has("DCSync-GetChanges") && rights.has("DCSync-GetChangesAll");
    if (ga || both) {
      const sample = samples.get(sid)!;
      hits.push({
        ...sample,
        rights: ga
          ? ["GenericAll", ...[...rights].filter((r) => r !== "GenericAll")]
          : ["DCSync-GetChanges", "DCSync-GetChangesAll"],
      });
    }
  }
  return hits;
}
