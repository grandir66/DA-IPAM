/**
 * ⚠️  FACADE LEGACY — NON CONTIENE L'ARCHITETTURA REALE
 *
 * Questo file è un FACADE di backward-compatibility. L'architettura reale è MULTI-TENANT:
 *
 * - `db-hub.ts`          → Hub DB (utenti, tenant, settings, profili) — usa data/hub.db
 * - `db-hub-schema.ts`   → Schema hub con tabella tenants, users (role: superadmin/admin/viewer)
 * - `db-tenant.ts`       → Tenant DB (reti, host, device, credenziali) — usa data/tenants/<code>.db
 * - `db-tenant-schema.ts`→ Schema tenant (35 tabelle operative)
 * - `api-tenant.ts`      → Helper withTenantFromSession() per API routes
 * - `auth.ts`            → JWT con tenantCode, tenants[], ruolo superadmin, utente Domarc
 *
 * Questo file (db.ts) mantiene le VECCHIE funzioni per compatibility con import esistenti.
 * Le funzioni utente/settings delegano a db-hub.ts. Le funzioni dati delegano a db-tenant.ts
 * tramite getDb() che usa AsyncLocalStorage per il contesto tenant.
 *
 * Per capire l'architettura: leggere CLAUDE.md sezione "Architettura Multi-Tenant"
 */
import Database from "better-sqlite3";
import path from "path";
import { resolveDataDir } from "./data-dir";
import fs from "fs";
import { macToHex } from "./utils";

import type {
  Host,
  User,
  HostInput,
} from "@/types";
import { registraRipiego } from "./db-maintenance/ripieghi";
// NUC-2 gruppo 2 (T3-07): funzioni spostate che il resto della facciata usa ancora.
import {
  getHostByMac,
  upsertHost,
} from "./db-tenant";
import {
  getUserByUsername as hubGetUserByUsername,
  createUser as hubCreateUser,
  getUsers as hubGetUsers,
  getUserById as hubGetUserById,
} from "./db-hub";
// T3-08: il ramo del vecchio ipam.db vive in db-legacy.ts.
import { getLegacyDb } from "./db-legacy";
export { closeDb } from "./db-legacy";

const DATA_DIR = resolveDataDir();


/**
 * Il tenant che `getDb()` userebbe ADESSO, ovvero come il facade risolve il
 * contesto in questo istante. `null` = nessun contesto, e quindi il ripiego
 * su DEFAULT (contato nel registro dei ripieghi) poche righe sotto.
 *
 * PERCHE' STA QUI e non nel chiamante: deve usare la risoluzione di QUESTO
 * modulo. Sotto tsx possono coesistere due istanze di `db-tenant` (import
 * dinamico -> seconda istanza con AsyncLocalStorage vuota); chi volesse
 * ricostruire il controllo da fuori rischierebbe di interrogare l'istanza
 * sbagliata e ricevere un "tutto bene" falso. Il `require` qui sotto e' lo
 * stesso di `getDb()`, quindi la risposta e' per costruzione quella che conta.
 *
 * Usato dalla guardia in `cron/scheduler.ts` per non far partire un job che
 * scriverebbe sul database del tenant sbagliato (incidente 2026-09-02).
 */
export function currentFacadeTenant(): string | null {
  try {
    const { getCurrentTenantCode } = require("./db-tenant");
    return getCurrentTenantCode() ?? null;
  } catch {
    return null;
  }
}

/** Le due funzioni di `db-tenant` che servono al facade (via `require`, vedi sopra). */
interface FacadeTenantModule {
  getCurrentTenantCode(): string | null;
  getTenantDb(code: string): Database.Database;
  TenantContextError: new (code: string, cause?: unknown) => Error;
}

