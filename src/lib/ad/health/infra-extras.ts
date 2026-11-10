/**
 * Raccolta LDAP per i blocchi D (DNS), F (infrastruttura) e G (Entra) delle lacune:
 * docs/superpowers/plans/2026-11-10-ad-health-evidenze-e-percorsi.md.
 *
 * Sola lettura. Delle zone DNS si leggono il modo degli aggiornamenti e la delega (DACL);
 * dei RODC la politica di replica delle password (i gruppi, mai le password). Ogni ricerca
 * fallita lascia `null` e un'etichetta in `collectErrors`: «non letto» non è «a posto».
 */

import type { Client } from "ldapts";
import { ldapStr, ldapStrArray } from "@/lib/ad/ldap-utils";
import { parseSecurityDescriptor } from "./acl/security-descriptor";
import { appliesAllow, isBroadTrustee } from "./acl/delegation-evidence";
import { MASK_DS_WRITE_PROP, MASK_GENERIC_ALL, MASK_WRITE_DACL, MASK_WRITE_OWNER } from "./acl/interesting-ace";
import { sdFlagsControl } from "./acl/sd-flags-control";
import type { DmsaRow, DnsZoneRow, InfraExtras, RodcPolicyRow, SysvolReplication } from "./types";

const MASK_GENERIC_WRITE = 0x40000000;
/** DSPROPERTY_ZONE_ALLOW_UPDATE (MS-DNSP 2.3.2.1.1). */
const DNS_PROPERTY_ALLOW_UPDATE = 2;
const DFSR_ELIMINATED = 48;

function buffers(value: unknown): Buffer[] {
  const list = Array.isArray(value) ? value : value == null ? [] : [value];
  return list.filter((v): v is Buffer => Buffer.isBuffer(v));
}

/**
 * Modo degli aggiornamenti dinamici di una zona, da dNSProperty: 0 nessuno, 1 anche non
 * sicuri, 2 solo sicuri. `null` se la proprietà non c'è o non si legge.
 */
export function dnsAllowUpdate(value: unknown): number | null {
  for (const buf of buffers(value)) {
    // DataLength(4) NameLength(4) Flag(4) Version(4) Id(4) Data(DataLength) Name(1)
    if (buf.length < 21) continue;
    const dataLength = buf.readUInt32LE(0);
    if (buf.readUInt32LE(16) !== DNS_PROPERTY_ALLOW_UPDATE) continue;
    if (dataLength < 1 || buf.length < 20 + dataLength) continue;
    return buf.readUInt8(20);
  }
  return null;
}

/**
 * Trustee ampi (Everyone, Authenticated Users, Users, Domain Users, Domain Computers) che
 * sulla zona possono più che creare record: scrivere proprietà, cambiare ACL o proprietario.
 * Creare record è il diritto di serie di Authenticated Users e non conta. `null` = ACL non letta.
 */
export function zoneBroadWriters(value: unknown): string[] | null {
  const buf = buffers(value)[0];
  if (!buf || buf.length === 0) return null;
  try {
    const sids = new Set<string>();
    for (const ace of parseSecurityDescriptor(buf).aces) {
      if (!appliesAllow(ace)) continue;
      if (!isBroadTrustee(ace.sid) && !/^S-1-5-21-[\d-]+-(513|515)$/.test(ace.sid)) continue;
      const control = (ace.mask & (MASK_GENERIC_ALL | MASK_GENERIC_WRITE | MASK_WRITE_DACL | MASK_WRITE_OWNER)) !== 0;
      const writeAll = (ace.mask & MASK_DS_WRITE_PROP) !== 0 && ace.objectTypeGuid === null;
      if (control || writeAll) sids.add(ace.sid);
    }
    return [...sids];
  } catch {
    return null;
  }
}

export function sysvolReplicationFromFlags(flags: number | null, frsReplicaSetPresent: boolean): SysvolReplication | null {
  if (flags != null) return flags === DFSR_ELIMINATED ? "dfsr" : "migrating";
  return frsReplicaSetPresent ? "frs" : null;
}

