import {
  MASK_DS_CONTROL_ACCESS,
  MASK_DS_WRITE_PROP,
  MASK_GENERIC_ALL,
  MASK_WRITE_DACL,
  MASK_WRITE_OWNER,
} from "./interesting-ace";
import {
  ACCESS_ALLOWED_ACE_TYPE,
  ACCESS_ALLOWED_OBJECT_ACE_TYPE,
  parseSecurityDescriptor,
} from "./security-descriptor";
import type { ParsedAce } from "./types";

const INHERIT_ONLY = 0x08;
export const CERTIFICATE_ENROLL = "0e10c968-78fb-11d2-90d4-00c04f79dc55";

export function isBroadTrustee(sid: string, domainSid?: string | null): boolean {
  return sid === "S-1-1-0" || sid === "S-1-5-11" || sid === "S-1-5-32-545"
    || Boolean(domainSid && (sid === `${domainSid}-513` || sid === `${domainSid}-515`));
}

/** Riscontri positivi sulle ACE, senza inferire l'accesso effettivo del token. */
export function appliesAllow(ace: ParsedAce): boolean {
  return (ace.aceFlags & INHERIT_ONLY) === 0 &&
    (ace.aceType === ACCESS_ALLOWED_ACE_TYPE || ace.aceType === ACCESS_ALLOWED_OBJECT_ACE_TYPE);
}

export function observesControlAccess(ace: ParsedAce, guid: string): boolean {
  return appliesAllow(ace) &&
    ((ace.objectTypeGuid === null && (ace.mask & MASK_GENERIC_ALL) !== 0) ||
      ((ace.mask & MASK_DS_CONTROL_ACCESS) !== 0 &&
        (ace.objectTypeGuid === null || ace.objectTypeGuid === guid)));
}

export interface TemplateDelegation {
  ownerSid: string | null;
  enrollSids: string[];
  editSids: string[];
  truncated: boolean;
}

export function templateDelegation(value: unknown): TemplateDelegation | null {
  if (!Buffer.isBuffer(value)) return null;
  try {
    const descriptor = parseSecurityDescriptor(value);
    const enroll = new Set<string>();
    const edit = new Set<string>();
    for (const ace of descriptor.aces) {
      if (observesControlAccess(ace, CERTIFICATE_ENROLL)) enroll.add(ace.sid);
      const unscopedWrite = MASK_GENERIC_ALL | MASK_DS_WRITE_PROP;
      if (appliesAllow(ace) && ((ace.mask & (MASK_WRITE_DACL | MASK_WRITE_OWNER)) !== 0 ||
        (ace.objectTypeGuid === null && (ace.mask & unscopedWrite) !== 0))) {
        edit.add(ace.sid);
      }
    }
    const limit = 100;
    return {
      ownerSid: descriptor.ownerSid,
      enrollSids: [...enroll].slice(0, limit),
      editSids: [...edit].slice(0, limit),
      truncated: enroll.size > limit || edit.size > limit,
    };
  } catch {
    return null;
  }
}