export function getDb(): Database.Database {
  let tenantMod: FacadeTenantModule | null = null;
  try {
    tenantMod = require("./db-tenant") as FacadeTenantModule;
  } catch { /* db-tenant non disponibile (build-time) */ }

  // Multi-tenant: se c'è un contesto tenant attivo, usa il tenant DB.
  // NUC-1: se quel database NON si apre è un errore. Prima si ripiegava in
  // silenzio su DEFAULT, cioè si scriveva nel database del tenant sbagliato.
  const tenantCode = tenantMod?.getCurrentTenantCode() ?? null;
  if (tenantMod && tenantCode) {
    try {
      return tenantMod.getTenantDb(tenantCode);
    } catch (error) {
      throw new tenantMod.TenantContextError(tenantCode, error);
    }
  }

  // Senza contesto, con hub.db presente (multi-tenant attivo): l'esito resta
  // quello di sempre (DEFAULT, o ipam.db se DEFAULT manca), ma ogni accesso si
  // conta nel registro dei ripieghi (NUC-1 fase A) per sapere chi correggere.
  const hubPath = path.join(DATA_DIR, "hub.db");
  const hubPresente = fs.existsSync(hubPath);
  const defaultTenantPath = path.join(DATA_DIR, "tenants", "DEFAULT.db");
  if (hubPresente && tenantMod && fs.existsSync(defaultTenantPath)) {
    try {
      const def = tenantMod.getTenantDb("DEFAULT");
      registraRipiego("default", "DEFAULT");
      return def;
    } catch { /* fallback a legacy */ }
  }
  if (hubPresente) registraRipiego("legacy");

  // Legacy single-tenant: il vecchio ipam.db, aperto e migrato da db-legacy.ts.
  return getLegacyDb();
}

// ========================
// Networks
// ========================

// ========================
// Hosts
// ========================


/** Confronto MAC normalizzato (ignora : - .) per match cross-vendor */
const MAC_HEX = (col: string) => `UPPER(REPLACE(REPLACE(REPLACE(COALESCE(${col},''), ':', ''), '-', ''), '.', ''))`;


/** Resolve MAC to a registered network device (router/switch) via ARP or hosts. Used to identify trunk peer when LLDP/CDP unavailable. */
export function resolveMacToNetworkDevice(mac: string, excludeDeviceId?: number): { device_id: number; device_name: string; device_type: string } | null {
  let ip: string | null = null;
  const host = getHostByMac(mac);
  if (host) ip = host.ip;
  if (!ip) {
    const hex = macToHex(mac);
    const arp = getDb().prepare(
      `SELECT ip FROM arp_entries WHERE ${MAC_HEX("mac")} = ? AND ip IS NOT NULL ORDER BY timestamp DESC LIMIT 1`
    ).get(hex) as { ip: string } | undefined;
    ip = arp?.ip ?? null;
  }
  if (!ip) return null;
  const nd = getDb().prepare(
    "SELECT id, name, device_type FROM network_devices WHERE host = ? AND (enabled = 1 OR enabled IS NULL)"
  ).get(ip) as { id: number; name: string; device_type: string } | undefined;
  if (!nd || (excludeDeviceId != null && nd.id === excludeDeviceId)) return null;
  return { device_id: nd.id, device_name: nd.name, device_type: nd.device_type };
}

/** Resolve MAC to device info from hosts (IPAM), arp_entries e mac_ip_mapping, per switch port e tabella ARP */
export function resolveMacToDevice(mac: string): { ip: string | null; hostname: string | null; vendor: string | null; host_id: number | null } {
  const host = getHostByMac(mac);
  if (host) {
    return {
      ip: host.ip,
      hostname: host.custom_name || host.hostname,
      vendor: host.vendor,
      host_id: host.id,
    };
  }
  const hex = macToHex(mac);
  const arp = getDb().prepare(
    `SELECT ip FROM arp_entries WHERE ${MAC_HEX("mac")} = ? AND ip IS NOT NULL ORDER BY timestamp DESC LIMIT 1`
  ).get(hex) as { ip: string } | undefined;
  if (arp?.ip) {
    return { ip: arp.ip, hostname: null, vendor: null, host_id: null };
  }
  const mapping = getDb().prepare(
    "SELECT ip, hostname, vendor, host_id FROM mac_ip_mapping WHERE mac_normalized = ?"
  ).get(hex) as { ip: string; hostname: string | null; vendor: string | null; host_id: number | null } | undefined;
  return {
    ip: mapping?.ip ?? null,
    hostname: mapping?.hostname ?? null,
    vendor: mapping?.vendor ?? null,
    host_id: mapping?.host_id ?? null,
  };
}