function noSuchObject(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === 32;
}

function forestRootDn(configurationDn: string | null, baseDn: string): string {
  return configurationDn?.replace(/^CN=Configuration,/i, "") || baseDn;
}

async function collectDns(
  client: Client,
  baseDn: string,
  configurationDn: string | null,
  collectErrors: string[],
): Promise<Pick<InfraExtras, "dnsZones" | "dnsWildcardDns">> {
  const bases = [...new Set([
    `DC=DomainDnsZones,${baseDn}`,
    `DC=ForestDnsZones,${forestRootDn(configurationDn, baseDn)}`,
    `CN=MicrosoftDNS,CN=System,${baseDn}`,
  ])];
  const zones: DnsZoneRow[] = [];
  const wildcards: string[] = [];
  let read = 0;
  for (const base of bases) {
    try {
      const { searchEntries } = await client.search(base, {
        scope: "sub",
        filter: "(objectClass=dnsZone)",
        attributes: ["distinguishedName", "name", "dNSProperty", "nTSecurityDescriptor"],
        explicitBufferAttributes: ["dNSProperty", "nTSecurityDescriptor"],
        paged: { pageSize: 200 },
        timeLimit: 30,
      }, sdFlagsControl());
      for (const entry of searchEntries) {
        const dn = ldapStr(entry.distinguishedName) ?? entry.dn;
        const name = ldapStr(entry.name) ?? "";
        // Zone di servizio: i root hint e i trust anchor non sono zone del cliente.
        if (!dn || name === "RootDNSServers" || name.startsWith("..")) continue;
        zones.push({
          dn,
          name,
          allowUpdate: dnsAllowUpdate(entry.dNSProperty),
          broadWriters: zoneBroadWriters(entry.nTSecurityDescriptor),
        });
      }
      const { searchEntries: nodes } = await client.search(base, {
        scope: "sub",
        filter: "(&(objectClass=dnsNode)(name=\\2a)(!(dNSTombstoned=TRUE)))",
        attributes: ["distinguishedName"],
        paged: { pageSize: 200 },
        timeLimit: 30,
      });
      for (const node of nodes) {
        const dn = ldapStr(node.distinguishedName) ?? node.dn;
        if (dn) wildcards.push(dn);
      }
      read++;
    } catch (error) {
      // Una partizione che non esiste (DNS non integrato, dominio figlio) non è un guasto.
      if (noSuchObject(error)) read++;
    }
  }
  if (read === 0) {
    collectErrors.push("dnsZones");
    return { dnsZones: null, dnsWildcardDns: null };
  }
  return { dnsZones: zones, dnsWildcardDns: wildcards };
}

async function collectDsHeuristics(client: Client, configurationDn: string | null, collectErrors: string[]): Promise<string | null> {
  if (!configurationDn) return null;
  try {
    const { searchEntries } = await client.search(`CN=Directory Service,CN=Windows NT,CN=Services,${configurationDn}`, {
      scope: "base",
      filter: "(objectClass=*)",
      attributes: ["dSHeuristics"],
      timeLimit: 15,
    });
    if (searchEntries.length === 0) return null;
    return ldapStr(searchEntries[0]?.dSHeuristics) ?? "";
  } catch {
    collectErrors.push("dsHeuristics");
    return null;
  }
}

async function collectSysvol(client: Client, baseDn: string, collectErrors: string[]): Promise<SysvolReplication | null> {
  let flags: number | null = null;
  try {
    const { searchEntries } = await client.search(`CN=DFSR-GlobalSettings,CN=System,${baseDn}`, {
      scope: "base",
      filter: "(objectClass=*)",
      attributes: ["msDFSR-Flags"],
      timeLimit: 15,
    });
    const raw = ldapStr(searchEntries[0]?.["msDFSR-Flags"]);
    const parsed = raw == null ? NaN : Number.parseInt(raw, 10);
    // Oggetto presente senza flag: la migrazione è stata preparata ma non avviata.
    if (searchEntries.length > 0) flags = Number.isFinite(parsed) ? parsed : 0;
  } catch (error) {
    if (!noSuchObject(error)) {
      collectErrors.push("sysvolReplication");
      return null;
    }
  }
  if (flags != null) return sysvolReplicationFromFlags(flags, false);
  try {
    const { searchEntries } = await client.search(`CN=File Replication Service,CN=System,${baseDn}`, {
      scope: "sub",
      filter: "(objectClass=nTFRSReplicaSet)",
      attributes: ["cn"],
      timeLimit: 15,
    });
    return sysvolReplicationFromFlags(null, searchEntries.length > 0);
  } catch (error) {
    if (!noSuchObject(error)) collectErrors.push("sysvolReplication");
    return null;
  }
}

