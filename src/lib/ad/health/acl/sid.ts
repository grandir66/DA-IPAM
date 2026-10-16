/**
 * Windows SID binary (MS-DTYP 2.4.2) ↔ string S-1-5-….
 */

export function sidToString(buf: Buffer): string {
  if (buf.length < 8) throw new Error("SID buffer too short");
  const revision = buf.readUInt8(0);
  const subAuthCount = buf.readUInt8(1);
  if (buf.length < 8 + subAuthCount * 4) {
    throw new Error("SID buffer truncated");
  }
  // IdentifierAuthority: 6 bytes big-endian
  let authority = 0;
  for (let i = 2; i < 8; i++) {
    authority = authority * 256 + buf.readUInt8(i);
  }
  const parts = [`S-${revision}-${authority}`];
  for (let i = 0; i < subAuthCount; i++) {
    parts.push(String(buf.readUInt32LE(8 + i * 4)));
  }
  return parts.join("-");
}

/** Encode SID string to binary. */
export function stringToSid(sid: string): Buffer {
  const m = /^S-(\d+)-(\d+)((?:-\d+)*)$/i.exec(sid.trim());
  if (!m) throw new Error(`Invalid SID: ${sid}`);
  const revision = Number(m[1]);
  const authority = Number(m[2]);
  if (!Number.isFinite(authority) || authority < 0 || authority > Number.MAX_SAFE_INTEGER) {
    throw new Error(`Invalid SID authority: ${m[2]}`);
  }
  const subs = m[3]
    ? m[3]
        .split("-")
        .filter(Boolean)
        .map((x) => Number(x))
    : [];
  const buf = Buffer.alloc(8 + subs.length * 4);
  buf.writeUInt8(revision, 0);
  buf.writeUInt8(subs.length, 1);
  // 6-byte big-endian authority (NT authorities fit in Number)
  let auth = authority;
  for (let i = 7; i >= 2; i--) {
    buf.writeUInt8(auth & 0xff, i);
    auth = Math.floor(auth / 256);
  }
  for (let i = 0; i < subs.length; i++) {
    buf.writeUInt32LE(subs[i]!, 8 + i * 4);
  }
  return buf;
}

/** Last RID of a SID string, or null. */
export function sidRid(sid: string): number | null {
  const parts = sid.split("-");
  if (parts.length < 3) return null;
  const n = Number(parts[parts.length - 1]);
  return Number.isFinite(n) ? n : null;
}

/** Domain SID prefix (everything except last RID), or null. */
export function domainSidPrefix(sid: string): string | null {
  const parts = sid.split("-");
  if (parts.length < 4) return null;
  return parts.slice(0, -1).join("-");
}