// ═══════════════════════════════════════════════════════════════════════════
// excluded_ips — tombstone IP esclusi
// ═══════════════════════════════════════════════════════════════════════════

/**
 * UPDATE-only: aggiorna solo host già esistenti (network_id+ip). MAI inserisce.
 * Da usare nelle fonti passive (ARP/DHCP/AD/DNS): un router risponde con entry ARP
 * o lease DHCP anche per dispositivi spenti/dismessi — non vogliamo che riempiano
 * il DB. Solo i probe attivi (ICMP/TCP/nmap di discovery.ts) creano host nuovi.
 * Ritorna null se l'host non esiste.
 */
export function updateHostIfExists(input: HostInput & { mac?: string; vendor?: string; hostname?: string; hostname_source?: string; dns_forward?: string; dns_reverse?: string; status?: "online" | "offline" | "unknown"; os_info?: string; model?: string; serial_number?: string; firmware?: string | null; device_manufacturer?: string | null }): Host | null {
  const existing = getDb()
    .prepare("SELECT id FROM hosts WHERE network_id = ? AND ip = ?")
    .get(input.network_id, input.ip) as { id: number } | undefined;
  if (!existing) return null;
  return upsertHost(input) as Host;
}

// ═══════════════════════════════════════════════════════════════════════════
// DHCP LEASES (unified table)
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-TENANT: Re-export hub e tenant per transizione graduale
// I consumer esistenti continuano a usare le funzioni da @/lib/db (single-tenant).
// I nuovi consumer possono importare le funzioni multi-tenant da @/lib/db-hub e @/lib/db-tenant.
// ═══════════════════════════════════════════════════════════════════════════

// Hub DB (tenant registry, utenti, settings globali, profili)
export {
  getHubDb,
  closeHubDb,
  // Tenant CRUD
  getTenants,
  getActiveTenants,
  getTenantById,
  getTenantByCode,
  createTenant,
  updateTenant,
  deleteTenant,
  // User-Tenant access
  getUserTenantAccess,
  setUserTenantAccess,
  removeUserTenantAccess,
  getUsersForTenant,
} from "./db-hub";

export type { Tenant, HubUser } from "./db-hub";

// T3-08: utenti, impostazioni, profili Nmap e SNMP, regole di fingerprint,
// tabelle sysObjectID e MAC-prodotto vivono nell'hub. La facciata le definiva
// come deleghe con la stessa firma: ora le riesporta (stesso oggetto funzione,
// lo prova db-facade-als.test.ts). Elenco: support/facciata-spostate.ts.
export {
  getSysObjLookupEntries,
  createSysObjLookupEntry,
  updateSysObjLookupEntry,
  deleteSysObjLookupEntry,
  resetBuiltinSysObjLookup,
  getMacProductMap,
  createMacProductEntry,
  updateMacProductEntry,
  deleteMacProductEntry,
  getUserCount,
  updateUserLastLogin,
  updateUserPassword,
  updateUserRole,
  deleteUser,
  getSetting,
  isOnboardingCompleted,
  getAllSettings,
  setSetting,
  getAllFingerprintClassificationMapRows,
  getFingerprintClassificationRulesForResolve,
  createFingerprintClassificationMapRow,
  updateFingerprintClassificationMapRow,
  deleteFingerprintClassificationMapRow,
  getDeviceFingerprintRules,
  getEnabledDeviceFingerprintRules,
  createDeviceFingerprintRule,
  updateDeviceFingerprintRule,
  deleteDeviceFingerprintRule,
  resetBuiltinFingerprintRules,
  getNmapProfiles,
  getNmapProfileById,
  getActiveNmapProfile,
  createNmapProfile,
  updateNmapProfile,
  deleteNmapProfile,
  getSnmpVendorProfiles,
  getEnabledSnmpVendorProfiles,
  getSnmpVendorProfileById,
  getSnmpVendorProfileByProfileId,
  createSnmpVendorProfile,
  updateSnmpVendorProfile,
  deleteSnmpVendorProfile,
  resetBuiltinSnmpVendorProfiles,
  exportSnmpVendorProfiles,
  importSnmpVendorProfiles,
} from "./db-hub";

