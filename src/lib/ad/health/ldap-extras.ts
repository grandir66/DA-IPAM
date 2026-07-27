/**
 * LDAP queries extra for AD Health (UAC, SPN, trusts, krbtgt, guest, recycle bin, phase2 attrs).
 * Recycle Bin / LAPS: best-effort; returns null on ACL/schema failure (no false positives).
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
import { hasFlag, UAC } from "@/lib/ad/health/uac";
import { collectAdcsExtras, type AdcsExtras } from "@/lib/ad/health/adcs";
import type { AdGpoRow, AdTrustRow } from "@/lib/ad/health/types";

export interface LdapExtras {
  userUacBySam: Map<string, number>;
  userSpnBySam: Map<string, string[]>;
  userPrimaryGroupIdBySam: Map<string, number>;
  userAdminCountBySam: Map<string, number>;
  userDescriptionBySam: Map<string, string>;
  userSidHistoryBySam: Map<string, string[]>;
  userAllowedToDelegateToBySam: Map<string, string[]>;
  computerUacBySam: Map<string, number>;
  computerIsDcBySam: Map<string, boolean>;
  computerIsRodcBySam: Map<string, boolean>;
  computerPwdLastSetBySam: Map<string, string | null>;
  computerAllowedToDelegateToBySam: Map<string, string[]>;
  computerAllowedToActOnBehalfOfBySam: Map<string, boolean>;
  computerLapsPasswordPresentBySam: Map<string, boolean | null>;
  trusts: AdTrustRow[];
  krbtgtPasswordLastSetAt: string | null;
  guestEnabled: boolean | null;
  recycleBinEnabled: boolean | null;
  groupMembersByDn: Map<string, string[]>;
  minPwdLength: number | null;
  lockoutThreshold: number | null;
  machineAccountQuota: number | null;
  msDsBehaviorVersion: number | null;
  lapsSchemaPresent: boolean | null;
  integrationUseSsl: boolean;
  gpos: AdGpoRow[];
  siteCount: number | null;
  subnetCount: number | null;
  gmsaCount: number | null;
  /** Fine-grained PSO count; null = unread. */
  psoCount: number | null;
  /** DNs of users with msDS-KeyCredentialLink present. */
  shadowCredentialDns: string[];
  adcs: AdcsExtras;
  /**
   * Labels of queries that failed. Each failure leaves the corresponding maps
   * empty, so rules depending on them find nothing — surfacing this is what
   * separates "no problems" from "we could not look".
   */
  collectErrors: string[];
}

