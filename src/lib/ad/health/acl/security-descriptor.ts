/**
 * Parse self-relative SECURITY_DESCRIPTOR (MS-DTYP 2.4.6) + DACL ACEs.
 */

import { sidToString, stringToSid } from "./sid";
import type { ParsedAce, ParsedSecurityDescriptor } from "./types";

export const ACCESS_ALLOWED_ACE_TYPE = 0x00;
export const ACCESS_DENIED_ACE_TYPE = 0x01;
export const ACCESS_ALLOWED_OBJECT_ACE_TYPE = 0x05;
export const ACCESS_DENIED_OBJECT_ACE_TYPE = 0x06;

export const ACE_OBJECT_TYPE_PRESENT = 0x1;
export const ACE_INHERITED_OBJECT_TYPE_PRESENT = 0x2;

export const INHERITED_ACE = 0x10;

/** Microsoft GUID binary (16 bytes) → canonical string. */
export function guidFromMsBytes(buf: Buffer, offset = 0): string {
  if (buf.length < offset + 16) throw new Error("GUID buffer too short");
  const d1 = buf.readUInt32LE(offset);
  const d2 = buf.readUInt16LE(offset + 4);
  const d3 = buf.readUInt16LE(offset + 6);
  const d4 = buf.subarray(offset + 8, offset + 16);
  const hex = (n: number, w: number) => n.toString(16).padStart(w, "0");
  return (
    `${hex(d1, 8)}-${hex(d2, 4)}-${hex(d3, 4)}-` +
    `${d4.subarray(0, 2).toString("hex")}-${d4.subarray(2).toString("hex")}`
  ).toLowerCase();
}

/** Canonical GUID string → Microsoft 16-byte form. */
export function msBytesFromGuid(guid: string): Buffer {
  const clean = guid.replace(/[{}]/g, "").toLowerCase();
  const m =
    /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/.exec(
      clean,
    );
  if (!m) throw new Error(`Invalid GUID: ${guid}`);
  const buf = Buffer.alloc(16);
  buf.writeUInt32LE(parseInt(m[1]!, 16), 0);
  buf.writeUInt16LE(parseInt(m[2]!, 16), 4);
  buf.writeUInt16LE(parseInt(m[3]!, 16), 6);
  Buffer.from(m[4]!, "hex").copy(buf, 8);
  Buffer.from(m[5]!, "hex").copy(buf, 10);
  return buf;
}

function readSidAt(buf: Buffer, offset: number): { sid: string; size: number } {
  if (offset < 0 || offset + 8 > buf.length) throw new Error("SID offset OOB");
  const subCount = buf.readUInt8(offset + 1);
  const size = 8 + subCount * 4;
  if (offset + size > buf.length) throw new Error("SID truncated");
  return { sid: sidToString(buf.subarray(offset, offset + size)), size };
}

function parseAce(buf: Buffer, offset: number): { ace: ParsedAce; size: number } {
  const aceType = buf.readUInt8(offset);
  const aceFlags = buf.readUInt8(offset + 1);
  const aceSize = buf.readUInt16LE(offset + 2);
  if (aceSize < 8 || offset + aceSize > buf.length) {
    throw new Error("Invalid ACE size");
  }
  const body = buf.subarray(offset + 4, offset + aceSize);

  if (aceType === ACCESS_ALLOWED_ACE_TYPE || aceType === ACCESS_DENIED_ACE_TYPE) {
    const mask = body.readUInt32LE(0);
    const { sid } = readSidAt(body, 4);
    return {
      ace: {
        aceType,
        aceFlags,
        mask,
        sid,
        objectTypeGuid: null,
        inheritedObjectTypeGuid: null,
      },
      size: aceSize,
    };
  }

  if (
    aceType === ACCESS_ALLOWED_OBJECT_ACE_TYPE ||
    aceType === ACCESS_DENIED_OBJECT_ACE_TYPE
  ) {
    const mask = body.readUInt32LE(0);
    const flags = body.readUInt32LE(4);
    let pos = 8;
    let objectTypeGuid: string | null = null;
    let inheritedObjectTypeGuid: string | null = null;
    if (flags & ACE_OBJECT_TYPE_PRESENT) {
      objectTypeGuid = guidFromMsBytes(body, pos);
      pos += 16;
    }
    if (flags & ACE_INHERITED_OBJECT_TYPE_PRESENT) {
      inheritedObjectTypeGuid = guidFromMsBytes(body, pos);
      pos += 16;
    }
    const { sid } = readSidAt(body, pos);
    return {
      ace: {
        aceType,
        aceFlags,
        mask,
        sid,
        objectTypeGuid,
        inheritedObjectTypeGuid,
      },
      size: aceSize,
    };
  }

  // Unknown ACE — skip body, return opaque with empty sid
  return {
    ace: {
      aceType,
      aceFlags,
      mask: 0,
      sid: "",
      objectTypeGuid: null,
      inheritedObjectTypeGuid: null,
    },
    size: aceSize,
  };
}