export type {
  SysObjLookupRow,
  MacProductMapRow,
  FingerprintClassificationMapRow,
  DeviceFingerprintRuleRow,
  NmapProfileRow,
  SnmpVendorProfileRow,
} from "./db-hub";

// Le quattro letture degli utenti con un tipo diverso: l'hub restituisce
// `HubUser` (con email e tenant), la facciata ha sempre promesso `User`.
// Involucri di una riga, senza accesso al database (T3-08).
export function getUserByUsername(username: string): User | undefined {
  return hubGetUserByUsername(username);
}

export function createUser(...args: Parameters<typeof hubCreateUser>): User {
  return hubCreateUser(...args);
}

export function getUsers(): Omit<User, "password_hash">[] {
  return hubGetUsers();
}

export function getUserById(id: number): User | undefined {
  return hubGetUserById(id);
}

// Tenant DB (context-aware, per-tenant data)
export {
  withTenant,
  getCurrentTenantCode,
  getTenantDb,
  closeTenantDb,
  closeAllTenantDbs,
  createTenantDatabase,
  deleteTenantDatabase,
  getTopologyPositions,
  upsertTopologyPositions,
  getTopologyData,
  // NUC-2 gruppo 0 (T3-04): una sola copia, in db-tenant.ts
  cleanOrphanedForeignKeys,
  updateScheduledJobInterval,
  getStatusOverTime,
  getRecentStatusChanges,
} from "./db-tenant";

// NUC-2 gruppo 1a (T3-05): 103 letture e 18 tipi che erano uguali nelle due
// copie. Una sola copia, in db-tenant.ts: una correzione fatta lì vale anche qui.
// Elenco e criterio di scelta: src/lib/__tests__/support/facciata-spostate.ts.
export {
  getNetworks,
  getNetworksPaginated,
  getDevicesPaginated,
  getNetworkById,
  getNetworkRouterBinding,
  getNetworkContainingIp,
  buildNetworkLookup,
  getHostsByNetwork,
  getAllHostsFlat,
  getAllHosts,
  getKnownHosts,
  getHostBasic,
  getHostByIp,
  mergeOpenPortsJson,
  getAttributionSignalsForHost,
  isIpExcluded,
  getExcludedIps,
  countHostsInNetwork,
  getKnownHostsWithNetwork,
  getScanHistory,
  getScanPhaseStatusForNetwork,
  getAttributionCompletenessForNetwork,
  getNetworkDevices,
  getRouters,
  getDhcpSources,
  getArpSourceDevices,
  getSwitches,
  getDevicesByClassification,
  getDevicesByClassificationOrLegacy,
  getHostsByClassification,
  getNetworkRouterId,
  getAllCredentials,
  getCredentialById,
  getHostWindowsCredentials,
  getHostLinuxCredentials,
  getCredentialLoginPair,
  getSshLinuxCredentialPair,
  getNetworkHostCredentialIds,
  getHostDetectCredentialId,
  getHostDetectCredentialsEnriched,
  getOrderedDetectCredentialIds,
  getOrderedSshLinuxCredentialIds,
  buildSnmpCommunitiesForNetwork,
  buildSnmpCommunitiesForHost,
  getNetworkCredentials,
  getNetworksWithCredentials,
  getHostCredentials,
  getHostValidatedProtocolsByNetwork,
  getCredentialCommunityString,
  getDeviceSnmpV3Credentials,
  getEffectiveSnmpPort,
  getDeviceCommunityString,
  getDeviceCredentials,
  getNetworkDeviceById,
  getNetworkDeviceByHost,
  getNetworkDeviceByHostId,
  getInventoryAssetById,
  getInventoryAssetByNetworkDevice,
  getDeviceIdsWithInventoryAsset,
  getInventoryAssetByHost,
  getHostIdsWithInventoryAsset,
  getInventoryAssets,
  getAssetAssignees,
  getAssetAssigneeById,
  getLocations,
  getLocationById,
  getLicenseSeatsByLicense,
  getLicenseSeatsByAsset,
  getInventoryAuditLog,
  getArpEntriesByDevice,
  getMacPortEntriesByDevice,
  getSwitchPortsByDevice,
  getNeighborsByDevice,
  getRoutesByDevice,
  getDeviceCredentialBindings,
  getDeviceCredentialProtocolsSummary,
  findExistingBinding,
  getPrimaryBindingForProtocol,
  getScheduledJobs,
  getScheduledJobById,
  getEnabledJobs,
  getStatusHistory,
  getHostLatencyHistory,
  getKnownHostStats,
  getOfflineKnownHosts,
  getDashboardStats,
  getRecentActivity,
  globalSearch,
  getOnlineCountsOverTime,
  getProxmoxHosts,
  getProxmoxHostById,
  getAdIntegrations,
  getAdRealm,
  getAdIntegrationById,
  getAdComputers,
  getMultihomedStatus,
  getMultihomedStatusByDeviceId,
  getAdUsers,
  getAdGroups,
  getAdGroupsPaginated,
  getAdDhcpLeasesPaginated,
  getDistinctHostVendorHints,
  getDhcpLeaseStats,
} from "./db-tenant";

