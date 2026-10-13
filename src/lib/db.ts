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
import type { FingerprintUserRule } from "./device-fingerprint-classification";
import { registraRipiego } from "./db-maintenance/ripieghi";
// NUC-2 gruppo 2 (T3-07): funzioni spostate che il resto della facciata usa ancora.
import {
  getHostByMac,
  upsertHost,
} from "./db-tenant";
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
// SysObjectID Lookup CRUD
// ========================

export interface SysObjLookupRow {
  id: number;
  oid: string;
  vendor: string;
  product: string;
  category: string;
  enterprise_id: number;
  builtin: number;
  enabled: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

// v0.2.633 bug fix audit A8: TUTTE le funzioni `sysobj_lookup` ora delegano a
// db-hub (tabella globale, vedi db-hub.ts:1394-1442). Prima erano implementate
// con getDb() (tenant) mentre il list passava da db-hub → POST scriveva in
// data/tenants/X.db, GET leggeva da data/hub.db → utente vedeva sempre vuoto.
export function getSysObjLookupEntries(): SysObjLookupRow[] {
  const hub = require("./db-hub");
  return hub.getSysObjLookupEntries();
}

export function createSysObjLookupEntry(input: {
  oid: string; vendor: string; product: string; category: string;
  enterprise_id: number; enabled?: number; note?: string | null;
}): SysObjLookupRow {
  const hub = require("./db-hub");
  return hub.createSysObjLookupEntry(input);
}

export function updateSysObjLookupEntry(id: number, input: Partial<{
  oid: string; vendor: string; product: string; category: string;
  enterprise_id: number; enabled: number; note: string | null;
}>): SysObjLookupRow | undefined {
  const hub = require("./db-hub");
  return hub.updateSysObjLookupEntry(id, input);
}

export function deleteSysObjLookupEntry(id: number): boolean {
  const hub = require("./db-hub");
  return hub.deleteSysObjLookupEntry(id);
}

export function resetBuiltinSysObjLookup(): void {
  const hub = require("./db-hub");
  hub.resetBuiltinSysObjLookup();
}

// ========================
// MAC Product Map (Attribution v2 Fase 2, Task 3) — delega a db-hub (tabella hub-global)
// ========================

export interface MacProductMapRow {
  id: number;
  mac_prefix: string;
  hostname_pattern: string | null;
  vendor: string;
  product_family: string | null;
  category: string | null;
  confidence: number;
  source: "seed" | "domarc" | "feedback";
  enabled: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export function getMacProductMap(): MacProductMapRow[] {
  const hub = require("./db-hub");
  return hub.getMacProductMap();
}

export function createMacProductEntry(input: {
  mac_prefix: string; hostname_pattern?: string | null; vendor: string;
  product_family?: string | null; category?: string | null;
  confidence?: number; source?: "seed" | "domarc" | "feedback";
  enabled?: number; note?: string | null;
}): MacProductMapRow {
  const hub = require("./db-hub");
  return hub.createMacProductEntry(input);
}

export function updateMacProductEntry(id: number, input: Partial<{
  mac_prefix: string; hostname_pattern: string | null; vendor: string;
  product_family: string | null; category: string | null;
  confidence: number; source: "seed" | "domarc" | "feedback";
  enabled: number; note: string | null;
}>): MacProductMapRow | undefined {
  const hub = require("./db-hub");
  return hub.updateMacProductEntry(id, input);
}

export function deleteMacProductEntry(id: number): boolean {
  const hub = require("./db-hub");
  return hub.deleteMacProductEntry(id);
}

// ========================
// Users
// ========================

// ── User functions delegate to hub DB (multi-tenant) ──
export function getUserByUsername(username: string): User | undefined {
  const { getUserByUsername: hubGetUser } = require("./db-hub");
  return hubGetUser(username) as User | undefined;
}

export function getUserCount(): number {
  const { getHubDb } = require("./db-hub");
  const row = getHubDb().prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
  return row.count;
}

export function createUser(username: string, passwordHash: string, role: "superadmin" | "admin" | "viewer" = "admin", tenantId?: number | null, email?: string | null): User {
  const { createUser: hubCreateUser } = require("./db-hub");
  return hubCreateUser(username, passwordHash, role, tenantId, email) as User;
}

export function updateUserLastLogin(userId: number): void {
  const { updateUserLastLogin: hubUpdate } = require("./db-hub");
  hubUpdate(userId);
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

// ========================
// Scan History
// ========================

// ========================
// Network Devices
// ========================

// ========================
// Network Router (ARP assignment per subnet)
// ========================

// ========================
// Credentials (riutilizzabili)
// ========================

// ═══════════════════════════════════════════════════════════════════════════
// CREDENTIAL SYSTEM v2: network_credentials + host_credentials
// ═══════════════════════════════════════════════════════════════════════════

// ── host_credentials CRUD ──

// ========================
// Network Devices
// ========================

// Cleanup FK orfani: vive in db-tenant.ts (riesportata in fondo, NUC-2 gruppo 0).

// ========================
// ARP Entries
// ========================


// ========================
// MAC-IP Mapping (cumulativo)
// ========================

// ========================
// Inventory Assets
// ========================

// ========================
// Asset Assignees
// ========================

// ========================
// Locations
// ========================

// ========================
// Licenses
// ========================

// ========================
// License Seats
// ========================

// ========================
// Inventory Audit Log
// ========================

// ========================
// MAC Port Entries
// ========================

// ========================
// Switch Ports
// ========================

// ========================
// Device Neighbors (LLDP/CDP/MNDP)
// ========================

// ========================
// Device Routes (Routing Table)
// ========================

// ========================
// Device Credential Bindings
// ========================

// ========================
// Scheduled Jobs
// ========================

// ========================
// Status History
// ========================

// ========================
// Monitoring Stats
// ========================

// ========================
// Dashboard Stats
// ========================

// ========================
// Cleanup
// ========================

// ========================
// Status History Aggregation (for charts)
// ========================

// ========================
// Global Search
// ========================

// ========================
// Settings (key-value)
// ========================

// ── Settings functions delegate to hub DB (multi-tenant) ──
export function getSetting(key: string): string | null {
  const hub = require("./db-hub");
  return hub.getSetting(key);
}

export function isOnboardingCompleted(): boolean {
  return getSetting("onboarding_completed") === "1";
}

export function getAllSettings(): Record<string, string> {
  const hub = require("./db-hub");
  return hub.getAllSettings();
}

export function setSetting(key: string, value: string): void {
  const hub = require("./db-hub");
  hub.setSetting(key, value);
}

// ========================
// Fingerprint → classificazione (regole manuali)
// ========================

export interface FingerprintClassificationMapRow {
  id: number;
  match_kind: "exact" | "contains";
  pattern: string;
  classification: string;
  priority: number;
  enabled: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export function getAllFingerprintClassificationMapRows(): FingerprintClassificationMapRow[] {
  const hub = require("./db-hub");
  return hub.getAllFingerprintClassificationMapRows();
}

/** Regole attive per discovery/refresh (priorità crescente). */
export function getFingerprintClassificationRulesForResolve(): FingerprintUserRule[] {
  const hub = require("./db-hub");
  return hub.getFingerprintClassificationRulesForResolve();
}

export function createFingerprintClassificationMapRow(input: {
  match_kind: "exact" | "contains";
  pattern: string;
  classification: string;
  priority: number;
  enabled: boolean;
  note?: string | null;
}): FingerprintClassificationMapRow {
  const hub = require("./db-hub");
  return hub.createFingerprintClassificationMapRow(input);
}

export function updateFingerprintClassificationMapRow(
  id: number,
  input: {
    match_kind?: "exact" | "contains";
    pattern?: string;
    classification?: string;
    priority?: number;
    enabled?: boolean;
    note?: string | null;
  }
): FingerprintClassificationMapRow | undefined {
  const hub = require("./db-hub");
  return hub.updateFingerprintClassificationMapRow(id, input);
}

export function deleteFingerprintClassificationMapRow(id: number): boolean {
  const hub = require("./db-hub");
  return hub.deleteFingerprintClassificationMapRow(id);
}

// ========================
// Device Fingerprint Rules (tabella unificata)
// ========================

export interface DeviceFingerprintRuleRow {
  id: number;
  name: string;
  device_label: string;
  classification: string;
  priority: number;
  enabled: number;
  tcp_ports_key: string | null;
  tcp_ports_optional: string | null;
  min_key_ports: number | null;
  oid_prefix: string | null;
  sysdescr_pattern: string | null;
  hostname_pattern: string | null;
  mac_vendor_pattern: string | null;
  banner_pattern: string | null;
  ttl_min: number | null;
  ttl_max: number | null;
  note: string | null;
  builtin: number;
  created_at: string;
  updated_at: string;
}

export function getDeviceFingerprintRules(): DeviceFingerprintRuleRow[] {
  const hub = require("./db-hub");
  return hub.getDeviceFingerprintRules();
}

export function getEnabledDeviceFingerprintRules(): DeviceFingerprintRuleRow[] {
  const hub = require("./db-hub");
  return hub.getEnabledDeviceFingerprintRules();
}

export function createDeviceFingerprintRule(input: {
  name: string; device_label: string; classification: string; priority?: number;
  tcp_ports_key?: string | null; tcp_ports_optional?: string | null; min_key_ports?: number | null;
  oid_prefix?: string | null; sysdescr_pattern?: string | null; hostname_pattern?: string | null;
  mac_vendor_pattern?: string | null; banner_pattern?: string | null;
  ttl_min?: number | null; ttl_max?: number | null; note?: string | null; enabled?: boolean;
}): DeviceFingerprintRuleRow {
  const hub = require("./db-hub");
  return hub.createDeviceFingerprintRule(input);
}

export function updateDeviceFingerprintRule(id: number, input: Partial<{
  name: string; device_label: string; classification: string; priority: number; enabled: boolean;
  tcp_ports_key: string | null; tcp_ports_optional: string | null; min_key_ports: number | null;
  oid_prefix: string | null; sysdescr_pattern: string | null; hostname_pattern: string | null;
  mac_vendor_pattern: string | null; banner_pattern: string | null;
  ttl_min: number | null; ttl_max: number | null; note: string | null;
}>): DeviceFingerprintRuleRow | undefined {
  const hub = require("./db-hub");
  return hub.updateDeviceFingerprintRule(id, input);
}

export function deleteDeviceFingerprintRule(id: number): boolean {
  const hub = require("./db-hub");
  return hub.deleteDeviceFingerprintRule(id);
}

export function resetBuiltinFingerprintRules(): void {
  const hub = require("./db-hub");
  hub.resetBuiltinFingerprintRules();
}

// ========================
// Nmap Profiles
// ========================

export interface NmapProfileRow {
  id: number;
  name: string;
  description: string;
  args: string;
  snmp_community: string | null;
  custom_ports: string | null;
  /** Elenco porte TCP esplicito (sovrascrive default se presente) */
  tcp_ports: string | null;
  /** Elenco porte UDP esplicito (sovrascrive default se presente) */
  udp_ports: string | null;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export function getNmapProfiles(): NmapProfileRow[] {
  const hub = require("./db-hub");
  return hub.getNmapProfiles();
}

export function getNmapProfileById(id: number): NmapProfileRow | undefined {
  const hub = require("./db-hub");
  return hub.getNmapProfileById(id);
}

export function getActiveNmapProfile(): NmapProfileRow | undefined {
  const hub = require("./db-hub");
  return hub.getActiveNmapProfile();
}

export function createNmapProfile(
  name: string,
  description: string,
  args: string,
  snmpCommunity?: string | null,
  customPorts?: string | null,
  tcpPorts?: string | null,
  udpPorts?: string | null
): NmapProfileRow {
  const hub = require("./db-hub");
  return hub.createNmapProfile(name, description, args, snmpCommunity, customPorts, tcpPorts, udpPorts);
}

export function updateNmapProfile(
  id: number,
  name: string,
  description: string,
  args: string,
  snmpCommunity?: string | null,
  customPorts?: string | null,
  tcpPorts?: string | null,
  udpPorts?: string | null
): NmapProfileRow | undefined {
  const hub = require("./db-hub");
  return hub.updateNmapProfile(id, name, description, args, snmpCommunity, customPorts, tcpPorts, udpPorts);
}

export function deleteNmapProfile(id: number): boolean {
  const hub = require("./db-hub");
  return hub.deleteNmapProfile(id);
}

// ── Remaining user functions delegate to hub DB ──
export function updateUserPassword(userId: number, passwordHash: string): void {
  const hub = require("./db-hub");
  hub.updateUserPassword(userId, passwordHash);
}

export function getUsers(): Omit<User, "password_hash">[] {
  const hub = require("./db-hub");
  return hub.getUsers();
}

export function getUserById(id: number): User | undefined {
  const hub = require("./db-hub");
  return hub.getUserById(id);
}

export function updateUserRole(userId: number, role: "superadmin" | "admin" | "viewer"): boolean {
  const hub = require("./db-hub");
  return hub.updateUserRole(userId, role);
}

export function deleteUser(userId: number): boolean {
  const hub = require("./db-hub");
  return hub.deleteUser(userId);
}


// ========================
// Proxmox Hosts
// ========================

// ========================
// Device-to-Host Sync
// ========================

// ========================
// Sync network_device da scan host
// ========================

// ═══════════════════════════════════════════════════════════════════════════
// ACTIVE DIRECTORY INTEGRATIONS
// ═══════════════════════════════════════════════════════════════════════════

// AD Computers

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-HOMED DETECTION
// ═══════════════════════════════════════════════════════════════════════════

// recomputeMultihomedLinks e i suoi aiutanti vivono in db-tenant.ts (T3-07).


// AD Users

// ═══════════════════════════════════════════════════════════════════════════
// SNMP VENDOR PROFILES
// ═══════════════════════════════════════════════════════════════════════════

export interface SnmpVendorProfileRow {
  id: number;
  profile_id: string;
  name: string;
  category: string;
  enterprise_oid_prefixes: string;
  sysdescr_pattern: string | null;
  fields: string;
  confidence: number;
  enabled: number;
  builtin: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export function getSnmpVendorProfiles(): SnmpVendorProfileRow[] {
  const hub = require("./db-hub");
  return hub.getSnmpVendorProfiles();
}

export function getEnabledSnmpVendorProfiles(): SnmpVendorProfileRow[] {
  const hub = require("./db-hub");
  return hub.getEnabledSnmpVendorProfiles();
}

// v0.2.633 bug fix audit A8: TUTTE le funzioni `snmp_vendor_profiles` ora
// delegano a db-hub (tabella globale, vedi db-hub.ts:1243-1389). Prima erano
// implementate con getDb() (tenant) per id/byProfileId/create/update/delete/
// reset/export/import, mentre i list passavano da db-hub → POST scriveva in
// data/tenants/X.db, GET leggeva da data/hub.db → utente vedeva sempre vuoto.
export function getSnmpVendorProfileById(id: number): SnmpVendorProfileRow | undefined {
  const hub = require("./db-hub");
  return hub.getSnmpVendorProfileById(id);
}

export function getSnmpVendorProfileByProfileId(profileId: string): SnmpVendorProfileRow | undefined {
  const hub = require("./db-hub");
  return hub.getSnmpVendorProfileByProfileId(profileId);
}

export function createSnmpVendorProfile(input: {
  profile_id: string;
  name: string;
  category: string;
  enterprise_oid_prefixes?: string[];
  sysdescr_pattern?: string | null;
  fields?: Record<string, string | string[]>;
  confidence?: number;
  enabled?: number;
  builtin?: number;
  note?: string | null;
}): SnmpVendorProfileRow {
  const hub = require("./db-hub");
  return hub.createSnmpVendorProfile(input);
}

export function updateSnmpVendorProfile(id: number, input: Partial<{
  profile_id: string;
  name: string;
  category: string;
  enterprise_oid_prefixes: string[];
  sysdescr_pattern: string | null;
  fields: Record<string, string | string[]>;
  confidence: number;
  enabled: number;
  note: string | null;
}>): SnmpVendorProfileRow | undefined {
  const hub = require("./db-hub");
  return hub.updateSnmpVendorProfile(id, input);
}

export function deleteSnmpVendorProfile(id: number): boolean {
  const hub = require("./db-hub");
  return hub.deleteSnmpVendorProfile(id);
}

export function resetBuiltinSnmpVendorProfiles(): void {
  const hub = require("./db-hub");
  hub.resetBuiltinSnmpVendorProfiles();
}

export function exportSnmpVendorProfiles(): SnmpVendorProfileRow[] {
  const hub = require("./db-hub");
  return hub.exportSnmpVendorProfiles();
}

export function importSnmpVendorProfiles(profiles: Array<{
  profile_id: string;
  name: string;
  category: string;
  enterprise_oid_prefixes: string[] | string;
  sysdescr_pattern?: string | null;
  fields: Record<string, string | string[]> | string;
  confidence?: number;
  enabled?: number;
  note?: string | null;
}>, replaceExisting: boolean = false): { imported: number; skipped: number; errors: string[] } {
  const hub = require("./db-hub");
  return hub.importSnmpVendorProfiles(profiles, replaceExisting);
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
