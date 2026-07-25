/**
 * Trustees expected to hold powerful domain / AdminSDHolder rights.
 */

import { domainSidPrefix, sidRid } from "./sid";

/** Absolute well-known SIDs always expected on domain / AdminSDHolder. */
export const ABSOLUTE_EXPECTED_SIDS = new Set([
  "S-1-5-18", // SYSTEM
  "S-1-5-32-544", // BUILTIN\Administrators
  "S-1-5-9", // Enterprise Domain Controllers
  "S-1-5-32-548", // Account Operators — sometimes present; still "known" for ASH noise
  "S-1-5-32-549", // Server Operators
  "S-1-5-32-550", // Print Operators
  "S-1-5-32-551", // Backup Operators
]);

/** Domain-relative RIDs expected for DCSync / domain GenericAll. */
export const EXPECTED_DOMAIN_RIDS = new Set([
  512, // Domain Admins
  516, // Domain Controllers
  518, // Schema Admins (forest)
  519, // Enterprise Admins
  498, // Enterprise Read-only Domain Controllers
]);

/**
 * True if trustee is a default high-privilege principal for domain ACL.
 * `domainSid` = domain object SID (e.g. S-1-5-21-…-domainRid) — prefix used for relative SIDs.
 */
export function isExpectedDomainTrustee(
  trusteeSid: string,
  domainSid: string | null,
): boolean {
  const sid = trusteeSid.toUpperCase();
  for (const known of ABSOLUTE_EXPECTED_SIDS) {
    if (sid === known.toUpperCase()) return true;
  }
  const rid = sidRid(sid);
  if (rid != null && EXPECTED_DOMAIN_RIDS.has(rid)) {
    if (!domainSid) return true; // RID match without domain context — treat as expected
    const prefix = domainSidPrefix(domainSid);
    const tPrefix = domainSidPrefix(sid);
    if (prefix && tPrefix && prefix.toUpperCase() === tPrefix.toUpperCase()) {
      return true;
    }
    // Enterprise Admins / Schema may live in forest root — RID-only accept for 518/519
    if (rid === 518 || rid === 519) return true;
  }
  return false;
}

/** AdminSDHolder: same expected set (builtin ops often appear via template). */
export function isExpectedAdminSdHolderTrustee(
  trusteeSid: string,
  domainSid: string | null,
): boolean {
  return isExpectedDomainTrustee(trusteeSid, domainSid);
}