export type {
  AttributionSignals,
  ScanPhaseKey,
  ScanPhaseStatus,
  AttributionCompleteness,
  CredentialCoverageRow,
  NetworkCredentialRole,
  HostDetectCredentialRole,
  NetworkCredentialRow,
  HostCredentialRow,
  MacIpMappingSource,
  DbNeighborEntry,
  DbRouteEntry,
  DeviceCredentialBinding,
  AdIntegration,
  AdComputer,
  AdUser,
  AdDhcpLease,
  AdGroup,
} from "./db-tenant";

// NUC-2 gruppo 1b (T3-06), credenziali: 24 funzioni uguali o con
// differenze solo di forma fra le due copie, provate con la parità. Una sola copia,
// in db-tenant.ts. Elenco: src/lib/__tests__/support/facciata-spostate.ts.
export {
  createCredential,
  updateCredential,
  deleteCredential,
  replaceNetworkHostCredentials,
  setHostDetectCredential,
  deleteHostDetectCredential,
  replaceNetworkCredentials,
  addNetworkCredential,
  removeNetworkCredential,
  reorderNetworkCredentials,
  copyNetworkCredentials,
  addHostCredential,
  removeHostCredential,
  reorderHostCredentials,
  setHostCredentialValidated,
  setHostCredentialValidatedByKey,
  recordCredentialFailure,
  recordCredentialSuccess,
  getCredentialCoverageByCategory,
  addDeviceCredentialBinding,
  updateDeviceCredentialBinding,
  deleteDeviceCredentialBinding,
  reorderDeviceCredentialBindings,
  updateBindingTestStatus,
} from "./db-tenant";

// NUC-2 gruppo 1b (T3-06), AD: 11 funzioni uguali o con
// differenze solo di forma fra le due copie, provate con la parità. Una sola copia,
// in db-tenant.ts. Elenco: src/lib/__tests__/support/facciata-spostate.ts.
export {
  createAdIntegration,
  updateAdIntegration,
  deleteAdIntegration,
  upsertAdComputer,
  linkAdComputerToHost,
  relinkAdComputersForNetwork,
  upsertAdUser,
  upsertAdGroup,
  clearAdData,
  upsertAdDhcpLease,
  clearAdDhcpLeases,
} from "./db-tenant";

// NUC-2 gruppo 1b (T3-06), DHCP: 8 funzioni e 2 tipi uguali o con
// differenze solo di forma fra le due copie, provate con la parità. Una sola copia,
// in db-tenant.ts. Elenco: src/lib/__tests__/support/facciata-spostate.ts.
export {
  upsertDhcpLease,
  syncIpAssignmentsForNetwork,
  syncIpAssignmentsForAllNetworks,
  bulkUpsertDhcpLeases,
  deleteDhcpLeasesByDevice,
  getDhcpLeases,
  getDhcpLeasesPaginated,
  getDhcpLeasesByDevice,
} from "./db-tenant";