async function collectRodcPolicies(client: Client, baseDn: string, collectErrors: string[]): Promise<RodcPolicyRow[] | null> {
  try {
    const { searchEntries } = await client.search(baseDn, {
      scope: "sub",
      filter: "(&(objectCategory=computer)(primaryGroupID=521))",
      attributes: ["distinguishedName", "msDS-RevealOnDemandGroup", "msDS-NeverRevealGroup"],
      paged: { pageSize: 100 },
      timeLimit: 30,
    });
    return searchEntries.flatMap((entry) => {
      const dn = ldapStr(entry.distinguishedName) ?? entry.dn;
      if (!dn) return [];
      return [{
        dn,
        revealDns: ldapStrArray(entry["msDS-RevealOnDemandGroup"]),
        neverRevealDns: ldapStrArray(entry["msDS-NeverRevealGroup"]),
      }];
    });
  } catch {
    collectErrors.push("rodcPolicies");
    return null;
  }
}

async function collectDmsas(client: Client, baseDn: string, collectErrors: string[]): Promise<DmsaRow[] | null> {
  try {
    // Su uno schema precedente a Windows Server 2025 la classe non esiste e la ricerca è vuota.
    const { searchEntries } = await client.search(baseDn, {
      scope: "sub",
      filter: "(objectClass=msDS-DelegatedManagedServiceAccount)",
      attributes: ["distinguishedName", "msDS-ManagedAccountPrecededByLink"],
      paged: { pageSize: 100 },
      timeLimit: 30,
    });
    return searchEntries.flatMap((entry) => {
      const dn = ldapStr(entry.distinguishedName) ?? entry.dn;
      return dn ? [{ dn, precededByDn: ldapStr(entry["msDS-ManagedAccountPrecededByLink"]) }] : [];
    });
  } catch {
    collectErrors.push("dmsa");
    return null;
  }
}

async function collectEntraSyncedPrivileged(client: Client, baseDn: string, collectErrors: string[]): Promise<string[] | null> {
  try {
    // mS-DS-ConsistencyGuid è l'ancora che Entra Connect scrive sugli utenti che sincronizza.
    const { searchEntries } = await client.search(baseDn, {
      scope: "sub",
      filter: "(&(objectCategory=person)(objectClass=user)(adminCount=1)(mS-DS-ConsistencyGuid=*))",
      attributes: ["distinguishedName"],
      paged: { pageSize: 200 },
      timeLimit: 30,
    });
    return searchEntries.flatMap((entry) => {
      const dn = ldapStr(entry.distinguishedName) ?? entry.dn;
      return dn ? [dn] : [];
    });
  } catch {
    collectErrors.push("entraSynced");
    return null;
  }
}

export async function collectInfraExtras(
  client: Client,
  baseDn: string,
  configurationDn: string | null,
  collectErrors: string[],
): Promise<InfraExtras> {
  const dns = await collectDns(client, baseDn, configurationDn, collectErrors);
  return {
    ...dns,
    dsHeuristics: await collectDsHeuristics(client, configurationDn, collectErrors),
    sysvolReplication: await collectSysvol(client, baseDn, collectErrors),
    rodcPolicies: await collectRodcPolicies(client, baseDn, collectErrors),
    dmsas: await collectDmsas(client, baseDn, collectErrors),
    entraSyncedPrivilegedDns: await collectEntraSyncedPrivileged(client, baseDn, collectErrors),
  };
}
