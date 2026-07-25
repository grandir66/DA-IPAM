/**
 * LDAP queries extra for AD Health (UAC, SPN, trusts, krbtgt, guest, recycle bin).
 * Recycle Bin: best-effort via domain msDS-EnabledFeatureBL; returns null on failure.
 */

import { Client } from "ldapts";
import { getAdIntegrationById } from "@/lib/db";
import { connectLdap } from "@/lib/ad/ad-client";
import {
  DOMAIN_CONTROLLERS_RID,
  ldapStr,
  ldapStrArray,
  ldapTimestampToIso,
  parseUac,
} from "@/lib/ad/ldap-utils";
import { UAC } from "@/lib/ad/health/uac";
import type { AdTrustRow } from "@/lib/ad/health/types";

export interface LdapExtras {
  userUacBySam: Map<string, number>;
  userSpnBySam: Map<string, string[]>;
  userPrimaryGroupIdBySam: Map<string, number>;
  computerUacBySam: Map<string, number>;
  computerIsDcBySam: Map<string, boolean>;
  trusts: AdTrustRow[];
  krbtgtPasswordLastSetAt: string | null;
  guestEnabled: boolean | null;
  recycleBinEnabled: boolean | null;
  groupMembersByDn: Map<string, string[]>;
}

function parseIntAttr(val: unknown): number | null {
  const s = ldapStr(val);
  if (s == null) return null;
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

function isDomainController(entry: {
  primaryGroupID?: unknown;
  memberOf?: unknown;
}): boolean {
  const pgid = parseIntAttr(entry.primaryGroupID);
  if (pgid === DOMAIN_CONTROLLERS_RID) return true;
  const memberOf = ldapStrArray(entry.memberOf);
  return memberOf.some((dn) => /CN=Domain Controllers,/i.test(dn));
}

/**
 * Best-effort Recycle Bin detection via domain msDS-EnabledFeatureBL.
 * Returns null if the attribute/search is unavailable (lab fragility).
 */
async function readRecycleBinEnabled(
  client: Client,
  baseDn: string
): Promise<boolean | null> {
  try {
    const { searchEntries } = await client.search(baseDn, {
      scope: "base",
      filter: "(objectClass=*)",
      attributes: ["msDS-EnabledFeatureBL", "msDS-EnabledFeature"],
      timeLimit: 30,
    });
    const entry = searchEntries[0];
    if (!entry) return null;

    const bl = ldapStrArray(entry["msDS-EnabledFeatureBL"]);
    const fwd = ldapStrArray(entry["msDS-EnabledFeature"]);
    const all = [...bl, ...fwd];
    if (all.length === 0) {
      // Attribute readable but empty → feature not linked → off
      return false;
    }
    return all.some((dn) => /Recycle Bin/i.test(dn));
  } catch {
    // Optional Features / Configuration partition often fragile in lab → skip
    return null;
  }
}

export async function collectLdapExtras(integrationId: number): Promise<LdapExtras> {
  const integration = getAdIntegrationById(integrationId);
  if (!integration) {
    throw new Error("Integrazione AD non trovata");
  }

  const client = await connectLdap(integration);
  const baseDn = integration.base_dn;

  try {
    const userUacBySam = new Map<string, number>();
    const userSpnBySam = new Map<string, string[]>();
    const userPrimaryGroupIdBySam = new Map<string, number>();
    try {
      const { searchEntries: users } = await client.search(baseDn, {
        scope: "sub",
        filter: "(&(objectClass=user)(objectCategory=person)(!(objectClass=computer)))",
        attributes: [
          "sAMAccountName",
          "userAccountControl",
          "servicePrincipalName",
          "pwdLastSet",
          "lastLogonTimestamp",
          "memberOf",
          "primaryGroupID",
        ],
        paged: { pageSize: 500 },
        timeLimit: 120,
      });
      for (const entry of users) {
        const sam = ldapStr(entry.sAMAccountName);
        if (!sam) continue;
        const uac = parseUac(entry.userAccountControl);
        if (uac != null) userUacBySam.set(sam, uac);
        const spns = ldapStrArray(entry.servicePrincipalName);
        if (spns.length > 0) userSpnBySam.set(sam, spns);
        const pgid = parseIntAttr(entry.primaryGroupID);
        if (pgid != null) userPrimaryGroupIdBySam.set(sam, pgid);
      }
    } catch {
      // leave maps empty; engine can still run on cache
    }

    const computerUacBySam = new Map<string, number>();
    const computerIsDcBySam = new Map<string, boolean>();
    try {
      const { searchEntries: computers } = await client.search(baseDn, {
        scope: "sub",
        filter: "(&(objectCategory=computer)(objectClass=computer))",
        attributes: [
          "sAMAccountName",
          "userAccountControl",
          "operatingSystem",
          "primaryGroupID",
          "memberOf",
        ],
        paged: { pageSize: 500 },
        timeLimit: 120,
      });
      for (const entry of computers) {
        const sam = ldapStr(entry.sAMAccountName);
        if (!sam) continue;
        const uac = parseUac(entry.userAccountControl);
        if (uac != null) computerUacBySam.set(sam, uac);
        computerIsDcBySam.set(sam, isDomainController(entry));
      }
    } catch {
      // leave maps empty
    }

    const trusts: AdTrustRow[] = [];
    try {
      const systemDn = `CN=System,${baseDn}`;
      const { searchEntries: trustEntries } = await client.search(systemDn, {
        scope: "one",
        filter: "(objectClass=trustedDomain)",
        attributes: ["name", "trustDirection", "trustType", "trustAttributes"],
        timeLimit: 60,
      });
      for (const entry of trustEntries) {
        const name = ldapStr(entry.name);
        if (!name) continue;
        trusts.push({
          name,
          trustDirection: parseIntAttr(entry.trustDirection),
          trustType: parseIntAttr(entry.trustType),
          trustAttributes: parseIntAttr(entry.trustAttributes),
        });
      }
    } catch {
      // no trusts or CN=System inaccessible
    }

    let krbtgtPasswordLastSetAt: string | null = null;
    try {
      const { searchEntries } = await client.search(baseDn, {
        scope: "sub",
        filter: "(sAMAccountName=krbtgt)",
        attributes: ["pwdLastSet"],
        sizeLimit: 1,
        timeLimit: 30,
      });
      if (searchEntries[0]) {
        krbtgtPasswordLastSetAt = ldapTimestampToIso(searchEntries[0].pwdLastSet as string);
      }
    } catch {
      krbtgtPasswordLastSetAt = null;
    }

    let guestEnabled: boolean | null = null;
    try {
      const { searchEntries } = await client.search(baseDn, {
        scope: "sub",
        filter: "(sAMAccountName=Guest)",
        attributes: ["userAccountControl"],
        sizeLimit: 1,
        timeLimit: 30,
      });
      if (searchEntries[0]) {
        const uac = parseUac(searchEntries[0].userAccountControl);
        guestEnabled = uac != null ? (uac & UAC.ACCOUNTDISABLE) === 0 : null;
      }
    } catch {
      guestEnabled = null;
    }

    const recycleBinEnabled = await readRecycleBinEnabled(client, baseDn);

    const groupMembersByDn = new Map<string, string[]>();
    try {
      const { searchEntries: groups } = await client.search(baseDn, {
        scope: "sub",
        filter: "(objectClass=group)",
        attributes: ["distinguishedName", "member"],
        paged: { pageSize: 500 },
        timeLimit: 120,
      });
      for (const entry of groups) {
        const dn = ldapStr(entry.distinguishedName);
        if (!dn) continue;
        groupMembersByDn.set(dn, ldapStrArray(entry.member));
      }
    } catch {
      // leave empty — engine falls back to cache groups
    }

    return {
      userUacBySam,
      userSpnBySam,
      userPrimaryGroupIdBySam,
      computerUacBySam,
      computerIsDcBySam,
      trusts,
      krbtgtPasswordLastSetAt,
      guestEnabled,
      recycleBinEnabled,
      groupMembersByDn,
    };
  } finally {
    try {
      await client.unbind();
    } catch {
      // ignore
    }
  }
}