export function parseSecurityDescriptor(buf: Buffer): ParsedSecurityDescriptor {
  if (buf.length < 20) throw new Error("SD too short");
  // revision = buf[0], sbz1 = buf[1], control = buf.readUInt16LE(2)
  const offsetOwner = buf.readUInt32LE(4);
  const offsetGroup = buf.readUInt32LE(8);
  // offsetSacl = buf.readUInt32LE(12)
  const offsetDacl = buf.readUInt32LE(16);

  let ownerSid: string | null = null;
  let groupSid: string | null = null;
  if (offsetOwner > 0) ownerSid = readSidAt(buf, offsetOwner).sid;
  if (offsetGroup > 0) groupSid = readSidAt(buf, offsetGroup).sid;

  const aces: ParsedAce[] = [];
  if (offsetDacl > 0 && offsetDacl + 8 <= buf.length) {
    // ACL header
    const aceCount = buf.readUInt16LE(offsetDacl + 4);
    let pos = offsetDacl + 8;
    for (let i = 0; i < aceCount; i++) {
      if (pos + 4 > buf.length) break;
      try {
        const { ace, size } = parseAce(buf, pos);
        if (ace.sid) aces.push(ace);
        pos += size;
      } catch {
        break;
      }
    }
  }

  return { ownerSid, groupSid, aces };
}

/** Build a minimal self-relative SD with DACL only (for tests). */
export function buildSecurityDescriptor(args: {
  ownerSid: string;
  groupSid?: string;
  aces: Buffer[]; // raw ACE buffers (with headers)
}): Buffer {
  const owner = stringToSid(args.ownerSid);
  const group = stringToSid(args.groupSid ?? args.ownerSid);
  const aceBlob = Buffer.concat(args.aces);
  const aclSize = 8 + aceBlob.length;
  const acl = Buffer.alloc(aclSize);
  acl.writeUInt8(2, 0); // AclRevision
  acl.writeUInt8(0, 1);
  acl.writeUInt16LE(aclSize, 2);
  acl.writeUInt16LE(args.aces.length, 4);
  acl.writeUInt16LE(0, 6);
  aceBlob.copy(acl, 8);

  // Layout: header(20) + DACL + Owner + Group
  const headerSize = 20;
  const offsetDacl = headerSize;
  const offsetOwner = offsetDacl + acl.length;
  const offsetGroup = offsetOwner + owner.length;
  const total = offsetGroup + group.length;
  const out = Buffer.alloc(total);
  out.writeUInt8(1, 0); // Revision
  out.writeUInt8(0, 1);
  out.writeUInt16LE(0x8004, 2); // SE_DACL_PRESENT | SE_SELF_RELATIVE
  out.writeUInt32LE(offsetOwner, 4);
  out.writeUInt32LE(offsetGroup, 8);
  out.writeUInt32LE(0, 12); // no SACL
  out.writeUInt32LE(offsetDacl, 16);
  acl.copy(out, offsetDacl);
  owner.copy(out, offsetOwner);
  group.copy(out, offsetGroup);
  return out;
}

export function buildAccessAllowedAce(mask: number, sid: string): Buffer {
  const sidBuf = stringToSid(sid);
  const size = 8 + sidBuf.length; // header 4 + mask 4 + sid
  const buf = Buffer.alloc(size);
  buf.writeUInt8(ACCESS_ALLOWED_ACE_TYPE, 0);
  buf.writeUInt8(0, 1);
  buf.writeUInt16LE(size, 2);
  buf.writeUInt32LE(mask >>> 0, 4);
  sidBuf.copy(buf, 8);
  return buf;
}

export function buildAccessAllowedObjectAce(args: {
  mask: number;
  sid: string;
  objectTypeGuid: string;
  aceFlags?: number;
}): Buffer {
  const sidBuf = stringToSid(args.sid);
  const guid = msBytesFromGuid(args.objectTypeGuid);
  // header(4) + mask(4) + flags(4) + guid(16) + sid
  const size = 4 + 4 + 4 + 16 + sidBuf.length;
  const buf = Buffer.alloc(size);
  buf.writeUInt8(ACCESS_ALLOWED_OBJECT_ACE_TYPE, 0);
  buf.writeUInt8(args.aceFlags ?? 0, 1);
  buf.writeUInt16LE(size, 2);
  buf.writeUInt32LE(args.mask >>> 0, 4);
  buf.writeUInt32LE(ACE_OBJECT_TYPE_PRESENT, 8);
  guid.copy(buf, 12);
  sidBuf.copy(buf, 28);
  return buf;
}
