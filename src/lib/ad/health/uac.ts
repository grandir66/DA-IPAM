export const UAC = {
  ACCOUNTDISABLE: 0x0002,
  PASSWD_NOTREQD: 0x0020,
  /** Store password using reversible encryption. */
  ENCRYPTED_TEXT_PWD_ALLOWED: 0x0080,
  DONT_EXPIRE_PASSWORD: 0x10000,
  TRUSTED_FOR_DELEGATION: 0x80000,
  DONT_REQ_PREAUTH: 0x400000,
  /** Protocol transition (S4U2Self) — constrained delegation with any auth. */
  TRUSTED_TO_AUTH_FOR_DELEGATION: 0x1000000,
  /** RODC: partial secrets account. */
  PARTIAL_SECRETS_ACCOUNT: 0x04000000,
} as const;

export function hasFlag(uac: number | null | undefined, bit: number): boolean {
  if (uac == null || Number.isNaN(uac)) return false;
  return (uac & bit) !== 0;
}
