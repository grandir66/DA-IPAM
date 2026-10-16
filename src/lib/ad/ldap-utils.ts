/**
 * Pure LDAP helpers shared by ad-client sync and AD Health extras.
 */

/**
 * Converte timestamp LDAP (Windows FILETIME: 100-nanoseconds dal 1601) in ISO string.
 * Se il valore è 0 o "0" (mai loggato), restituisce null.
 */
export function ldapTimestampToIso(val: string | number | undefined | null): string | null {
  if (val == null || val === "0" || val === 0) return null;
  try {
    const num = typeof val === "string" ? BigInt(val) : BigInt(val);
    if (num <= BigInt(0)) return null;
    const milliseconds = Number(num / BigInt(10000)) - 11644473600000;
    if (milliseconds < 0 || milliseconds > Date.now() + 86400000 * 365 * 10) return null;
    return new Date(milliseconds).toISOString();
  } catch {
    return null;
  }
}

/**
 * Estrae valore stringa da attributo LDAP (può essere array o stringa).
 */
export function ldapStr(val: unknown): string | null {
  if (val == null) return null;
  if (Array.isArray(val)) return val[0]?.toString() ?? null;
  if (Buffer.isBuffer(val)) return val.toString("utf-8");
  return String(val);
}

/**
 * Estrae array di stringhe da attributo LDAP multi-valore.
 */
export function ldapStrArray(val: unknown): string[] {
  if (val == null) return [];
  if (Array.isArray(val)) {
    return val.map((v) => (Buffer.isBuffer(v) ? v.toString("utf-8") : String(v))).filter(Boolean);
  }
  if (Buffer.isBuffer(val)) return [val.toString("utf-8")];
  const s = String(val);
  return s ? [s] : [];
}

/**
 * Parse userAccountControl numerico; null se assente/non numerico.
 */
export function parseUac(val: unknown): number | null {
  if (val == null) return null;
  const raw = Array.isArray(val) ? val[0] : val;
  const num = typeof raw === "number" ? raw : parseInt(String(raw), 10);
  return Number.isNaN(num) ? null : num;
}

/**
 * Verifica se account è abilitato da userAccountControl.
 * Bit 0x02 = ACCOUNTDISABLE. Default enabled se UAC assente.
 */
export function isAccountEnabled(uac: string | number | undefined | null): number {
  if (uac == null) return 1;
  const num = typeof uac === "string" ? parseInt(uac, 10) : uac;
  if (isNaN(num)) return 1;
  return (num & 0x02) === 0 ? 1 : 0;
}

/** RID well-known del gruppo Domain Admins. */
export const DOMAIN_ADMINS_RID = 512;

/** RID well-known del gruppo Domain Controllers. */
export const DOMAIN_CONTROLLERS_RID = 516;