export type {
  DhcpLease,
  DhcpLeaseWithRelations,
} from "./db-tenant";

// NUC-2 gruppo 1b (T3-06), inventario e licenze: 21 funzioni uguali o con
// differenze solo di forma fra le due copie, provate con la parità. Una sola copia,
// in db-tenant.ts. Elenco: src/lib/__tests__/support/facciata-spostate.ts.
export {
  ensureInventoryAssetForNetworkDevice,
  syncInventoryFromDevice,
  ensureInventoryAssetForHost,
  syncInventoryFromHost,
  createInventoryAsset,
  updateInventoryAsset,
  deleteInventoryAsset,
  createAssetAssignee,
  updateAssetAssignee,
  deleteAssetAssignee,
  createLocation,
  updateLocation,
  deleteLocation,
  createLicense,
  updateLicense,
  deleteLicense,
  assignLicenseSeat,
  assignLicenseSeatToAssignee,
  unassignLicenseSeat,
  getLicenses,
  getLicenseById,
} from "./db-tenant";

// NUC-2 gruppo 1b (T3-06), ARP, vicini, rotte e porte: 7 funzioni uguali o con
// differenze solo di forma fra le due copie, provate con la parità. Una sola copia,
// in db-tenant.ts. Elenco: src/lib/__tests__/support/facciata-spostate.ts.
export {
  upsertMacIpMapping,
  getMacIpMappings,
  upsertMacPortEntries,
  upsertNeighbors,
  upsertRoutes,
  upsertSwitchPorts,
  markHostsOffline,
} from "./db-tenant";

// NUC-2 gruppo 1b (T3-06), apparati, job e Proxmox: 14 funzioni uguali o con
// differenze solo di forma fra le due copie, provate con la parità. Una sola copia,
// in db-tenant.ts. Elenco: src/lib/__tests__/support/facciata-spostate.ts.
export {
  createNetworkDevice,
  updateNetworkDevice,
  deleteNetworkDevice,
  syncDeviceToHost,
  trackDeviceInfoChanges,
  syncNetworkDeviceFromHostScan,
  createScheduledJob,
  updateJobLastRun,
  toggleJob,
  deleteScheduledJob,
  createProxmoxHost,
  updateProxmoxHost,
  updateProxmoxHostScanResult,
  deleteProxmoxHost,
} from "./db-tenant";

// NUC-2 gruppo 1b (T3-06), reti e host: 19 funzioni uguali o con
// differenze solo di forma fra le due copie, provate con la parità. Una sola copia,
// in db-tenant.ts. Elenco: src/lib/__tests__/support/facciata-spostate.ts.
export {
  createNetwork,
  updateNetwork,
  deleteNetwork,
  setNetworkTargetingMode,
  setNetworkAssessmentConfig,
  refreshHostVendorsFromMac,
  updateHost,
  deleteHost,
  addToExcludedIps,
  removeFromExcludedIps,
  bulkUpdateHostsKnownHost,
  bulkDeleteHosts,
  noteHostsNonResponding,
  addScanHistory,
  setNetworkRouter,
  deleteNetworkRouter,
  addStatusHistory,
  cleanupStaleHosts,
  recordHostHeartbeat,
} from "./db-tenant";

// NUC-2 gruppo 2 (T3-07): le funzioni che nelle due copie si comportavano in
// modo diverso. Passano alla copia tenant una per commit, con la differenza
// misurata sulla copia del DB DTS e provata in db-parity/behaviour-*.test.ts.
// Elenco: src/lib/__tests__/support/facciata-spostate.ts.
export {
  upsertArpEntries,
  getHostByMac,
  getHostById,
  getHostsByNetworkWithDevices,
  recomputeMultihomedLinks,
  resetConfiguration,
  getAdComputersPaginated,
  getAdUsersPaginated,
  upsertHost,
} from "./db-tenant";
