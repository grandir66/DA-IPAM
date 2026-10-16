/**
 * LDAP_SERVER_SD_FLAGS_OID (1.2.840.113556.1.4.801) for nTSecurityDescriptor.
 * flags=7 → Owner | Group | DACL (exclude SACL so non-admins can read).
 */

import { Ber, BerWriter, Control, type ControlOptions } from "ldapts";
import { SD_FLAGS_OWNER_GROUP_DACL } from "./types";

export const LDAP_SERVER_SD_FLAGS_OID = "1.2.840.113556.1.4.801";

export interface SdFlagsControlOptions extends ControlOptions {
  flags?: number;
}

/**
 * Raw BER value bytes for SDFlagsRequestValue ::= SEQUENCE { Flags INTEGER }
 * For flags 0–127: 30 03 02 01 <flags>
 */
export function encodeSdFlagsValue(flags: number): Buffer {
  if (flags < 0 || flags > 0x7f) {
    // Still encode as single-byte INTEGER for our use (flags=7).
    throw new Error(`SD flags out of single-byte range: ${flags}`);
  }
  return Buffer.from([0x30, 0x03, 0x02, 0x01, flags & 0xff]);
}

export class SdFlagsControl extends Control {
  public static type = LDAP_SERVER_SD_FLAGS_OID;

  public flags: number;

  public constructor(options: SdFlagsControlOptions = {}) {
    super(SdFlagsControl.type, { critical: options.critical ?? true });
    this.flags = options.flags ?? SD_FLAGS_OWNER_GROUP_DACL;
  }

  public override writeControl(writer: BerWriter): void {
    const inner = new BerWriter();
    inner.startSequence();
    inner.writeInt(this.flags);
    inner.endSequence();
    writer.writeBuffer(inner.buffer, Ber.OctetString);
  }
}

/** Convenience factory (flags default 7). */
export function sdFlagsControl(flags: number = SD_FLAGS_OWNER_GROUP_DACL): SdFlagsControl {
  return new SdFlagsControl({ flags, critical: true });
}