function parseIntAttr(val: unknown): number | null {
  const s = ldapStr(val);
  if (s == null) return null;
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

function attrPresent(val: unknown): boolean {
  if (val == null) return false;
  if (Buffer.isBuffer(val)) return val.length > 0;
  if (Array.isArray(val)) return val.some((v) => attrPresent(v));
  if (typeof val === "string") return val.length > 0;
  return true;
}

function isDomainController(entry: Record<string, unknown>): boolean {
  const pgid = parseIntAttr(entry.primaryGroupID);
  if (pgid === DOMAIN_CONTROLLERS_RID) return true;
  const memberOf = ldapStrArray(entry.memberOf);
  return memberOf.some((dn) => /CN=Domain Controllers,/i.test(dn));
}

function isInsufficientAccess(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /insufficient|access|denied|unauthorized|50|consent/i.test(msg);
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

async function readDomainPolicy(
  client: Client,
  baseDn: string,
  collectErrors: string[],
): Promise<{
  minPwdLength: number | null;
  lockoutThreshold: number | null;
  machineAccountQuota: number | null;
  msDsBehaviorVersion: number | null;
}> {
  try {
    const { searchEntries } = await client.search(baseDn, {
      scope: "base",
      filter: "(objectClass=*)",
      attributes: [
        "minPwdLength",
        "lockoutThreshold",
        "ms-DS-MachineAccountQuota",
        "msDS-Behavior-Version",
      ],
      timeLimit: 30,
    });
    const entry = searchEntries[0];
    if (!entry) {
      return {
        minPwdLength: null,
        lockoutThreshold: null,
        machineAccountQuota: null,
        msDsBehaviorVersion: null,
      };
    }
    return {
      minPwdLength: parseIntAttr(entry.minPwdLength),
      lockoutThreshold: parseIntAttr(entry.lockoutThreshold),
      machineAccountQuota: parseIntAttr(entry["ms-DS-MachineAccountQuota"]),
      msDsBehaviorVersion: parseIntAttr(entry["msDS-Behavior-Version"]),
    };
  } catch {
    collectErrors.push("domainPolicy");
    return {
      minPwdLength: null,
      lockoutThreshold: null,
      machineAccountQuota: null,
      msDsBehaviorVersion: null,
    };
  }
}

export async function collectLdapExtras(integrationId: number): Promise<LdapExtras> {
  const integration = getAdIntegrationById(integrationId);
  if (!integration) {
    throw new Error("Integrazione AD non trovata");
  }

  const client = await connectLdap(integration);
  const baseDn = integration.base_dn;
  const integrationUseSsl = integration.use_ssl === 1;

  try {
    const userUacBySam = new Map<string, number>();
    const userSpnBySam = new Map<string, string[]>();
    const userPrimaryGroupIdBySam = new Map<string, number>();
    const userAdminCountBySam = new Map<string, number>();
    const userDescriptionBySam = new Map<string, string>();
    const userSidHistoryBySam = new Map<string, string[]>();
    const userAllowedToDelegateToBySam = new Map<string, string[]>();
    const shadowCredentialDns: string[] = [];
    const collectErrors: string[] = [];
    try {
      const { searchEntries: users } = await client.search(baseDn, {
        scope: "sub",
        filter: "(&(objectClass=user)(objectCategory=person)(!(objectClass=computer)))",
        attributes: [
          "sAMAccountName",
          "distinguishedName",
          "userAccountControl",
          "servicePrincipalName",
          "pwdLastSet",
          "lastLogonTimestamp",
          "memberOf",
          "primaryGroupID",
          "adminCount",
          "description",
          "sIDHistory",
          "msDS-AllowedToDelegateTo",
          "msDS-KeyCredentialLink",
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
        const adminCount = parseIntAttr(entry.adminCount);
        if (adminCount != null) userAdminCountBySam.set(sam, adminCount);
        const description = ldapStr(entry.description);
        if (description != null) userDescriptionBySam.set(sam, description);
        const sidHistory = ldapStrArray(entry.sIDHistory);
        if (sidHistory.length > 0) userSidHistoryBySam.set(sam, sidHistory);
        const delegateTo = ldapStrArray(entry["msDS-AllowedToDelegateTo"]);
        if (delegateTo.length > 0) userAllowedToDelegateToBySam.set(sam, delegateTo);
        if (attrPresent(entry["msDS-KeyCredentialLink"])) {
          const dn = ldapStr(entry.distinguishedName);
          if (dn) shadowCredentialDns.push(dn);
        }
      }
    } catch {
      // maps stay empty; DA-A-LdapCollectPartial reports it so the empty
      // result is not mistaken for a clean domain
      collectErrors.push("users");
    }

    const computerUacBySam = new Map<string, number>();
    const computerIsDcBySam = new Map<string, boolean>();
    const computerIsRodcBySam = new Map<string, boolean>();
    const computerPwdLastSetBySam = new Map<string, string | null>();
    const computerAllowedToDelegateToBySam = new Map<string, string[]>();
    const computerAllowedToActOnBehalfOfBySam = new Map<string, boolean>();
    const computerLapsPasswordPresentBySam = new Map<string, boolean | null>();
    let lapsSchemaPresent: boolean | null = null;

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
          "pwdLastSet",
          "msDS-isRODC",
          "msDS-AllowedToDelegateTo",
          "msDS-AllowedToActOnBehalfOfOtherIdentity",
          "ms-Mcs-AdmPwd",
          "msLAPS-Password",
        ],
        paged: { pageSize: 500 },
        timeLimit: 120,
      });
      let anyLaps = false;
      for (const entry of computers) {
        const sam = ldapStr(entry.sAMAccountName);
        if (!sam) continue;
        const uac = parseUac(entry.userAccountControl);
        if (uac != null) computerUacBySam.set(sam, uac);
        const isDc = isDomainController(entry);
        computerIsDcBySam.set(sam, isDc);
        const isRodcAttr = ldapStr(entry["msDS-isRODC"]);
        const isRodc =
          isRodcAttr === "TRUE" ||
          isRodcAttr === "true" ||
          isRodcAttr === "1" ||
          hasFlag(uac, UAC.PARTIAL_SECRETS_ACCOUNT);
        computerIsRodcBySam.set(sam, isRodc);
        computerPwdLastSetBySam.set(
          sam,
          ldapTimestampToIso(entry.pwdLastSet as string),
        );
        const delegateTo = ldapStrArray(entry["msDS-AllowedToDelegateTo"]);
        if (delegateTo.length > 0) computerAllowedToDelegateToBySam.set(sam, delegateTo);
        if (attrPresent(entry["msDS-AllowedToActOnBehalfOfOtherIdentity"])) {
          computerAllowedToActOnBehalfOfBySam.set(sam, true);
        }
        const hasLaps =
          attrPresent(entry["ms-Mcs-AdmPwd"]) || attrPresent(entry["msLAPS-Password"]);
        computerLapsPasswordPresentBySam.set(sam, hasLaps);
        if (hasLaps) anyLaps = true;
      }
      // Successful read: any LAPS value ⇒ schema present; else absent/undeployed (rule fires).
      if (computers.length === 0) lapsSchemaPresent = null;
      else lapsSchemaPresent = anyLaps;
    } catch (err) {
      if (isInsufficientAccess(err)) {
        lapsSchemaPresent = null;
      }
      // computer maps stay empty / partial
      collectErrors.push("computers");
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
      collectErrors.push("trusts");
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
      collectErrors.push("krbtgt");
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
      collectErrors.push("guest");
    }

    const recycleBinEnabled = await readRecycleBinEnabled(client, baseDn);
    const domainPolicy = await readDomainPolicy(client, baseDn, collectErrors);

    const groupMembersByDn = new Map<string, string[]>();
    try {
      const { searchEntries: groups } = await client.search(baseDn, {
        scope: "sub",
        filter: "(objectClass=group)",
        attributes: ["distinguishedName", "sAMAccountName", "cn", "member"],
        paged: { pageSize: 500 },
        timeLimit: 120,
      });
      for (const entry of groups) {
        const dn = ldapStr(entry.distinguishedName);
        if (!dn) continue;
        groupMembersByDn.set(dn, ldapStrArray(entry.member));
      }
    } catch {
      // engine falls back to cache groups, which may be stale
      collectErrors.push("groups");
    }

    const gpos: AdGpoRow[] = [];
    try {
      const { searchEntries: gpoEntries } = await client.search(baseDn, {
        scope: "sub",
        filter: "(objectCategory=groupPolicyContainer)",
        attributes: ["displayName", "distinguishedName", "gPCFileSysPath", "flags"],
        paged: { pageSize: 200 },
        timeLimit: 60,
      });
      for (const entry of gpoEntries) {
        const dn = ldapStr(entry.distinguishedName);
        if (!dn) continue;
        gpos.push({
          displayName: ldapStr(entry.displayName) ?? dn,
          distinguishedName: dn,
          gpcFileSysPath: ldapStr(entry.gPCFileSysPath),
          flags: parseIntAttr(entry.flags),
        });
      }
    } catch {
      collectErrors.push("gpos");
    }

    let siteCount: number | null = null;
    let subnetCount: number | null = null;
    try {
      const configDn = `CN=Configuration,${baseDn}`;
      const sitesDn = `CN=Sites,${configDn}`;
      const { searchEntries: sites } = await client.search(sitesDn, {
        scope: "one",
        filter: "(objectClass=site)",
        attributes: ["cn"],
        timeLimit: 30,
      });
      siteCount = sites.length;
      const { searchEntries: subnets } = await client.search(`CN=Subnets,${sitesDn}`, {
        scope: "one",
        filter: "(objectClass=subnet)",
        attributes: ["cn"],
        timeLimit: 30,
      });
      subnetCount = subnets.length;
    } catch {
      siteCount = null;
      subnetCount = null;
      collectErrors.push("sites");
    }

    let gmsaCount: number | null = null;
    try {
      const { searchEntries: gmsas } = await client.search(baseDn, {
        scope: "sub",
        filter: "(objectClass=msDS-GroupManagedServiceAccount)",
        attributes: ["sAMAccountName"],
        paged: { pageSize: 200 },
        timeLimit: 60,
      });
      gmsaCount = gmsas.length;
    } catch {
      gmsaCount = null;
      collectErrors.push("gmsa");
    }

    let psoCount: number | null = null;
    try {
      const { searchEntries: psos } = await client.search(baseDn, {
        scope: "sub",
        filter: "(objectClass=msDS-PasswordSettings)",
        attributes: ["cn"],
        paged: { pageSize: 100 },
        timeLimit: 30,
      });
      psoCount = psos.length;
    } catch {
      psoCount = null;
      collectErrors.push("pso");
    }

    const adcs = await collectAdcsExtras(client, baseDn);

    return {
      userUacBySam,
      userSpnBySam,
      userPrimaryGroupIdBySam,
      userAdminCountBySam,
      userDescriptionBySam,
      userSidHistoryBySam,
      userAllowedToDelegateToBySam,
      computerUacBySam,
      computerIsDcBySam,
      computerIsRodcBySam,
      computerPwdLastSetBySam,
      computerAllowedToDelegateToBySam,
      computerAllowedToActOnBehalfOfBySam,
      computerLapsPasswordPresentBySam,
      trusts,
      krbtgtPasswordLastSetAt,
      guestEnabled,
      recycleBinEnabled,
      groupMembersByDn,
      minPwdLength: domainPolicy.minPwdLength,
      lockoutThreshold: domainPolicy.lockoutThreshold,
      machineAccountQuota: domainPolicy.machineAccountQuota,
      msDsBehaviorVersion: domainPolicy.msDsBehaviorVersion,
      lapsSchemaPresent,
      integrationUseSsl,
      gpos,
      siteCount,
      subnetCount,
      gmsaCount,
      psoCount,
      shadowCredentialDns: shadowCredentialDns.slice(0, 50),
      adcs,
      collectErrors,
    };
  } finally {
    try {
      await client.unbind();
    } catch {
      // ignore
    }
  }
}
