/**
 * Tenant (Spoke) DB module — multi-tenant system.
 * Each tenant gets its own SQLite database at data/tenants/<tenantCode>.db.
 *
 * Usage:
 *   import { withTenant, getNetworks } from "@/lib/db-tenant";
 *   const nets = withTenant("ACME01", () => getNetworks());
 *
 * Functions that reference hub settings (getSetting) import from db-hub.ts.
 */

import { apparatoDelCluster } from "@/lib/devices/apparato-del-cluster";
import { leggiClusterDiscovery, type InfoClusterDiscovery } from "@/lib/devices/cluster-discovery";
import { condizioneAssente } from "@/lib/hosts/assenti";
import Database from "better-sqlite3";
import path from "path";
import { resolveDataDir } from "./data-dir";
import { buildPatchFromHost, buildPatchFromDevice, buildSyncMerge, buildSourceLabel } from "./inventory/discovery-sync";
import fs from "fs";
import { AsyncLocalStorage } from "node:async_hooks";
import type { LetturaVlanSwitch } from "./devices/snmp-vlan";
import { COLONNE_ASSEGNATARI_AD, DDL_ASSEGNATARI_AD, INDICI_ASSEGNATARI_AD, SEGNO_ASSEGNATARI_AD, VERSIONE_ASSEGNATARI_AD, COLONNE_VAULT, DDL_VAULT, INDICI_VAULT, SEGNO_VAULT, VERSIONE_VAULT, DDL_VULCAN, INDICI_VULCAN, SEGNO_VULCAN, VERSIONE_VULCAN, DDL_LIBRENMS_FONTE_V1, INDICI_LIBRENMS_FONTE_V1, SEGNO_LIBRENMS_FONTE, VERSIONE_LIBRENMS_FONTE, DDL_LIBRENMS_ESCLUSIONE, SEGNO_LIBRENMS_ESCLUSIONE, VERSIONE_LIBRENMS_ESCLUSIONE, DDL_JOB_APPARATI_ESITI, INDICI_JOB_APPARATI_ESITI, SEGNO_APPARATI_SCELTI, VERSIONE_APPARATI_SCELTI, DDL_SWITCH_VLAN_NATIVA, SEGNO_SWITCH_VLAN_NATIVA, VERSIONE_SWITCH_VLAN_NATIVA, DDL_SWITCH_VLAN_V1, SEGNO_SWITCH_VLAN, VERSIONE_SWITCH_VLAN, COLONNA_CLUSTER_PRINCIPALE, INDICE_CLUSTER_PRINCIPALE, SEGNO_CLUSTER_PRINCIPALE, VERSIONE_CLUSTER_PRINCIPALE, COLONNE_SCHEDA_MK_V1, DDL_HOSTS_ARCHIVIO, DDL_SCHEDA_MK_V2, DDL_SCHEDA_MK_V3, DDL_TOPOLOGY_CAVI, DDL_TOPOLOGY_UNIONI, INDICI_HOSTS_ARCHIVIO, INDICI_TOPOLOGY_UNIONI, TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL, SEGNO_SCHEDA_MK, VERSIONE_SCHEDA_MK } from "./db-tenant-schema";
import { HYPERVISOR_SYNC_MINUTES, PULIZIA_HOST_MINUTES, SCHEDULED_JOB_TYPES_CHECK_SQL } from "./scheduled-job-types";
import { isProxmoxVeDevice, resolveDeviceAcquisition } from "./devices/device-acquisition-resolve";
import { networkDeviceUsesArpPoll } from "./network-device-arp";
import { STATI_ESITO, type EsitoLettura, type EsitoRiga, type StatoApparato, type StatoEsito } from "./apparati-scelti/regole";
import { macToHex, normalizeMac, normalizeMacForStorage } from "./utils";
import { lookupVendorSync } from "./scanner/mac-vendor";
import { VENDOR_PLACEHOLDER_RE } from "./attribution/emitters";
import { ipSortKey, sqlOrderByDhcpLeases, sqlOrderByNetworks, type SortDirection } from "./table-sort";
import { convertiCommunityInlineSnmp } from "./credentials/converti-community-inline";
import { descriviRicostruzione, descriviStato, migraCredenzialiTipi, statoCredenziali } from "./credentials/migra-credenziali-tipi";
import { descriviNormalizza, normalizzaTipiCredenziali, segnoTipi } from "./credentials/normalizza-tipi";
import { conversioneChiusa, leggiSegno, scriviSegno, segnoErrore, SEGNO_APPARATI, SEGNO_CATENE, SEGNO_INTEGRAZIONI, SEGNO_TIPI } from "./credentials/segni-t2";
import { convertiControllerEAd, descriviIntegrazioni, segnoIntegrazioni } from "./credentials/converti-integrazioni";
import { chiaviGlobaliHub, convertiCateneVecchie, descriviCatene, MOTIVO_DUE_TENANT, segnoCatene } from "./credentials/converti-catene";
import { convertiCredenzialiApparati, descriviApparati, segnoApparati } from "./credentials/converti-apparati";
import { migraAppleMacos } from "./devices/migra-apple-macos";
import { canonicalizza, type Canonica } from "./classification/canonico";
import { aggiungiRuoloServer, impostaVendorSeVuoto } from "./classification/scrittura";
import { convertiClassificazioniV21, migrateServerRoles, SEGNO_CLASSIFICAZIONI_V21 } from "./classification/migrazione-v21";
import { convertiDeviceTypeV21, SEGNO_DEVICE_TYPE_V21 } from "./devices/migra-device-type-v21";
import { randomUUID } from "crypto";
import { inferIpAssignment, resolveAdDhcpLeaseForHost, resolveDhcpLeaseForHost } from "./ip-assignment";
import { getActiveTenants, getHubDbPath, getSetting, getTenantByCode } from "./db-hub";
import { buildStatusSeries, statusWindowStartMs, type StatusObservation, type StatusPoint } from "./status-over-time";
import { registraRipiego } from "./db-maintenance/ripieghi";
import {
  catenaReteDb,
  communitySnmpDb,
  credenzialeSnmpApparatoDb,
  haSnmpApparatoDb,
  loginApparatoDb,
  portaSshApparatoDb,
  tokenApiApparatoDb,
  type ApparatoInAcquisizione,
  type CredProtocol,
  type SceltaSnmpApparato,
  type SceltaTokenApi,
} from "./credentials/resolve";
import { accessoSshDb, communityDb, coppiaLoginDb, coppiaSshDb, type AccessoSsh, type EsitoAccessoSsh } from "./credentials/segreti";
import { CAMPI_HOST, CAMPI_IDENTITA, CAMPI_PORTA, type CampoHost, type CampoPorta, type ModifichePorte, type PortaAttuale } from "./acquisition/proiezioni";
import { aggiornaCredenzialeDb, creaCredenzialeDb, eliminaCredenzialeDb, type ColonneCredenziale } from "./credentials/archivio";
import { aggiungiAllaListaReteDb, copiaListaReteDb, sostituisciListaReteDb } from "./credentials/lista-rete";
import type { ControllerKind, ControllerRunKind, ControllerRunStoredTrigger, MetodoVoceController, NetworkControllerRow } from "./controllers/types";
import {
  creaVoceControllerCifrataDb,
  creaVoceControllerDb,
  credenzialeControllerDb,
  vociDeiControllerDb,
  voceControllerDb,
  type ControllerDellaVoce,
  type CredenzialeController,
  type EsitoVoceController,
  type NuovaCredenzialeController,
  type VoceDelController,
} from "./controllers/credenziale";
import { libreStatusFrom } from "./topology/status-map";
import { modelloEtichettaDiPorte } from "./device-fingerprint-classification";
import { parseProxmoxScan } from "./topology/vms";
import { hypervisorNics, switchPortsToKnown, type SwitchPortRow } from "./topology/known-ports";
import type { IngressoDispositivi } from "./scheda/dispositivi-router";
import type { RigaBondMk, RigaBridgeMk, RigaDnsMk, RigaPortaBridgeMk, RigaPortaSchedaMk, RigaUtenteMk, RigaVlanBridgeMk, RigaVlanMk } from "./devices/mikrotik-scheda";
import type { RisultatoMkScheda } from "./devices/mikrotik-letture";
import type { KnownPort } from "./topology/api-input";
import type { LinkMedium, MapOrientation } from "./topology/model-types";
import { TESTI_UNIONI, type PianoUnioni, type RigaSeparazione, type RigaUnione } from "./topology/unioni-tipi";

import type {
  Network,
  NetworkWithStats,
  Host,
  KnownHostWithNetworkRow,
  HostDetail,
  ScanHistory,
  NetworkDevice,
  Credential,
  ArpEntry,
  MacPortEntry,
  ScheduledJob,
  StatusHistory,
  NetworkInput,
  HostInput,
  HostUpdate,
  ScheduledJobInput,
  SoftwareScan,
  SoftwareScanTarget,
  SoftwareScanStatus,
  SoftwareOsFamily,
  SoftwareProbe,
  SoftwareScanTrigger,
  SoftwareLogLevel,
  SoftwarePackage,
  SoftwareInventoryRow,
  SoftwareScanLog,
  ExcludedIpWithNetwork,
} from "@/types";
import { unisci, risolvi } from "./percorsi";

// ═══════════════════════════════════════════════════════════════════════════
// TENANT CONTEXT (AsyncLocalStorage)
// ═══════════════════════════════════════════════════════════════════════════

const tenantContext = new AsyncLocalStorage<string>();

/**
 * Il contesto tenant c'è ma il suo database non si apre (NUC-1). Prima il
 * facade `getDb()` ripiegava in silenzio su DEFAULT: una scrittura nel
 * database del tenant sbagliato al posto di un errore (incidente 2026-09-02).
 */
export class TenantContextError extends Error {
  readonly tenantCode: string;
  constructor(tenantCode: string, cause?: unknown) {
    super(`Database del tenant ${tenantCode} non apribile`, { cause });
    this.name = "TenantContextError";
    this.tenantCode = tenantCode;
  }
}

export function withTenant<T>(tenantCode: string, fn: () => T): T {
  return tenantContext.run(tenantCode, fn);
}

export function getCurrentTenantCode(): string | null {
  return tenantContext.getStore() ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════
// TENANT DB CONNECTION CACHE (LRU)
// ═══════════════════════════════════════════════════════════════════════════

const TENANTS_DIR = unisci(resolveDataDir(), "tenants");
const MAX_OPEN_DBS = 20;

/**
 * Cartella dei DB tenant, fissata quando il modulo si carica. Sola lettura: la
 * usano gli script sulle copie (tappa 2 credenziali, `guardia-copia.ts`) per
 * verificare, prima di aprire un DB, di stare sulla copia e non sui dati veri.
 */
export function cartellaTenant(): string {
  return TENANTS_DIR;
}

const tenantDbs = new Map<string, { db: Database.Database; lastUsed: number }>();

/** Colonne di `scheduled_jobs`, nell'ordine dello schema (copia per nome nella v8). */
const SCHEDULED_JOBS_COLUMNS = [
  "id",
  "network_id",
  "job_type",
  "interval_minutes",
  "last_run",
  "next_run",
  "enabled",
  "config",
  "created_at",
  "updated_at",
] as const;

/**
 * Migrazione runtime v8 di `scheduled_jobs` (tappa 2 UniFi): il CHECK di
 * `job_type` accetta `'unifi_sync'`. Stessa forma delle v2…v7 (guardia sul
 * testo dello schema, tabella ricostruita con `foreign_keys` OFF), con tre
 * differenze:
 * - il CHECK viene da `SCHEDULED_JOB_TYPES_CHECK_SQL`, la stessa costante dello
 *   schema: un DB nuovo e uno aggiornato accettano gli stessi job;
 * - le colonne si copiano per nome (non `SELECT *` per posizione), il contatore
 *   AUTOINCREMENT resta dov'era (gli id dei job cancellati non si riusano) e
 *   l'indice `idx_scheduled_jobs_enabled_next` si ricrea subito: nelle v2…v7
 *   spariva con la vecchia tabella fino al riavvio successivo;
 * - tutto in una transazione: se la copia non riesce la tabella resta com'era
 *   (e l'errore sale al chiamante, che lo registra).
 *
 * Restituisce true se ha ricostruito, false se non c'era niente da fare.
 * Esportata per le prove (`scheduled-jobs-v8.test.ts`).
 */
export function migrateScheduledJobsV8(db: Database.Database): boolean {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scheduled_jobs'").get() as
    | { sql?: string }
    | undefined;
  if (!row?.sql || row.sql.includes("'unifi_sync'")) return false;

  const present = new Set(
    (db.prepare("PRAGMA table_info(scheduled_jobs)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  const cols = SCHEDULED_JOBS_COLUMNS.filter((c) => present.has(c)).join(", ");

  // PRAGMA foreign_keys non ha effetto dentro una transazione: si spegne prima.
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      const seq = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'scheduled_jobs'").get() as
        | { seq: number }
        | undefined;
      db.exec("DROP TABLE IF EXISTS scheduled_jobs_v8");
      db.exec(`CREATE TABLE scheduled_jobs_v8 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
        job_type TEXT NOT NULL CHECK(${SCHEDULED_JOB_TYPES_CHECK_SQL}),
        interval_minutes INTEGER NOT NULL DEFAULT 60,
        last_run TEXT,
        next_run TEXT,
        enabled INTEGER DEFAULT 1,
        config TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`);
      db.exec(`INSERT INTO scheduled_jobs_v8 (${cols}) SELECT ${cols} FROM scheduled_jobs`);
      if (seq) {
        const upd = db.prepare("UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = 'scheduled_jobs_v8'").run(seq.seq);
        if (upd.changes === 0) {
          db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('scheduled_jobs_v8', ?)").run(seq.seq);
        }
      }
      db.exec("DROP TABLE scheduled_jobs");
      db.exec("ALTER TABLE scheduled_jobs_v8 RENAME TO scheduled_jobs");
      db.exec("CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_enabled_next ON scheduled_jobs(enabled, next_run)");
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
  return true;
}

/**
 * Migrazione runtime v9 di `scheduled_jobs` (topologia fase 2b): il CHECK di
 * `job_type` accetta `'hypervisor_sync'`. Copia esatta della v8 (CHECK dalla
 * stessa costante dello schema, colonne copiate per nome, contatore
 * AUTOINCREMENT conservato, indice ricreato subito, tutto in una transazione);
 * cambia solo la guardia. Su un DB della v7 la v8 scrive già il CHECK con
 * `hypervisor_sync` e qui non resta niente da fare.
 *
 * Restituisce true se ha ricostruito, false se non c'era niente da fare.
 * Esportata per le prove (`scheduled-jobs-v9.test.ts`).
 */
export function migrateScheduledJobsV9(db: Database.Database): boolean {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scheduled_jobs'").get() as
    | { sql?: string }
    | undefined;
  if (!row?.sql || row.sql.includes("'hypervisor_sync'")) return false;

  const present = new Set(
    (db.prepare("PRAGMA table_info(scheduled_jobs)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  const cols = SCHEDULED_JOBS_COLUMNS.filter((c) => present.has(c)).join(", ");

  // PRAGMA foreign_keys non ha effetto dentro una transazione: si spegne prima.
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      const seq = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'scheduled_jobs'").get() as
        | { seq: number }
        | undefined;
      db.exec("DROP TABLE IF EXISTS scheduled_jobs_v9");
      db.exec(`CREATE TABLE scheduled_jobs_v9 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
        job_type TEXT NOT NULL CHECK(${SCHEDULED_JOB_TYPES_CHECK_SQL}),
        interval_minutes INTEGER NOT NULL DEFAULT 60,
        last_run TEXT,
        next_run TEXT,
        enabled INTEGER DEFAULT 1,
        config TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`);
      db.exec(`INSERT INTO scheduled_jobs_v9 (${cols}) SELECT ${cols} FROM scheduled_jobs`);
      if (seq) {
        const upd = db.prepare("UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = 'scheduled_jobs_v9'").run(seq.seq);
        if (upd.changes === 0) {
          db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('scheduled_jobs_v9', ?)").run(seq.seq);
        }
      }
      db.exec("DROP TABLE scheduled_jobs");
      db.exec("ALTER TABLE scheduled_jobs_v9 RENAME TO scheduled_jobs");
      db.exec("CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_enabled_next ON scheduled_jobs(enabled, next_run)");
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
  return true;
}

/**
 * Migrazione runtime v10 di `scheduled_jobs` (pulizia degli host assenti, piano
 * 2026-10-20): il CHECK di `job_type` accetta `'pulizia_host'`. Copia esatta della
 * v9 (CHECK dalla stessa costante dello schema, colonne copiate per nome,
 * contatore AUTOINCREMENT conservato, indice ricreato subito, tutto in una
 * transazione); cambia solo la guardia. Su un DB più vecchio della v9 la v8 o la
 * v9 scrivono già il CHECK con `pulizia_host` e qui non resta niente da fare.
 * Non crea nessun job: il job lo crea solo l'interruttore (`setPuliziaHostSchedule`).
 *
 * Restituisce true se ha ricostruito, false se non c'era niente da fare.
 * Esportata per le prove (`hosts/__tests__/pulizia-job.test.ts`).
 */
export function migrateScheduledJobsV10(db: Database.Database): boolean {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scheduled_jobs'").get() as
    | { sql?: string }
    | undefined;
  if (!row?.sql || row.sql.includes("'pulizia_host'")) return false;

  const present = new Set(
    (db.prepare("PRAGMA table_info(scheduled_jobs)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  const cols = SCHEDULED_JOBS_COLUMNS.filter((c) => present.has(c)).join(", ");

  // PRAGMA foreign_keys non ha effetto dentro una transazione: si spegne prima.
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      const seq = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'scheduled_jobs'").get() as
        | { seq: number }
        | undefined;
      db.exec("DROP TABLE IF EXISTS scheduled_jobs_v10");
      db.exec(`CREATE TABLE scheduled_jobs_v10 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
        job_type TEXT NOT NULL CHECK(${SCHEDULED_JOB_TYPES_CHECK_SQL}),
        interval_minutes INTEGER NOT NULL DEFAULT 60,
        last_run TEXT,
        next_run TEXT,
        enabled INTEGER DEFAULT 1,
        config TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`);
      db.exec(`INSERT INTO scheduled_jobs_v10 (${cols}) SELECT ${cols} FROM scheduled_jobs`);
      if (seq) {
        const upd = db.prepare("UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = 'scheduled_jobs_v10'").run(seq.seq);
        if (upd.changes === 0) {
          db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('scheduled_jobs_v10', ?)").run(seq.seq);
        }
      }
      db.exec("DROP TABLE scheduled_jobs");
      db.exec("ALTER TABLE scheduled_jobs_v10 RENAME TO scheduled_jobs");
      db.exec("CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_enabled_next ON scheduled_jobs(enabled, next_run)");
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
  return true;
}

/**
 * Migrazione runtime v11 di `scheduled_jobs` (scansione automatica, piano 2026-10-22): il CHECK di `job_type` accetta
 * `'apparati_scelti'`. Copia della v10 (CHECK dalla stessa costante dello schema, colonne copiate per nome, contatore
 * AUTOINCREMENT conservato, tutto in una transazione con foreign_keys spento prima); cambia la guardia, e in più:
 * - il numero di righe si conta prima e dopo la copia: se non torna si lancia e la transazione torna indietro;
 * - indici e trigger della tabella si rileggono da sqlite_master prima e si ricreano tali e quali dopo (oggi c'è solo
 *   `idx_scheduled_jobs_enabled_next`, che si ricrea comunque).
 * Se qualcosa non riesce la tabella resta com'era e l'errore sale a `getTenantDb`, che lo registra e apre il tenant.
 * Non crea nessun job: lo crea solo un admin da Discovery.
 *
 * Restituisce true se ha ricostruito, false se non c'era niente da fare.
 * Esportata per le prove (`scheduled-jobs-v11.test.ts`).
 */
export function migrateScheduledJobsV11(db: Database.Database): boolean {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scheduled_jobs'").get() as
    | { sql?: string }
    | undefined;
  if (!row?.sql || row.sql.includes("'apparati_scelti'")) return false;

  const conta = (t: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  let fatta = false;

  // PRAGMA foreign_keys non ha effetto dentro una transazione: si spegne prima.
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      // Guardia e colonne si rileggono dentro la transazione: un'altra connessione può aver già ricostruito.
      const dentro = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scheduled_jobs'").get() as
        | { sql?: string }
        | undefined;
      if (!dentro?.sql || dentro.sql.includes("'apparati_scelti'")) return;
      const present = (db.prepare("PRAGMA table_info(scheduled_jobs)").all() as Array<{ name: string }>).map((c) => c.name);
      // Una colonna che la copia non conosce si perderebbe in silenzio: si lancia e la tabella resta com'era.
      const ignote = present.filter((c) => !(SCHEDULED_JOBS_COLUMNS as readonly string[]).includes(c));
      if (ignote.length > 0) throw new Error(`v11: colonne di scheduled_jobs sconosciute alla copia: ${ignote.join(", ")}`);
      const cols = SCHEDULED_JOBS_COLUMNS.filter((c) => present.includes(c)).join(", ");
      const seq = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'scheduled_jobs'").get() as
        | { seq: number }
        | undefined;
      const accessori = db
        .prepare("SELECT sql FROM sqlite_master WHERE tbl_name = 'scheduled_jobs' AND type IN ('index', 'trigger') AND sql IS NOT NULL ORDER BY type, name")
        .all() as Array<{ sql: string }>;
      const prima = conta("scheduled_jobs");
      db.exec("DROP TABLE IF EXISTS scheduled_jobs_v11");
      db.exec(`CREATE TABLE scheduled_jobs_v11 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
        job_type TEXT NOT NULL CHECK(${SCHEDULED_JOB_TYPES_CHECK_SQL}),
        interval_minutes INTEGER NOT NULL DEFAULT 60,
        last_run TEXT,
        next_run TEXT,
        enabled INTEGER DEFAULT 1,
        config TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`);
      db.exec(`INSERT INTO scheduled_jobs_v11 (${cols}) SELECT ${cols} FROM scheduled_jobs`);
      const dopo = conta("scheduled_jobs_v11");
      if (dopo !== prima) throw new Error(`v11: copiate ${dopo} righe di scheduled_jobs su ${prima}`);
      if (seq) {
        const upd = db.prepare("UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = 'scheduled_jobs_v11'").run(seq.seq);
        if (upd.changes === 0) {
          db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('scheduled_jobs_v11', ?)").run(seq.seq);
        }
      }
      db.exec("DROP TABLE scheduled_jobs");
      db.exec("ALTER TABLE scheduled_jobs_v11 RENAME TO scheduled_jobs");
      for (const a of accessori) db.exec(a.sql);
      db.exec("CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_enabled_next ON scheduled_jobs(enabled, next_run)");
      fatta = true;
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
  return fatta;
}

/**
 * Tabella degli esiti dei job `apparati_scelti` (piano 2026-10-22 scansione automatica, Task 1): la tabella (se lo schema
 * non l'ha già creata) e il suo indice, solo se mancano. Additiva, idempotente, in UNA transazione; segno
 * `apparati_scelti_v21` = `done:<data>:v1` una volta sola. Separata dalla v11: se fallisce, i job di oggi restano come sono.
 * Restituisce i nomi degli oggetti aggiunti. Esportata per le prove (`scheduled-jobs-v11.test.ts`).
 */
export function migraApparatiScelti(db: Database.Database): string[] {
  const added: string[] = [];
  const c = db.prepare("SELECT 1 FROM sqlite_master WHERE type IN ('table', 'index') AND name = ?");
  db.transaction(() => {
    for (const [n, ddl] of [...DDL_JOB_APPARATI_ESITI, ...INDICI_JOB_APPARATI_ESITI]) {
      if (c.get(n)) continue;
      db.exec(ddl);
      added.push(n);
    }
    const chiusa = `:v${VERSIONE_APPARATI_SCELTI}`;
    const attuale = leggiSegno(db, SEGNO_APPARATI_SCELTI);
    if (!(attuale?.startsWith("done:") && attuale.endsWith(chiusa))) {
      scriviSegno(db, SEGNO_APPARATI_SCELTI, `done:${new Date().toISOString().slice(0, 10)}${chiusa}`);
    }
  })();
  return added;
}

/**
 * Migrazione runtime «topologia fase 1» (spec 2026-10-12-topology-map-design
 * §5, piano 2026-10-13-topologia-fase1-dati). Solo colonne e una tabella nuove,
 * in una transazione: o tutto o niente. Gli indici sulle colonne nuove stanno
 * QUI e non nello schema: lo schema gira prima, e su un DB vecchio un indice su
 * una colonna che ancora non c'è impedirebbe di aprire il tenant.
 * Esportata per le prove (`topology-phase1-migration.test.ts`).
 */
export function migrateTopologyPhase1(db: Database.Database): string[] {
  const added: string[] = [];
  const has = (table: string, col: string): boolean =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === col);
  const add = (table: string, col: string, ddl: string): void => {
    if (has(table, col)) return;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
    added.push(`${table}.${col}`);
  };
  db.transaction(() => {
    add("network_devices", "location_id", "INTEGER REFERENCES locations(id) ON DELETE SET NULL");
    add("network_devices", "location_set_by", "TEXT");
    add("network_devices", "location_set_at", "TEXT");
    add("network_devices", "topology_role", "TEXT");
    add("network_devices", "topology_hidden", "INTEGER NOT NULL DEFAULT 0");
    add("network_devices", "controller_mac", "TEXT");
    add("network_devices", "uplink_mac", "TEXT");
    add("network_devices", "uplink_remote_port", "INTEGER");
    add("network_devices", "uplink_seen_at", "TEXT");
    add("switch_ports", "is_uplink", "INTEGER NOT NULL DEFAULT 0");
    add("device_neighbors", "first_seen", "TEXT");
    add("device_neighbors", "source", "TEXT NOT NULL DEFAULT 'device'");
    add("locations", "head_device_id", "INTEGER REFERENCES network_devices(id) ON DELETE SET NULL");
    add("locations", "head_set_by", "TEXT");
    add("locations", "head_set_at", "TEXT");
    add("networks", "location_id", "INTEGER REFERENCES locations(id) ON DELETE SET NULL");
    add("networks", "location_set_by", "TEXT");
    add("networks", "location_set_at", "TEXT");
    add("topology_position", "structure_sig", "TEXT");
    if (added.includes("device_neighbors.first_seen")) {
      db.exec("UPDATE device_neighbors SET first_seen = timestamp WHERE first_seen IS NULL");
    }
    db.exec(`CREATE TABLE IF NOT EXISTS topology_link_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL CHECK(action IN ('add', 'ignore')),
      a_node TEXT NOT NULL,
      a_port TEXT NOT NULL DEFAULT '',
      b_node TEXT NOT NULL,
      b_port TEXT NOT NULL DEFAULT '',
      note TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    db.exec("CREATE INDEX IF NOT EXISTS idx_network_devices_location ON network_devices(location_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_networks_location ON networks(location_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_device_neighbors_timestamp ON device_neighbors(device_id, timestamp)");
  })();
  return added;
}

/**
 * Migrazione runtime «topologia fase 2» (spec §10.5-10.6, piano
 * 2026-10-13-topologia-fase2-mappa). La tabella dei MAC per porta invecchia
 * invece di essere riscritta a ogni lettura: serve una riga per (apparato, MAC,
 * porta), quindi prima si tolgono i doppi (si tiene la più recente, con la prima
 * volta vista più vecchia) e poi l'indice unico. Più la tabella delle mappe.
 * Tutto in una transazione. Esportata per le prove.
 */
export function migrateTopologyPhase2(db: Database.Database): string[] {
  const added: string[] = [];
  const has = (table: string, col: string): boolean =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === col);
  const exists = (name: string): boolean => !!db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(name);
  db.transaction(() => {
    if (!has("mac_port_entries", "first_seen")) {
      db.exec("ALTER TABLE mac_port_entries ADD COLUMN first_seen TEXT");
      added.push("mac_port_entries.first_seen");
    }
    if (!has("mac_port_entries", "source")) {
      db.exec("ALTER TABLE mac_port_entries ADD COLUMN source TEXT NOT NULL DEFAULT 'device'");
      added.push("mac_port_entries.source");
    }
    if (!exists("idx_mac_port_entries_key")) {
      db.exec(`UPDATE mac_port_entries SET first_seen = (
                 SELECT MIN(COALESCE(m2.first_seen, m2.timestamp)) FROM mac_port_entries m2
                  WHERE m2.device_id = mac_port_entries.device_id AND m2.mac = mac_port_entries.mac AND m2.port_name = mac_port_entries.port_name)
               WHERE first_seen IS NULL`);
      db.exec(`DELETE FROM mac_port_entries WHERE id NOT IN (
                 SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY device_id, mac, port_name ORDER BY timestamp DESC, id DESC) AS rn
                                   FROM mac_port_entries) WHERE rn = 1)`);
      db.exec("CREATE UNIQUE INDEX idx_mac_port_entries_key ON mac_port_entries(device_id, mac, port_name)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_mac_port_entries_mac ON mac_port_entries(mac)");
    }
    if (!exists("topology_maps")) {
      db.exec(`CREATE TABLE topology_maps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('auto', 'passo')),
        roots TEXT NOT NULL DEFAULT '[]',
        head_node TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
      db.exec("CREATE UNIQUE INDEX idx_topology_maps_auto ON topology_maps(kind) WHERE kind = 'auto'");
      added.push("topology_maps");
    }
  })();
  return added;
}

/**
 * Migrazione runtime «topologia fase 2b» (spec §11.3-11.5, piano
 * 2026-10-14-topologia-fase2b, Task 2). Gemella di `migrateTopologyPhase2`:
 * solo cose nuove, in una transazione, e l'elenco di ciò che ha aggiunto.
 * - `topology_link_overrides.medium`: tipo di un collegamento a mano
 *   (`'cavo' | 'fibra' | 'wireless'`, da T3 anche `'tunnel'`, o NULL; senza CHECK, lo validano le rotte,
 *   così un tipo nuovo non chiede di ricostruire la tabella). Le righe esistenti
 *   restano con NULL.
 * - `topology_link_primary`: per l'oggetto `node_id`, il collegamento principale
 *   scelto a mano è quello verso `other_node` su quelle porte (vince sulla
 *   scelta del sistema). Uno per oggetto.
 * - `network_devices.uplink_type`: `'wire' | 'wireless'` dalla lettura UniFi.
 *   Dopo le ricostruzioni di `network_devices` (ADR 0008 punto 6).
 * Esportata per le prove (`topology-phase2b-migration.test.ts`).
 */
export function migrateTopologyPhase2b(db: Database.Database): string[] {
  const added: string[] = [];
  const has = (table: string, col: string): boolean =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === col);
  const add = (table: string, col: string, ddl: string): void => {
    if (has(table, col)) return;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
    added.push(`${table}.${col}`);
  };
  const exists = (name: string): boolean => !!db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(name);
  db.transaction(() => {
    add("topology_link_overrides", "medium", "TEXT");
    add("network_devices", "uplink_type", "TEXT");
    if (!exists("topology_link_primary")) {
      db.exec(`CREATE TABLE topology_link_primary (
        node_id TEXT PRIMARY KEY,
        other_node TEXT NOT NULL,
        node_port TEXT NOT NULL DEFAULT '',
        other_port TEXT NOT NULL DEFAULT '',
        set_by TEXT,
        set_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
      added.push("topology_link_primary");
    }
  })();
  return added;
}

/**
 * Migrazione runtime «orientamento della mappa» (spec §12.2, piano
 * 2026-10-14-topologia-verticale-stampa, Task 1). Gemella di
 * `migrateTopologyPhase2b`: solo cose nuove, in una transazione, e l'elenco di
 * ciò che ha aggiunto.
 * - `topology_maps.orientation`: `'lr'` «Verticale» (predefinito, anche per le
 *   mappe già salvate) o `'tb'` «Orizzontale». Una scelta di come si consegna la
 *   mappa, uguale per tutti quelli che la guardano.
 * - `topology_position.orientation`: l'orientamento in cui è stato fatto un
 *   ritocco. NULL = `'tb'`: le righe di oggi sono nate in orizzontale. Le righe
 *   di sola appartenenza (`pinned = 0`) lo lasciano NULL.
 * Dopo `topology_maps` (fase 2), quindi dopo la fase 2b. Esportata per le prove
 * (`topology-orientation-migration.test.ts`).
 */
export function migrateTopologyOrientation(db: Database.Database): string[] {
  const added: string[] = [];
  const has = (table: string, col: string): boolean =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === col);
  const add = (table: string, col: string, ddl: string): void => {
    if (has(table, col)) return;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
    added.push(`${table}.${col}`);
  };
  db.transaction(() => {
    add("topology_maps", "orientation", "TEXT NOT NULL DEFAULT 'lr' CHECK(orientation IN ('lr','tb'))");
    add("topology_position", "orientation", "TEXT");
  })();
  return added;
}

/**
 * Versione SNMP per apparato (2026-10-15): `snmp_version` ('1' | '2c', NULL = non
 * rilevata, ogni punto parla come prima) e `snmp_version_fissata` (1 = scelta a
 * mano, la discovery non la sovrascrive). Solo colonne nuove, idempotente.
 * Esportata per le prove (`snmp-versione-migration.test.ts`).
 */
export function migrateSnmpVersione(db: Database.Database): string[] {
  const added: string[] = [];
  const has = (table: string, col: string): boolean =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === col);
  const add = (table: string, col: string, ddl: string): void => {
    if (has(table, col)) return;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
    added.push(`${table}.${col}`);
  };
  db.transaction(() => {
    add("network_devices", "snmp_version", "TEXT CHECK(snmp_version IN ('1', '2c'))");
    add("network_devices", "snmp_version_fissata", "INTEGER NOT NULL DEFAULT 0");
  })();
  return added;
}

/**
 * Classificazione scelta a mano anche sull'apparato (tappa 5, 21/10): `classification_manual` (1 = la scansione non
 * la riscrive), come già sugli host. Solo colonna nuova, idempotente. Esportata per le prove.
 */
export function migrateClassificazioneManualeApparato(db: Database.Database): string[] {
  const has = (db.prepare("PRAGMA table_info(network_devices)").all() as Array<{ name: string }>).some((c) => c.name === "classification_manual");
  if (has) return [];
  db.exec("ALTER TABLE network_devices ADD COLUMN classification_manual INTEGER NOT NULL DEFAULT 0");
  return ["network_devices.classification_manual"];
}

/**
 * Migrazione «topologia cavi» (spec 2026-10-14 §13.5.7, tappa T2): le colonne nuove dei vicini e degli apparati e le tre
 * tabelle dei fatti delle letture in più, con l'indice sui MAC. Additiva, idempotente, in UNA transazione (o tutto o
 * niente); restituisce ciò che aggiunge. Le tabelle nascono anche dallo schema (stesse CREATE, `DDL_TOPOLOGY_CAVI`): qui
 * servono ai DB aperti senza lo schema di oggi e alle prove. Chiamata in fondo a `getTenantDb`, dopo le ricostruzioni di
 * network_devices (ADR 0008 punto 6). Esportata per le prove (`topology-cavi-migration.test.ts`).
 */
export function migrateTopologyCavi(db: Database.Database): string[] {
  const added: string[] = [];
  const has = (table: string, col: string): boolean =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === col);
  const exists = (type: "table" | "index", name: string): boolean =>
    !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?").get(type, name);
  const add = (table: string, col: string, ddl: string): void => {
    if (has(table, col)) return;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
    added.push(`${table}.${col}`);
  };
  db.transaction(() => {
    add("device_neighbors", "discovered_by", "TEXT");
    add("device_neighbors", "local_port_index", "INTEGER");
    add("device_neighbors", "remote_port_index", "INTEGER");
    add("device_neighbors", "remote_caps", "TEXT");
    add("network_devices", "uplink_local_port_idx", "INTEGER");
    add("network_devices", "uplink_source", "TEXT");
    for (const [name, ddl] of DDL_TOPOLOGY_CAVI) {
      if (exists("table", name)) continue;
      db.exec(ddl);
      added.push(name);
    }
    add("topology_port_facts", "lag_state", "TEXT");
    if (!exists("index", "idx_topology_device_macs_mac")) {
      db.exec("CREATE INDEX idx_topology_device_macs_mac ON topology_device_macs(mac)");
      added.push("idx_topology_device_macs_mac");
    }
  })();
  return added;
}

/** Le colonne che le letture in più scrivono: tutte, o le letture non scrivono (§13.5.7, «Se la migrazione non riesce»). */
const COLONNE_CAVI: ReadonlyArray<readonly [string, string]> = [
  ["device_neighbors", "discovered_by"], ["device_neighbors", "local_port_index"], ["device_neighbors", "remote_port_index"],
  ["device_neighbors", "remote_caps"], ["network_devices", "uplink_local_port_idx"], ["network_devices", "uplink_source"],
  ["topology_port_facts", "lag_state"],
];
/** «Lo schema nuovo c'è», annotato all'apertura del DB del tenant: chi scrive i fatti lo chiede, non lo indovina. */
const SCHEMA_CAVI = new WeakMap<Database.Database, boolean>();

function verificaSchemaCavi(d: Database.Database): boolean {
  const tabelle = new Set((d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((r) => r.name));
  if (!DDL_TOPOLOGY_CAVI.every(([n]) => tabelle.has(n))) return false;
  return COLONNE_CAVI.every(([t, c]) => (d.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).some((x) => x.name === c));
}

/**
 * Migrazione «unioni a mano» (piano 2026-10-16, Task 2; ADR 0021): le due tabelle delle unioni e delle separazioni e i loro tre
 * indici sulle righe attive. Gemella di `migrateTopologyCavi`: additiva, idempotente, in UNA transazione (o tutto o niente),
 * restituisce ciò che aggiunge. Le tabelle nascono anche dallo schema (stesse CREATE, `DDL_TOPOLOGY_UNIONI`), gli indici solo
 * qui. Chiamata in fondo a `getTenantDb`. Esportata per le prove (`topology-unioni-migration.test.ts`).
 */
export function migrateTopologyUnioni(db: Database.Database): string[] {
  const added: string[] = [];
  const exists = (type: "table" | "index", name: string): boolean =>
    !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?").get(type, name);
  db.transaction(() => {
    for (const [name, ddl] of DDL_TOPOLOGY_UNIONI) {
      if (exists("table", name)) continue;
      db.exec(ddl);
      added.push(name);
    }
    for (const [name, ddl] of INDICI_TOPOLOGY_UNIONI) {
      if (exists("index", name)) continue;
      db.exec(ddl);
      added.push(name);
    }
  })();
  return added;
}

/**
 * Migrazione dell'archivio degli host (pulizia degli host assenti, piano 2026-10-20, Task 1): la tabella `hosts_archivio`
 * e i suoi due indici. Gemella di `migrateTopologyUnioni`: additiva, idempotente, in una transazione, restituisce ciò che
 * aggiunge. Chiamata in fondo a `getTenantDb`.
 */
export function migrateHostsArchivio(db: Database.Database): string[] {
  const added: string[] = [];
  const exists = (type: "table" | "index", name: string): boolean =>
    !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?").get(type, name);
  db.transaction(() => {
    for (const [name, ddl] of DDL_HOSTS_ARCHIVIO) {
      if (exists("table", name)) continue;
      db.exec(ddl);
      added.push(name);
    }
    for (const [name, ddl] of INDICI_HOSTS_ARCHIVIO) {
      if (exists("index", name)) continue;
      db.exec(ddl);
      added.push(name);
    }
  })();
  return added;
}

/** Le colonne di un livello della scheda MikroTik che mancano (PRAGMA: costa niente). */
function colonneSchedaMkMancanti(db: Database.Database, voci: ReadonlyArray<readonly [string, string, string]>): Array<readonly [string, string, string]> {
  const presenti = new Map<string, Set<string>>();
  const di = (t: string): Set<string> => {
    let s = presenti.get(t);
    if (!s) {
      s = new Set((db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name));
      presenti.set(t, s);
    }
    return s;
  };
  return voci.filter(([t, c]) => !di(t).has(c));
}

/** Versione completa dello schema della scheda MikroTik presente, annotata all'apertura (0 = niente), come SCHEMA_CAVI. */
const SCHEMA_SCHEDA_MK = new WeakMap<Database.Database, number>();

/** Le tabelle di un livello della scheda MikroTik che mancano (sqlite_master: una vista con lo stesso nome non conta). */
function tabelleSchedaMkMancanti(db: Database.Database, voci: ReadonlyArray<readonly [string, string]>): Array<readonly [string, string]> {
  const c = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
  return voci.filter(([n]) => !c.get(n));
}

function misuraLivelloSchedaMk(d: Database.Database): number {
  // I livelli si sommano: ognuno vale solo se c'è tutto il precedente.
  const livelli: Array<() => boolean> = [
    () => colonneSchedaMkMancanti(d, COLONNE_SCHEDA_MK_V1).length === 0,
    () => tabelleSchedaMkMancanti(d, DDL_SCHEDA_MK_V2).length === 0,
    () => tabelleSchedaMkMancanti(d, DDL_SCHEDA_MK_V3).length === 0,
  ];
  let n = 0;
  for (const completo of livelli) {
    if (!completo()) break;
    n++;
  }
  return n;
}

/**
 * Livello dello schema della scheda MikroTik presente nel database (0 = nessuno): chi scrive le colonne nuove lo chiede
 * prima (`>= 1`), così su un tenant la cui migrazione è fallita le scritture di oggi restano quelle di oggi.
 */
export function livelloSchemaSchedaMk(d: Database.Database): number {
  // Annotato anche sotto il bersaglio (rilievo della revisione del Task 8): una v2 fallita non deve costare le query di
  // schema a ogni chiamata. Si rimisura solo con la migrazione o con rileggiSchemaSchedaMk().
  const v = SCHEMA_SCHEDA_MK.get(d);
  if (v !== undefined) return v;
  const n = misuraLivelloSchedaMk(d);
  SCHEMA_SCHEDA_MK.set(d, n);
  return n;
}

/** Il livello dello schema della scheda del tenant corrente (annotato, come livelloSchemaSchedaMk). */
export function livelloSchedaMkCorrente(): number {
  return livelloSchemaSchedaMk(db());
}

/** Rimisura il livello dello schema della scheda del tenant corrente (prove; dopo una correzione a mano dello schema). */
export function rileggiSchemaSchedaMk(): number {
  const d = db();
  const n = misuraLivelloSchedaMk(d);
  SCHEMA_SCHEDA_MK.set(d, n);
  return n;
}

/**
 * Dopo una migrazione fallita: se lo schema è comunque completo (un altro processo ha vinto la corsa e ha aggiunto le
 * colonne mentre noi fallivamo su «duplicate column») il segno resta `done`, non `errore:…`; altrimenti si scrive l'errore.
 */
export function chiudiMigrazioneSchedaMkFallita(db: Database.Database, tenantCode: string, e: unknown): void {
  try {
    if (misuraLivelloSchedaMk(db) >= VERSIONE_SCHEDA_MK) {
      SCHEMA_SCHEDA_MK.set(db, VERSIONE_SCHEDA_MK);
      const attuale = leggiSegno(db, SEGNO_SCHEDA_MK);
      if (!attuale?.startsWith("done:")) scriviSegno(db, SEGNO_SCHEDA_MK, `done:${new Date().toISOString().slice(0, 10)}:v${VERSIONE_SCHEDA_MK}`);
    } else {
      scriviSegno(db, SEGNO_SCHEDA_MK, segnoErrore(e));
    }
  } catch (e2) {
    console.error(`[db-tenant] ${tenantCode}: ${SEGNO_SCHEDA_MK}, segno non scritto:`, e2);
  }
}

/**
 * Migrazione della scheda MikroTik (piano 2026-10-21): livello 1 (Task 3), le colonne di COLONNE_SCHEDA_MK_V1 solo se
 * mancano (`PRAGMA table_info`); livello 2 (Task 8, ADR 0027), le tre tabelle di DDL_SCHEDA_MK_V2 solo se mancano; livello 3
 * (Task 10), le quattro di DDL_SCHEDA_MK_V3 (VLAN dei bridge, interfacce VLAN, DNS, utenti) solo se mancano.
 * Additiva, idempotente, in UNA transazione; restituisce «tabella.colonna» o il nome della tabella di ciò che aggiunge. Poi
 * scrive il segno `done:<data>:v<versione>` (dice fin dove è arrivato lo schema; la migrazione non lo consulta).
 */
export function migrateSchedaMikrotik(db: Database.Database): string[] {
  const added: string[] = [];
  db.transaction(() => {
    for (const [t, c, ddl] of colonneSchedaMkMancanti(db, COLONNE_SCHEDA_MK_V1)) {
      db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${ddl}`);
      added.push(`${t}.${c}`);
    }
    for (const [n, ddl] of [...tabelleSchedaMkMancanti(db, DDL_SCHEDA_MK_V2), ...tabelleSchedaMkMancanti(db, DDL_SCHEDA_MK_V3)]) {
      db.exec(ddl);
      added.push(n);
    }
    // Il segno si scrive una volta per versione: a una seconda apertura non cambia (né valore né updated_at).
    const chiusa = `:v${VERSIONE_SCHEDA_MK}`;
    const attuale = leggiSegno(db, SEGNO_SCHEDA_MK);
    if (!(attuale?.startsWith("done:") && attuale.endsWith(chiusa))) {
      scriviSegno(db, SEGNO_SCHEDA_MK, `done:${new Date().toISOString().slice(0, 10)}${chiusa}`);
    }
  })();
  SCHEMA_SCHEDA_MK.set(db, misuraLivelloSchedaMk(db));
  return added;
}

/** Colonna e indice del principale del cluster presenti (PRAGMA e sqlite_master: costano niente). */
function schemaClusterPrincipaleCompleto(db: Database.Database): boolean {
  const [t, c] = COLONNA_CLUSTER_PRINCIPALE;
  const col = (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).some((r) => r.name === c);
  return col && !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(INDICE_CLUSTER_PRINCIPALE[0]);
}

/**
 * Principale del cluster fisico (piano 2026-10-22 accorpamento, Task 3): `physical_devices.primary_host_id` e il suo indice,
 * solo se mancano. Additiva, idempotente, in UNA transazione; restituisce «tabella.colonna» e il nome dell'indice di ciò che
 * aggiunge, poi scrive il segno `done:<data>:v1` una volta sola (la migrazione non lo consulta).
 */
export function migrateClusterPrincipale(db: Database.Database): string[] {
  const added: string[] = [];
  const [t, c, ddl] = COLONNA_CLUSTER_PRINCIPALE;
  const [nomeIndice, ddlIndice] = INDICE_CLUSTER_PRINCIPALE;
  db.transaction(() => {
    const presenti = (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((r) => r.name);
    if (!presenti.includes(c)) {
      db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${ddl}`);
      added.push(`${t}.${c}`);
    }
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(nomeIndice)) {
      db.exec(ddlIndice);
      added.push(nomeIndice);
    }
    const chiusa = `:v${VERSIONE_CLUSTER_PRINCIPALE}`;
    const attuale = leggiSegno(db, SEGNO_CLUSTER_PRINCIPALE);
    if (!(attuale?.startsWith("done:") && attuale.endsWith(chiusa))) {
      scriviSegno(db, SEGNO_CLUSTER_PRINCIPALE, `done:${new Date().toISOString().slice(0, 10)}${chiusa}`);
    }
  })();
  return added;
}

/** Dopo una migrazione fallita: schema completo (un altro processo ha vinto la corsa) → segno `done`, altrimenti `errore:…`. */
export function chiudiMigrazioneClusterPrincipaleFallita(db: Database.Database, tenantCode: string, e: unknown): void {
  try {
    if (schemaClusterPrincipaleCompleto(db)) {
      const attuale = leggiSegno(db, SEGNO_CLUSTER_PRINCIPALE);
      if (!attuale?.startsWith("done:")) scriviSegno(db, SEGNO_CLUSTER_PRINCIPALE, `done:${new Date().toISOString().slice(0, 10)}:v${VERSIONE_CLUSTER_PRINCIPALE}`);
    } else {
      scriviSegno(db, SEGNO_CLUSTER_PRINCIPALE, segnoErrore(e));
    }
  } catch (e2) {
    console.error(`[db-tenant] ${tenantCode}: ${SEGNO_CLUSTER_PRINCIPALE}, segno non scritto:`, e2);
  }
}

/** «Le quattro tabelle delle VLAN degli switch ci sono», annotato all'apertura come SCHEMA_SCHEDA_MK (niente query di schema a ogni scrittura). */
const SCHEMA_SWITCH_VLAN = new WeakMap<Database.Database, boolean>();

/** Schema delle VLAN degli switch presente (annotato; si rimisura solo con la migrazione o con rileggiSchemaSwitchVlan()). */
export function schemaSwitchVlanPresente(d: Database.Database): boolean {
  const v = SCHEMA_SWITCH_VLAN.get(d);
  if (v !== undefined) return v;
  const n = tabelleSchedaMkMancanti(d, DDL_SWITCH_VLAN_V1).length === 0;
  SCHEMA_SWITCH_VLAN.set(d, n);
  return n;
}

/** Schema delle VLAN degli switch del tenant corrente (la lettura `switch_vlan` lo chiede prima di aprire la sessione SNMP). */
export function schemaSwitchVlanCorrente(): boolean {
  return schemaSwitchVlanPresente(db());
}

/** Rimisura lo schema delle VLAN degli switch del tenant corrente (prove; dopo una correzione a mano dello schema). */
export function rileggiSchemaSwitchVlan(): boolean {
  const d = db();
  const n = tabelleSchedaMkMancanti(d, DDL_SWITCH_VLAN_V1).length === 0;
  SCHEMA_SWITCH_VLAN.set(d, n);
  return n;
}

/**
 * VLAN degli switch (piano 2026-10-22 accorpamento, Task 8, ADR 0029): le quattro tabelle di DDL_SWITCH_VLAN_V1 solo se
 * mancano (sqlite_master: una vista con lo stesso nome fa fallire, non passa muta). Additiva, idempotente, in UNA transazione;
 * restituisce i nomi delle tabelle che aggiunge, poi scrive il segno `done:<data>:v1` una volta sola (la migrazione non lo consulta).
 */
export function migrateSwitchVlan(db: Database.Database): string[] {
  const added: string[] = [];
  db.transaction(() => {
    for (const [n, ddl] of tabelleSchedaMkMancanti(db, DDL_SWITCH_VLAN_V1)) {
      db.exec(ddl);
      added.push(n);
    }
    const chiusa = `:v${VERSIONE_SWITCH_VLAN}`;
    const attuale = leggiSegno(db, SEGNO_SWITCH_VLAN);
    if (!(attuale?.startsWith("done:") && attuale.endsWith(chiusa))) {
      scriviSegno(db, SEGNO_SWITCH_VLAN, `done:${new Date().toISOString().slice(0, 10)}${chiusa}`);
    }
  })();
  SCHEMA_SWITCH_VLAN.set(db, tabelleSchedaMkMancanti(db, DDL_SWITCH_VLAN_V1).length === 0);
  return added;
}

/** Dopo una migrazione fallita: schema completo (un altro processo ha vinto la corsa) → segno `done`, altrimenti `errore:…`. */
export function chiudiMigrazioneSwitchVlanFallita(db: Database.Database, tenantCode: string, e: unknown): void {
  try {
    const completo = tabelleSchedaMkMancanti(db, DDL_SWITCH_VLAN_V1).length === 0;
    SCHEMA_SWITCH_VLAN.set(db, completo);
    if (completo) {
      const attuale = leggiSegno(db, SEGNO_SWITCH_VLAN);
      if (!attuale?.startsWith("done:")) scriviSegno(db, SEGNO_SWITCH_VLAN, `done:${new Date().toISOString().slice(0, 10)}:v${VERSIONE_SWITCH_VLAN}`);
    } else {
      scriviSegno(db, SEGNO_SWITCH_VLAN, segnoErrore(e));
    }
  } catch (e2) {
    console.error(`[db-tenant] ${tenantCode}: ${SEGNO_SWITCH_VLAN}, segno non scritto:`, e2);
  }
}

/** «La tabella delle VLAN native dal controller c'è», annotato all'apertura come le altre. */
const SCHEMA_SWITCH_VLAN_NATIVA = new WeakMap<Database.Database, boolean>();

export function schemaSwitchVlanNativaPresente(d: Database.Database): boolean {
  const v = SCHEMA_SWITCH_VLAN_NATIVA.get(d);
  if (v !== undefined) return v;
  const n = tabelleSchedaMkMancanti(d, DDL_SWITCH_VLAN_NATIVA).length === 0;
  SCHEMA_SWITCH_VLAN_NATIVA.set(d, n);
  return n;
}

/**
 * VLAN native dal controller UniFi (piano 2026-10-22 accorpamento, Task 13): la tabella di DDL_SWITCH_VLAN_NATIVA solo se
 * manca. Additiva, idempotente, in UNA transazione; segno `done:<data>:v1` una volta sola. Separata da `migrateSwitchVlan`:
 * se fallisce, le VLAN via SNMP restano come sono.
 */
export function migrateSwitchVlanNativa(db: Database.Database): string[] {
  const added: string[] = [];
  db.transaction(() => {
    for (const [n, ddl] of tabelleSchedaMkMancanti(db, DDL_SWITCH_VLAN_NATIVA)) {
      db.exec(ddl);
      added.push(n);
    }
    const chiusa = `:v${VERSIONE_SWITCH_VLAN_NATIVA}`;
    const attuale = leggiSegno(db, SEGNO_SWITCH_VLAN_NATIVA);
    if (!(attuale?.startsWith("done:") && attuale.endsWith(chiusa))) {
      scriviSegno(db, SEGNO_SWITCH_VLAN_NATIVA, `done:${new Date().toISOString().slice(0, 10)}${chiusa}`);
    }
  })();
  SCHEMA_SWITCH_VLAN_NATIVA.set(db, tabelleSchedaMkMancanti(db, DDL_SWITCH_VLAN_NATIVA).length === 0);
  return added;
}

/** Livello dello schema di LibreNMS come fonte (0 = assente, 1 = le tabelle della v1 con i loro indici), annotato all'apertura. */
const LIVELLO_LIBRENMS = new WeakMap<Database.Database, number>();

function misuraLivelloLibrenms(d: Database.Database): number {
  if (tabelleSchedaMkMancanti(d, DDL_LIBRENMS_FONTE_V1).length > 0) return 0;
  const c = d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?");
  return INDICI_LIBRENMS_FONTE_V1.every(([n]) => !!c.get(n)) ? 1 : 0;
}

/** Livello dello schema di LibreNMS di un DB (annotato; si rimisura solo con la migrazione). */
export function livelloSchemaLibrenmsDb(d: Database.Database): number {
  const v = LIVELLO_LIBRENMS.get(d);
  if (v !== undefined) return v;
  const n = misuraLivelloLibrenms(d);
  LIVELLO_LIBRENMS.set(d, n);
  return n;
}

/** Livello dello schema di LibreNMS del tenant corrente: sotto 1 la lettura e i rifiuti non si scrivono. */
export function livelloSchemaLibrenms(): number {
  return livelloSchemaLibrenmsDb(db());
}

/**
 * LibreNMS come fonte di dati (piano 2026-10-22 LibreNMS, task 2): le tabelle di DDL_LIBRENMS_FONTE_V1 e i loro indici,
 * solo se mancano (sqlite_master: un oggetto con lo stesso nome fa fallire, non passa muto). Additiva, idempotente, in
 * UNA transazione; restituisce i nomi di ciò che aggiunge, poi scrive il segno `done:<data>:v1` una volta sola.
 */
export function migrateLibrenmsFonte(db: Database.Database): string[] {
  const added: string[] = [];
  db.transaction(() => {
    for (const [n, ddl] of tabelleSchedaMkMancanti(db, DDL_LIBRENMS_FONTE_V1)) {
      db.exec(ddl);
      added.push(n);
    }
    const c = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?");
    for (const [n, ddl] of INDICI_LIBRENMS_FONTE_V1) {
      if (c.get(n)) continue;
      db.exec(ddl);
      added.push(n);
    }
    const chiusa = `:v${VERSIONE_LIBRENMS_FONTE}`;
    const attuale = leggiSegno(db, SEGNO_LIBRENMS_FONTE);
    if (!(attuale?.startsWith("done:") && attuale.endsWith(chiusa))) {
      scriviSegno(db, SEGNO_LIBRENMS_FONTE, `done:${new Date().toISOString().slice(0, 10)}${chiusa}`);
    }
  })();
  LIVELLO_LIBRENMS.set(db, misuraLivelloLibrenms(db));
  return added;
}

/** Dopo una migrazione fallita: schema completo (un altro processo ha vinto la corsa) → segno `done`, altrimenti `errore:…`. */
export function chiudiMigrazioneLibrenmsFonteFallita(db: Database.Database, tenantCode: string, e: unknown): void {
  try {
    const livello = misuraLivelloLibrenms(db);
    LIVELLO_LIBRENMS.set(db, livello);
    if (livello >= VERSIONE_LIBRENMS_FONTE) {
      const attuale = leggiSegno(db, SEGNO_LIBRENMS_FONTE);
      if (!attuale?.startsWith("done:")) scriviSegno(db, SEGNO_LIBRENMS_FONTE, `done:${new Date().toISOString().slice(0, 10)}:v${VERSIONE_LIBRENMS_FONTE}`);
    } else {
      scriviSegno(db, SEGNO_LIBRENMS_FONTE, segnoErrore(e));
    }
  } catch (e2) {
    console.error(`[db-tenant] ${tenantCode}: ${SEGNO_LIBRENMS_FONTE}, segno non scritto:`, e2);
  }
}

/** «La tabella delle esclusioni da LibreNMS c'è», annotato all'apertura come le altre. */
const SCHEMA_LIBRENMS_ESCLUSIONE = new WeakMap<Database.Database, boolean>();

/** Esclusioni da LibreNMS presenti (annotato; si rimisura solo con la migrazione). Senza, il giro non aggiunge oggetti SNMP. */
export function schemaEsclusioneLibrenms(d: Database.Database = db()): boolean {
  const v = SCHEMA_LIBRENMS_ESCLUSIONE.get(d);
  if (v !== undefined) return v;
  const n = tabelleSchedaMkMancanti(d, DDL_LIBRENMS_ESCLUSIONE).length === 0;
  SCHEMA_LIBRENMS_ESCLUSIONE.set(d, n);
  return n;
}

/**
 * Tabella delle esclusioni da LibreNMS (giro del 22/10, punto 2): solo se manca, in UNA transazione, poi il segno
 * `done:<data>:v1` una volta sola. Restituisce i nomi di ciò che aggiunge.
 */
export function migrateLibrenmsEsclusione(db: Database.Database): string[] {
  const added: string[] = [];
  try {
    db.transaction(() => {
      for (const [n, ddl] of tabelleSchedaMkMancanti(db, DDL_LIBRENMS_ESCLUSIONE)) {
        db.exec(ddl);
        added.push(n);
      }
      const chiusa = `:v${VERSIONE_LIBRENMS_ESCLUSIONE}`;
      const attuale = leggiSegno(db, SEGNO_LIBRENMS_ESCLUSIONE);
      if (!(attuale?.startsWith("done:") && attuale.endsWith(chiusa))) {
        scriviSegno(db, SEGNO_LIBRENMS_ESCLUSIONE, `done:${new Date().toISOString().slice(0, 10)}${chiusa}`);
      }
    })();
  } finally {
    SCHEMA_LIBRENMS_ESCLUSIONE.set(db, tabelleSchedaMkMancanti(db, DDL_LIBRENMS_ESCLUSIONE).length === 0);
  }
  return added;
}

/** «Colonne, tabella e indici degli assegnatari da AD ci sono», annotato all'apertura come gli altri. */
const SCHEMA_ASSEGNATARI_AD = new WeakMap<Database.Database, boolean>();

function oggettiAssegnatariAdMancanti(d: Database.Database): string[] {
  const t = d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
  const i = d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?");
  return [
    ...colonneSchedaMkMancanti(d, COLONNE_ASSEGNATARI_AD).map(([tab, c]) => `${tab}.${c}`),
    ...DDL_ASSEGNATARI_AD.filter(([n]) => !t.get(n)).map(([n]) => n),
    ...INDICI_ASSEGNATARI_AD.filter(([n]) => !i.get(n)).map(([n]) => n),
  ];
}

/** Schema degli assegnatari da AD presente (annotato; si rimisura solo con la migrazione). Rotte e giro lo chiedono prima di leggere. */
export function schemaAssegnatariAdPresente(d: Database.Database): boolean {
  const v = SCHEMA_ASSEGNATARI_AD.get(d);
  if (v !== undefined) return v;
  const n = oggettiAssegnatariAdMancanti(d).length === 0;
  SCHEMA_ASSEGNATARI_AD.set(d, n);
  return n;
}

/**
 * Assegnatari da AD (piano 2026-10-23, passo 1): le colonne di COLONNE_ASSEGNATARI_AD, la tabella degli accessi e i suoi
 * indici, solo se mancano. Additiva, idempotente, in UNA transazione; restituisce «tabella.colonna» o il nome di ciò che
 * aggiunge, poi scrive il segno `done:<data>:v1` una volta sola (la migrazione non lo consulta).
 */
export function migrateAssegnatariAd(db: Database.Database): string[] {
  const added: string[] = [];
  try {
    db.transaction(() => {
      for (const [t, c, ddl] of colonneSchedaMkMancanti(db, COLONNE_ASSEGNATARI_AD)) {
        db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${ddl}`);
        added.push(`${t}.${c}`);
      }
      const tab = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
      for (const [n, ddl] of DDL_ASSEGNATARI_AD) {
        if (tab.get(n)) continue;
        db.exec(ddl);
        added.push(n);
      }
      const idx = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?");
      for (const [n, ddl] of INDICI_ASSEGNATARI_AD) {
        if (idx.get(n)) continue;
        db.exec(ddl);
        added.push(n);
      }
      const chiusa = `:v${VERSIONE_ASSEGNATARI_AD}`;
      const attuale = leggiSegno(db, SEGNO_ASSEGNATARI_AD);
      if (!(attuale?.startsWith("done:") && attuale.endsWith(chiusa))) {
        scriviSegno(db, SEGNO_ASSEGNATARI_AD, `done:${new Date().toISOString().slice(0, 10)}${chiusa}`);
      }
    })();
  } finally {
    SCHEMA_ASSEGNATARI_AD.set(db, oggettiAssegnatariAdMancanti(db).length === 0);
  }
  return added;
}

/** «Colonna e registro del vault ci sono», annotato all'apertura come gli altri. */
const SCHEMA_VAULT = new WeakMap<Database.Database, boolean>();

function oggettiVaultMancanti(d: Database.Database): string[] {
  const t = d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
  const i = d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?");
  return [
    ...colonneSchedaMkMancanti(d, COLONNE_VAULT).map(([tab, c]) => `${tab}.${c}`),
    ...DDL_VAULT.filter(([n]) => !t.get(n)).map(([n]) => n),
    ...INDICI_VAULT.filter(([n]) => !i.get(n)).map(([n]) => n),
  ];
}

/** Schema del vault presente (annotato; si rimisura solo con la migrazione). Il registro e il riferimento lo chiedono prima. */
export function schemaVaultPresente(d: Database.Database): boolean {
  const v = SCHEMA_VAULT.get(d);
  if (v !== undefined) return v;
  const n = oggettiVaultMancanti(d).length === 0;
  SCHEMA_VAULT.set(d, n);
  return n;
}

/**
 * da-vault (piano 2026-10-23): `credentials.credential_ref` e il registro `vault_visualizzazioni` col suo indice, solo
 * se mancano. Additiva, idempotente, in UNA transazione; restituisce ciò che aggiunge e scrive il segno una volta sola.
 * Gli interruttori del vault non la guardano: lo schema c'è anche spenti, e spenti nessuno lo legge.
 */
export function migrateVault(db: Database.Database): string[] {
  const added: string[] = [];
  try {
    db.transaction(() => {
      for (const [t, c, ddl] of colonneSchedaMkMancanti(db, COLONNE_VAULT)) {
        db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${ddl}`);
        added.push(`${t}.${c}`);
      }
      const tab = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
      for (const [n, ddl] of DDL_VAULT) {
        if (tab.get(n)) continue;
        db.exec(ddl);
        added.push(n);
      }
      const idx = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?");
      for (const [n, ddl] of INDICI_VAULT) {
        if (idx.get(n)) continue;
        db.exec(ddl);
        added.push(n);
      }
      const chiusa = `:v${VERSIONE_VAULT}`;
      const attuale = leggiSegno(db, SEGNO_VAULT);
      if (!(attuale?.startsWith("done:") && attuale.endsWith(chiusa))) {
        scriviSegno(db, SEGNO_VAULT, `done:${new Date().toISOString().slice(0, 10)}${chiusa}`);
      }
    })();
  } finally {
    SCHEMA_VAULT.set(db, oggettiVaultMancanti(db).length === 0);
  }
  return added;
}

/** «La coda verso DA-Vul-can c'è, col suo indice», annotato all'apertura come le altre (niente query di schema a ogni accodamento). */
const SCHEMA_VULCAN = new WeakMap<Database.Database, boolean>();

function oggettiVulcanMancanti(d: Database.Database): Array<readonly [string, string]> {
  const t = d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
  const i = d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?");
  return [...DDL_VULCAN.filter(([n]) => !t.get(n)), ...INDICI_VULCAN.filter(([n]) => !i.get(n))];
}

/** Coda verso DA-Vul-can presente (annotato; si rimisura solo con la migrazione). Chi accoda lo chiede prima di scrivere. */
export function schemaVulcanPresente(d: Database.Database): boolean {
  const v = SCHEMA_VULCAN.get(d);
  if (v !== undefined) return v;
  const n = oggettiVulcanMancanti(d).length === 0;
  SCHEMA_VULCAN.set(d, n);
  return n;
}

/**
 * Coda degli invii verso DA-Vul-can (piano 2026-10-22 invio AD e inventario, Task 2): le tabelle di DDL_VULCAN e
 * l'indice di INDICI_VULCAN solo se mancano (sqlite_master: un oggetto omonimo di altro tipo fa fallire, non passa muto).
 * Additiva, idempotente, in UNA transazione; restituisce i nomi di ciò che aggiunge, poi scrive il segno `done:<data>:v1`
 * una volta sola (la migrazione non lo consulta).
 */
export function migrateVulcanCoda(db: Database.Database): string[] {
  const added: string[] = [];
  try {
    db.transaction(() => {
      for (const [n, ddl] of oggettiVulcanMancanti(db)) {
        db.exec(ddl);
        added.push(n);
      }
      const chiusa = `:v${VERSIONE_VULCAN}`;
      const attuale = leggiSegno(db, SEGNO_VULCAN);
      if (!(attuale?.startsWith("done:") && attuale.endsWith(chiusa))) {
        scriviSegno(db, SEGNO_VULCAN, `done:${new Date().toISOString().slice(0, 10)}${chiusa}`);
      }
    })();
  } finally {
    SCHEMA_VULCAN.set(db, oggettiVulcanMancanti(db).length === 0);
  }
  return added;
}

/** «Le tabelle delle unioni ci sono, con i loro indici», annotato all'apertura: senza, l'ingresso non ha righe e le rotte non scrivono. */
const SCHEMA_UNIONI = new WeakMap<Database.Database, boolean>();
const NOMI_SCHEMA_UNIONI = [...DDL_TOPOLOGY_UNIONI, ...INDICI_TOPOLOGY_UNIONI].map(([n]) => n);

/** Tabelle e indici: l'indice unico dei membri è la regola «un membro attivo in un gruppo solo», senza non si scrive. */
function verificaSchemaUnioni(d: Database.Database): boolean {
  const c = d.prepare(`SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name IN (${NOMI_SCHEMA_UNIONI.map(() => "?").join(", ")})`)
    .all(...NOMI_SCHEMA_UNIONI);
  return c.length === NOMI_SCHEMA_UNIONI.length;
}

/**
 * Quanti giorni resta una riga di mac_port_entries non più vista (spec §10.5):
 * la usano la pulizia all'apertura del database e `cleanupOldMacPortEntries`.
 */
export const MAC_PORT_RETENTION_DAYS = 30;

export function getTenantDb(tenantCode: string): Database.Database {
  const existing = tenantDbs.get(tenantCode);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.db;
  }

  // Evict LRU if over limit
  if (tenantDbs.size >= MAX_OPEN_DBS) {
    let oldest: string | null = null;
    let oldestTime = Infinity;
    for (const [code, entry] of tenantDbs) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldest = code;
      }
    }
    if (oldest) {
      closeTenantDb(oldest);
    }
  }

  // Ensure directory
  if (!fs.existsSync(TENANTS_DIR)) {
    fs.mkdirSync(TENANTS_DIR, { recursive: true });
  }

  const dbPath = unisci(TENANTS_DIR, `${tenantCode}.db`);
  // TEN-02 hardening: containment. Il file DB del tenant DEVE trovarsi
  // direttamente dentro TENANTS_DIR. Un tenantCode con path traversal
  // (es. "../hub") aprirebbe altrimenti hub.db come se fosse un DB tenant,
  // applicandovi schema/migrazioni e corrompendolo. Fail-closed.
  if (path.dirname(risolvi(dbPath)) !== risolvi(TENANTS_DIR)) {
    throw new Error(`Tenant code non valido: ${tenantCode}`);
  }
  // NUC-1 fase A: ogni apertura (fuori dalla cache) del database di un codice
  // che l'hub non conosce si conta, che il file stia per nascere o esista già
  // (file orfani nati prima del registro, anche da 0 byte). L'esito non cambia
  // ancora. Solo con l'hub presente: senza hub (script, generazione del
  // template) non c'è un registro da consultare.
  if (fs.existsSync(getHubDbPath())) {
    let registrato = true;
    try {
      registrato = getTenantByCode(tenantCode) !== undefined;
    } catch { /* hub illeggibile: non si sa, non si conta */ }
    if (!registrato) registraRipiego("tenant_non_registrato", tenantCode);
  }
  const newDb = new Database(dbPath);
  // Ordinamento numerico di IP e CIDR nelle liste paginate (UI-9).
  newDb.function("ip_sort_key", { deterministic: true }, (v: unknown) => ipSortKey(v));

  // Apply PRAGMAs
  newDb.pragma("journal_mode = WAL");
  newDb.pragma("foreign_keys = ON");
  newDb.pragma("synchronous = NORMAL");
  newDb.pragma("cache_size = -64000");
  newDb.pragma("temp_store = MEMORY");
  newDb.pragma("mmap_size = 268435456");
  // v0.2.641 audit perf DB7/MC12:
  //  - wal_autocheckpoint=200: checkpoint più frequenti su scan write-heavy,
  //    evita WAL che cresce a >50MB tra checkpoint e abbatte picchi I/O.
  //  - busy_timeout=5000: reader/writer concorrenti (cron + UI sullo stesso
  //    tenant) attendono 5s prima di SQLITE_BUSY invece di fallire subito.
  newDb.pragma("wal_autocheckpoint = 200");
  newDb.pragma("busy_timeout = 5000");

  // Create schema if needed
  newDb.exec(TENANT_SCHEMA_SQL);

  // Migrazione runtime (PRIMA degli indici): software_scans con device_id + host_id nullable.
  // Deve girare prima di TENANT_INDEXES_SQL perché tale blocco contiene
  // CREATE INDEX su software_scans(device_id, ...) e fallirebbe se la colonna manca.
  try {
    const cols = newDb.prepare("PRAGMA table_info(software_scans)").all() as Array<{ name: string; notnull: number }>;
    const hasDeviceId = cols.some((c) => c.name === "device_id");
    const hostIdNotNull = cols.find((c) => c.name === "host_id")?.notnull === 1;
    if (cols.length > 0 && (!hasDeviceId || hostIdNotNull)) {
      const count = (newDb.prepare("SELECT COUNT(*) AS n FROM software_scans").get() as { n: number }).n;
      if (count === 0) {
        newDb.pragma("foreign_keys = OFF");
        newDb.exec("DROP TABLE IF EXISTS software_scan_logs");
        newDb.exec("DROP TABLE IF EXISTS software_inventory");
        newDb.exec("DROP TABLE IF EXISTS software_scans");
        newDb.exec(TENANT_SCHEMA_SQL);
        newDb.pragma("foreign_keys = ON");
        console.info(`[db-tenant] ${tenantCode}: software_scans schema rigenerato (host_id nullable + device_id)`);
      } else {
        console.warn(`[db-tenant] ${tenantCode}: software_scans ha ${count} righe, schema NON aggiornato (richiede migrazione dati manuale)`);
      }
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione software_scans device_id fallita:`, e);
  }

  // Migrazione runtime (PRIMA degli indici): aggiungi hosts.os_family GENERATED VIRTUAL
  // su tenant DB esistenti. Auto-derivata da os_info (Windows/Linux/Apple/Unknown).
  // DEVE girare PRIMA di TENANT_INDEXES_SQL perché tale blocco crea
  // `CREATE INDEX idx_hosts_os_family ON hosts(os_family)` e fallirebbe se la
  // colonna non esiste ancora (bug v0.2.554 → fix v0.2.560).
  const OS_FAMILY_GENERATED_SQL = `
    GENERATED ALWAYS AS (
      CASE
        WHEN os_info IS NULL OR TRIM(os_info) = '' THEN 'Unknown'
        WHEN LOWER(os_info) LIKE '%windows%' THEN 'Windows'
        WHEN LOWER(os_info) LIKE '%android%' THEN 'Android'
        WHEN LOWER(os_info) LIKE 'ios%' OR LOWER(os_info) LIKE '%ipados%'
          OR LOWER(os_info) LIKE '%iphone%' OR LOWER(os_info) LIKE '%ipad%' THEN 'iOS'
        WHEN LOWER(os_info) LIKE '%macos%' OR LOWER(os_info) LIKE '%mac os%'
          OR LOWER(os_info) LIKE '%darwin%' OR LOWER(os_info) LIKE '%osx%' THEN 'Apple'
        WHEN LOWER(os_info) LIKE '%linux%' OR LOWER(os_info) LIKE '%ubuntu%'
          OR LOWER(os_info) LIKE '%debian%' OR LOWER(os_info) LIKE '%centos%'
          OR LOWER(os_info) LIKE '%rhel%' OR LOWER(os_info) LIKE '%red hat%'
          OR LOWER(os_info) LIKE '%fedora%' OR LOWER(os_info) LIKE '%alpine%'
          OR LOWER(os_info) LIKE '%suse%' OR LOWER(os_info) LIKE '%arch%'
          OR LOWER(os_info) LIKE '%rocky%' OR LOWER(os_info) LIKE '%almalinux%' THEN 'Linux'
        ELSE 'Unknown'
      END
    ) VIRTUAL
  `;

  /**
   * Ricrea hosts per riapplicare la definizione GENERATED di os_family corrente.
   * Trigger: (a) os_family corrotta double-quote legacy (DROP COLUMN fallisce), oppure
   * (b) definizione obsoleta priva dei rami Android/iOS (aggiunti per il modulo MDM).
   */
  function rebuildHostsOsFamilyLegacy(): boolean {
    const hostsTableSql =
      (newDb.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='hosts'").get() as
        | { sql?: string }
        | undefined)?.sql ?? "";
    const isDoubleQuoteLegacy = hostsTableSql.includes('"Unknown"') || hostsTableSql.includes('"Windows"');
    const missingAndroidBranch = hostsTableSql.includes("os_family") && !hostsTableSql.includes("'Android'");
    if (!isDoubleQuoteLegacy && !missingAndroidBranch) {
      return false;
    }
    const colRows = newDb.prepare("PRAGMA table_info(hosts)").all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>;
    const dataCols = colRows.filter((c) => c.name !== "os_family");
    if (dataCols.length === 0) return false;

    const colDefs = dataCols
      .map((c) => {
        if (c.name === "id" && c.pk === 1) {
          return "id INTEGER PRIMARY KEY AUTOINCREMENT";
        }
        let sql = `"${c.name}" ${c.type || "TEXT"}`;
        if (c.notnull && c.pk !== 1) sql += " NOT NULL";
        return sql;
      })
      .join(", ");
    const selectList = dataCols.map((c) => `"${c.name}"`).join(", ");

    newDb.pragma("foreign_keys = OFF");
    newDb.exec(`CREATE TABLE hosts__os_fix (${colDefs}, UNIQUE(network_id, ip))`);
    newDb.exec(`INSERT INTO hosts__os_fix (${selectList}) SELECT ${selectList} FROM hosts`);
    newDb.exec("DROP TABLE hosts");
    newDb.exec("ALTER TABLE hosts__os_fix RENAME TO hosts");
    newDb.exec(`ALTER TABLE hosts ADD COLUMN os_family TEXT ${OS_FAMILY_GENERATED_SQL.trim()}`);
    newDb.pragma("foreign_keys = ON");
    return true;
  }

  try {
    // table_xinfo include anche le GENERATED VIRTUAL columns (table_info NO).
    const hostCols = newDb.prepare("PRAGMA table_xinfo(hosts)").all() as Array<{ name: string }>;
    if (hostCols.length > 0 && !hostCols.some((c) => c.name === "os_family")) {
      newDb.exec(`ALTER TABLE hosts ADD COLUMN os_family TEXT ${OS_FAMILY_GENERATED_SQL}`);
      console.info(`[db-tenant] ${tenantCode}: aggiunta hosts.os_family GENERATED`);
    } else if (hostCols.length > 0) {
      // v0.2.616: fix legacy DB con os_family che ha valori in DOUBLE QUOTES
      // (es. "Unknown" invece di 'Unknown'). SQLite stricter interpreta i double
      // quotes come column reference → ogni ALTER/DROP su qualsiasi tabella
      // triggera integrity check e fallisce con "no such column: \"\"".
      // Detect + ricreate con single quotes.
      const hostsTableSql = (newDb.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='hosts'").get() as { sql?: string } | undefined)?.sql ?? "";
      const isDoubleQuoteLegacy = hostsTableSql.includes('"Unknown"') || hostsTableSql.includes('"Windows"');
      const missingAndroidBranch = !hostsTableSql.includes("'Android'");
      if (isDoubleQuoteLegacy || missingAndroidBranch) {
        try {
          if (rebuildHostsOsFamilyLegacy()) {
            const reason = isDoubleQuoteLegacy ? "fix double-quote legacy" : "aggiunti rami Android/iOS";
            console.info(`[db-tenant] ${tenantCode}: hosts.os_family ricreata (${reason}, table rebuild)`);
          }
        } catch (e) {
          console.warn(`[db-tenant] ${tenantCode}: rebuild os_family fallito:`, e);
        }
      }
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione os_family fallita:`, e);
  }

  newDb.exec(TENANT_INDEXES_SQL);

  // Migrazione runtime: scheduled_jobs.job_type CHECK include 'fast_scan' (schedulazione per-subnet)
  // I tenant DB esistenti non hanno questo valore: rigeneriamo la tabella in-place.
  try {
    const row = newDb.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scheduled_jobs'").get() as { sql?: string } | undefined;
    if (row?.sql && !row.sql.includes("'fast_scan'")) {
      newDb.pragma("foreign_keys = OFF");
      newDb.exec("DROP TABLE IF EXISTS scheduled_jobs_v2");
      newDb.exec(`CREATE TABLE scheduled_jobs_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
        job_type TEXT NOT NULL CHECK(job_type IN ('ping_sweep', 'snmp_scan', 'nmap_scan', 'arp_poll', 'dns_resolve', 'fast_scan', 'cleanup', 'known_host_check', 'ad_sync', 'anomaly_check', 'librenms_sync')),
        interval_minutes INTEGER NOT NULL DEFAULT 60,
        last_run TEXT,
        next_run TEXT,
        enabled INTEGER DEFAULT 1,
        config TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`);
      newDb.exec("INSERT INTO scheduled_jobs_v2 SELECT * FROM scheduled_jobs");
      newDb.exec("DROP TABLE scheduled_jobs");
      newDb.exec("ALTER TABLE scheduled_jobs_v2 RENAME TO scheduled_jobs");
      newDb.pragma("foreign_keys = ON");
      console.info(`[db-tenant] ${tenantCode}: scheduled_jobs CHECK aggiornato con 'fast_scan'`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione fast_scan fallita:`, e);
  }

  // Migrazione runtime: scan_history.scan_type CHECK include 'fast' e 'ipam_full'.
  // Senza questi due valori il fast_scan crasha a metà (CHECK constraint failed)
  // e il flip-offline di Phase 4 non viene mai raggiunto → host fantasma.
  // v3 aggiunge i sub-step UI: scan_icmp, scan_nmap_base, scan_snmp_verify.
  // v4 aggiunge scan_naabu (ICMP → Naabu obbligatorio → Nmap -sV mirato).
  try {
    const row = newDb.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scan_history'").get() as { sql?: string } | undefined;
    const needsBase = row?.sql && (!row.sql.includes("'fast'") || !row.sql.includes("'ipam_full'"));
    const needsSubsteps = row?.sql && !row.sql.includes("'scan_nmap_base'");
    const needsNaabu = row?.sql && !row.sql.includes("'scan_naabu'");
    if (needsBase || needsSubsteps || needsNaabu) {
      newDb.pragma("foreign_keys = OFF");
      newDb.exec("DROP TABLE IF EXISTS scan_history_v4");
      newDb.exec(`CREATE TABLE scan_history_v4 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        host_id INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
        network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
        scan_type TEXT NOT NULL CHECK(scan_type IN ('ping', 'snmp', 'nmap', 'arp', 'dns', 'windows', 'ssh', 'network_discovery', 'credential_validate', 'fast', 'ipam_full', 'scan_icmp', 'scan_nmap_base', 'scan_snmp_verify', 'scan_naabu')),
        status TEXT NOT NULL,
        ports_open TEXT,
        raw_output TEXT,
        duration_ms INTEGER,
        timestamp TEXT DEFAULT (datetime('now'))
      )`);
      newDb.exec("INSERT INTO scan_history_v4 SELECT * FROM scan_history");
      newDb.exec("DROP TABLE scan_history");
      newDb.exec("ALTER TABLE scan_history_v4 RENAME TO scan_history");
      newDb.exec("CREATE INDEX IF NOT EXISTS idx_scan_history_host ON scan_history(host_id)");
      newDb.exec("CREATE INDEX IF NOT EXISTS idx_scan_history_network ON scan_history(network_id)");
      newDb.pragma("foreign_keys = ON");
      console.info(`[db-tenant] ${tenantCode}: scan_history CHECK aggiornato a v4 (+ scan_naabu)`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione scan_history CHECK fallita:`, e);
  }

  // Migrazione runtime: scan_history.scan_type CHECK include 'scan_enrich'.
  // v5 (fase 3b): la fase Enrich (ARP/DHCP/AD) ora scrive in scan_history (prima
  // non scriveva affatto → last_run sempre null nel pannello acquisizione UI).
  try {
    const row = newDb.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scan_history'").get() as { sql?: string } | undefined;
    const needsScanEnrich = row?.sql && !row.sql.includes("'scan_enrich'");
    if (needsScanEnrich) {
      newDb.pragma("foreign_keys = OFF");
      newDb.exec("DROP TABLE IF EXISTS scan_history_v5");
      newDb.exec(`CREATE TABLE scan_history_v5 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        host_id INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
        network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
        scan_type TEXT NOT NULL CHECK(scan_type IN ('ping', 'snmp', 'nmap', 'arp', 'dns', 'windows', 'ssh', 'network_discovery', 'credential_validate', 'fast', 'ipam_full', 'scan_icmp', 'scan_nmap_base', 'scan_snmp_verify', 'scan_naabu', 'scan_enrich')),
        status TEXT NOT NULL,
        ports_open TEXT,
        raw_output TEXT,
        duration_ms INTEGER,
        timestamp TEXT DEFAULT (datetime('now'))
      )`);
      newDb.exec("INSERT INTO scan_history_v5 SELECT * FROM scan_history");
      newDb.exec("DROP TABLE scan_history");
      newDb.exec("ALTER TABLE scan_history_v5 RENAME TO scan_history");
      newDb.exec("CREATE INDEX IF NOT EXISTS idx_scan_history_host ON scan_history(host_id)");
      newDb.exec("CREATE INDEX IF NOT EXISTS idx_scan_history_network ON scan_history(network_id)");
      newDb.pragma("foreign_keys = ON");
      console.info(`[db-tenant] ${tenantCode}: scan_history CHECK aggiornato a v5 (+ scan_enrich)`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione scan_history CHECK v5 fallita:`, e);
  }

  // Migrazione runtime: scheduled_jobs.job_type CHECK include 'vuln_sync' (sync findings da scanner-edge).
  try {
    const row = newDb.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scheduled_jobs'").get() as { sql?: string } | undefined;
    if (row?.sql && !row.sql.includes("'vuln_sync'")) {
      newDb.pragma("foreign_keys = OFF");
      newDb.exec("DROP TABLE IF EXISTS scheduled_jobs_v3");
      newDb.exec(`CREATE TABLE scheduled_jobs_v3 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
        job_type TEXT NOT NULL CHECK(job_type IN ('ping_sweep', 'snmp_scan', 'nmap_scan', 'arp_poll', 'dns_resolve', 'fast_scan', 'cleanup', 'known_host_check', 'ad_sync', 'anomaly_check', 'librenms_sync', 'vuln_sync')),
        interval_minutes INTEGER NOT NULL DEFAULT 60,
        last_run TEXT,
        next_run TEXT,
        enabled INTEGER DEFAULT 1,
        config TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`);
      newDb.exec("INSERT INTO scheduled_jobs_v3 SELECT * FROM scheduled_jobs");
      newDb.exec("DROP TABLE scheduled_jobs");
      newDb.exec("ALTER TABLE scheduled_jobs_v3 RENAME TO scheduled_jobs");
      newDb.pragma("foreign_keys = ON");
      console.info(`[db-tenant] ${tenantCode}: scheduled_jobs CHECK aggiornato con 'vuln_sync'`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione vuln_sync fallita:`, e);
  }

  // Migrazione runtime: scheduled_jobs.job_type CHECK include 'wazuh_sync'
  // (sync periodico agenti/syscollector/CVE da Wazuh Manager + indexer).
  try {
    const row = newDb.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scheduled_jobs'").get() as { sql?: string } | undefined;
    if (row?.sql && !row.sql.includes("'wazuh_sync'")) {
      newDb.pragma("foreign_keys = OFF");
      newDb.exec("DROP TABLE IF EXISTS scheduled_jobs_v4");
      newDb.exec(`CREATE TABLE scheduled_jobs_v4 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
        job_type TEXT NOT NULL CHECK(job_type IN ('ping_sweep', 'snmp_scan', 'nmap_scan', 'arp_poll', 'dns_resolve', 'fast_scan', 'cleanup', 'known_host_check', 'ad_sync', 'anomaly_check', 'librenms_sync', 'vuln_sync', 'wazuh_sync')),
        interval_minutes INTEGER NOT NULL DEFAULT 60,
        last_run TEXT,
        next_run TEXT,
        enabled INTEGER DEFAULT 1,
        config TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`);
      newDb.exec("INSERT INTO scheduled_jobs_v4 SELECT * FROM scheduled_jobs");
      newDb.exec("DROP TABLE scheduled_jobs");
      newDb.exec("ALTER TABLE scheduled_jobs_v4 RENAME TO scheduled_jobs");
      newDb.pragma("foreign_keys = ON");
      console.info(`[db-tenant] ${tenantCode}: scheduled_jobs CHECK aggiornato con 'wazuh_sync'`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione wazuh_sync fallita:`, e);
  }

  // Migrazione runtime: scheduled_jobs.job_type CHECK include 'mdm_sync'
  // (sync periodico device mobili da Headwind MDM).
  try {
    const row = newDb.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scheduled_jobs'").get() as { sql?: string } | undefined;
    if (row?.sql && !row.sql.includes("'mdm_sync'")) {
      newDb.pragma("foreign_keys = OFF");
      newDb.exec("DROP TABLE IF EXISTS scheduled_jobs_v5");
      newDb.exec(`CREATE TABLE scheduled_jobs_v5 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
        job_type TEXT NOT NULL CHECK(job_type IN ('ping_sweep', 'snmp_scan', 'nmap_scan', 'arp_poll', 'dns_resolve', 'fast_scan', 'cleanup', 'known_host_check', 'ad_sync', 'anomaly_check', 'librenms_sync', 'vuln_sync', 'wazuh_sync', 'mdm_sync')),
        interval_minutes INTEGER NOT NULL DEFAULT 60,
        last_run TEXT,
        next_run TEXT,
        enabled INTEGER DEFAULT 1,
        config TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`);
      newDb.exec("INSERT INTO scheduled_jobs_v5 SELECT * FROM scheduled_jobs");
      newDb.exec("DROP TABLE scheduled_jobs");
      newDb.exec("ALTER TABLE scheduled_jobs_v5 RENAME TO scheduled_jobs");
      newDb.pragma("foreign_keys = ON");
      console.info(`[db-tenant] ${tenantCode}: scheduled_jobs CHECK aggiornato con 'mdm_sync'`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione mdm_sync fallita:`, e);
  }

  // Migrazione runtime: scheduled_jobs.job_type CHECK include 'meshcentral_sync'
  // (sync periodico nodi/sessioni da MeshCentral RMM).
  try {
    const row = newDb.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scheduled_jobs'").get() as { sql?: string } | undefined;
    if (row?.sql && !row.sql.includes("'meshcentral_sync'")) {
      newDb.pragma("foreign_keys = OFF");
      newDb.exec("DROP TABLE IF EXISTS scheduled_jobs_v6");
      newDb.exec(`CREATE TABLE scheduled_jobs_v6 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
        job_type TEXT NOT NULL CHECK(job_type IN ('ping_sweep', 'snmp_scan', 'nmap_scan', 'arp_poll', 'dns_resolve', 'fast_scan', 'cleanup', 'known_host_check', 'ad_sync', 'anomaly_check', 'librenms_sync', 'vuln_sync', 'wazuh_sync', 'mdm_sync', 'meshcentral_sync')),
        interval_minutes INTEGER NOT NULL DEFAULT 60,
        last_run TEXT,
        next_run TEXT,
        enabled INTEGER DEFAULT 1,
        config TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`);
      newDb.exec("INSERT INTO scheduled_jobs_v6 SELECT * FROM scheduled_jobs");
      newDb.exec("DROP TABLE scheduled_jobs");
      newDb.exec("ALTER TABLE scheduled_jobs_v6 RENAME TO scheduled_jobs");
      newDb.pragma("foreign_keys = ON");
      console.info(`[db-tenant] ${tenantCode}: scheduled_jobs CHECK aggiornato con 'meshcentral_sync'`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione meshcentral_sync fallita:`, e);
  }

  // Migrazione runtime: scheduled_jobs.job_type CHECK include 'wazuh_alerts_sync'
  // (poll degli alert di sicurezza selezionati dall'indexer Wazuh).
  try {
    const row = newDb.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scheduled_jobs'").get() as { sql?: string } | undefined;
    if (row?.sql && !row.sql.includes("'wazuh_alerts_sync'")) {
      newDb.pragma("foreign_keys = OFF");
      newDb.exec("DROP TABLE IF EXISTS scheduled_jobs_v7");
      newDb.exec(`CREATE TABLE scheduled_jobs_v7 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        network_id INTEGER REFERENCES networks(id) ON DELETE CASCADE,
        job_type TEXT NOT NULL CHECK(job_type IN ('ping_sweep', 'snmp_scan', 'nmap_scan', 'arp_poll', 'dns_resolve', 'fast_scan', 'cleanup', 'known_host_check', 'ad_sync', 'anomaly_check', 'librenms_sync', 'vuln_sync', 'wazuh_sync', 'wazuh_alerts_sync', 'mdm_sync', 'meshcentral_sync')),
        interval_minutes INTEGER NOT NULL DEFAULT 60,
        last_run TEXT,
        next_run TEXT,
        enabled INTEGER DEFAULT 1,
        config TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`);
      newDb.exec("INSERT INTO scheduled_jobs_v7 SELECT * FROM scheduled_jobs");
      newDb.exec("DROP TABLE scheduled_jobs");
      newDb.exec("ALTER TABLE scheduled_jobs_v7 RENAME TO scheduled_jobs");
      newDb.pragma("foreign_keys = ON");
      console.info(`[db-tenant] ${tenantCode}: scheduled_jobs CHECK aggiornato con 'wazuh_alerts_sync'`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione wazuh_alerts_sync fallita:`, e);
  }

  // Migrazione runtime v8: scheduled_jobs.job_type CHECK include 'unifi_sync'
  // (sync del controller UniFi). CHECK dalla stessa costante dello schema.
  try {
    if (migrateScheduledJobsV8(newDb)) {
      console.info(`[db-tenant] ${tenantCode}: scheduled_jobs CHECK aggiornato con 'unifi_sync' (v8)`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione unifi_sync fallita:`, e);
  }

  // Migrazione runtime v9: scheduled_jobs.job_type CHECK include 'hypervisor_sync'
  // (lettura giornaliera degli hypervisor, topologia fase 2b). Dopo la v8.
  try {
    if (migrateScheduledJobsV9(newDb)) {
      console.info(`[db-tenant] ${tenantCode}: scheduled_jobs CHECK aggiornato con 'hypervisor_sync' (v9)`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione hypervisor_sync fallita:`, e);
  }

  // Migrazione runtime v10: scheduled_jobs.job_type CHECK include 'pulizia_host'
  // (pulizia notturna degli host assenti, piano 2026-10-20). Dopo la v9.
  try {
    if (migrateScheduledJobsV10(newDb)) {
      console.info(`[db-tenant] ${tenantCode}: scheduled_jobs CHECK aggiornato con 'pulizia_host' (v10)`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione pulizia_host fallita:`, e);
  }

  // Migrazione runtime v11: scheduled_jobs.job_type CHECK include 'apparati_scelti'
  // (scansione automatica dei device scelti in Discovery, piano 2026-10-22). Dopo la v10.
  // Se fallisce la tabella resta quella di prima (ROLLBACK) e il tenant si apre: i job
  // apparati_scelti non si possono creare finché la v11 non passa a un'apertura dopo.
  let v11Fallita: unknown;
  try {
    const t0 = Date.now();
    if (migrateScheduledJobsV11(newDb)) {
      console.info(`[db-tenant] ${tenantCode}: scheduled_jobs CHECK aggiornato con 'apparati_scelti' (v11, ${Date.now() - t0} ms)`);
    }
  } catch (e) {
    v11Fallita = e;
    console.error(`[db-tenant] ${tenantCode}: migrazione apparati_scelti (v11) fallita (ROLLBACK), scheduled_jobs invariata:`, e);
  }

  // Esiti dei job apparati_scelti (stesso piano): tabella e indice, solo se mancano, col segno. Se fallisce (o è fallita
  // la v11: i job apparati_scelti non si possono creare) il tenant si apre lo stesso e il segno dice l'errore; l'apertura
  // dopo riprova e, se passa, riscrive «done».
  try {
    if (v11Fallita !== undefined) throw v11Fallita;
    const added = migraApparatiScelti(newDb);
    if (added.length > 0) {
      console.info(`[db-tenant] ${tenantCode}: esiti dei job apparati_scelti, aggiunto ${added.join(", ")}`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione esiti apparati_scelti fallita (ROLLBACK):`, e);
    try {
      scriviSegno(newDb, SEGNO_APPARATI_SCELTI, segnoErrore(e));
    } catch (e2) {
      console.error(`[db-tenant] ${tenantCode}: ${SEGNO_APPARATI_SCELTI}, segno non scritto:`, e2);
    }
  }

  // Migrazione runtime: vuln_scanners.{cert_pin,cert_fingerprint} per
  // TOFU pinning HTTPS sull'edge. Additivo (ALTER ADD COLUMN).
  try {
    const tbl = newDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vuln_scanners'").get();
    if (tbl) {
      const cols = newDb.prepare("PRAGMA table_info(vuln_scanners)").all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === "cert_pin")) {
        newDb.exec("ALTER TABLE vuln_scanners ADD COLUMN cert_pin TEXT");
        console.info(`[db-tenant] ${tenantCode}: vuln_scanners.cert_pin aggiunto`);
      }
      if (!cols.some((c) => c.name === "cert_fingerprint")) {
        newDb.exec("ALTER TABLE vuln_scanners ADD COLUMN cert_fingerprint TEXT");
        console.info(`[db-tenant] ${tenantCode}: vuln_scanners.cert_fingerprint aggiunto`);
      }
      // v0.2.638 audit B7: auto-disable dopo K errori consecutivi.
      if (!cols.some((c) => c.name === "consecutive_errors")) {
        newDb.exec("ALTER TABLE vuln_scanners ADD COLUMN consecutive_errors INTEGER DEFAULT 0");
        console.info(`[db-tenant] ${tenantCode}: vuln_scanners.consecutive_errors aggiunto`);
      }
      if (!cols.some((c) => c.name === "auto_disabled_at")) {
        newDb.exec("ALTER TABLE vuln_scanners ADD COLUMN auto_disabled_at TEXT");
        console.info(`[db-tenant] ${tenantCode}: vuln_scanners.auto_disabled_at aggiunto`);
      }
    }
    // Migrazione: vuln_scan_runs.edge_scan_uid = UUID Greenbone (gvm_report_id).
    // `edge_scan_id` è l'autoincrement LOCALE dell'edge: se l'edge viene
    // ricostruito riparte da 1 e collide con lo storico → UNIQUE(scanner_id,
    // edge_scan_id) faceva scartare in silenzio gli scan nuovi e attribuiva i
    // findings a run vecchi (incident cliente A 2026-07). L'UUID è stabile e unico.
    const runsTbl = newDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vuln_scan_runs'").get();
    if (runsTbl) {
      const rcols = newDb.prepare("PRAGMA table_info(vuln_scan_runs)").all() as Array<{ name: string }>;
      if (!rcols.some((c) => c.name === "edge_scan_uid")) {
        newDb.exec("ALTER TABLE vuln_scan_runs ADD COLUMN edge_scan_uid TEXT");
        newDb.exec(
          "CREATE UNIQUE INDEX IF NOT EXISTS idx_vuln_scan_runs_uid ON vuln_scan_runs(scanner_id, edge_scan_uid) WHERE edge_scan_uid IS NOT NULL",
        );
        console.info(`[db-tenant] ${tenantCode}: vuln_scan_runs.edge_scan_uid aggiunto`);
      }
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione cert_pin fallita:`, e);
  }

  // v0.2.639 audit B8: la migration table-swap multihomed_links è stata
  // tentata ma fallisce in produzione per il bug noto hosts.os_family
  // GENERATED VIRTUAL con double-quote "Unknown"/"Windows"/... (vedi sopra,
  // riga ~140). SQLite stricter interpreta le double-quote come reference a
  // colonne inesistenti e fa abortire ogni ALTER su tabelle che hanno FK a
  // hosts. Rollback: la migration runtime è disabilitata, lo schema nuovo
  // (CHECK include 'physical_device') vale solo per nuovi tenant. Per i
  // tenant esistenti il writer continua a usare match_type='physical_device'
  // direttamente (era già coerente con il CHECK nuovo: lo è già lo schema
  // upstream), e i record legacy con 'serial_number:physical_device:N' vanno
  // bonificati via SQL manuale al boot del prossimo tenant nuovo. Piano: ADR-0004.

  // Migrazione runtime: network_devices.use_for_arp_poll (flag "Usa per polling ARP/MAC")
  // Permette di usare come sorgente ARP qualsiasi device (router, firewall, switch L3) indipendentemente dalla classification.
  try {
    const cols = newDb.prepare("PRAGMA table_info(network_devices)").all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "use_for_arp_poll")) {
      newDb.exec("ALTER TABLE network_devices ADD COLUMN use_for_arp_poll INTEGER NOT NULL DEFAULT 0");
      // Backfill: router e stormshield (logica storica di networkDeviceUsesArpPoll) → use_for_arp_poll=1
      newDb.exec("UPDATE network_devices SET use_for_arp_poll = 1 WHERE device_type = 'router' OR vendor = 'stormshield'");
      console.info(`[db-tenant] ${tenantCode}: network_devices.use_for_arp_poll aggiunto + backfill router/stormshield`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione use_for_arp_poll fallita:`, e);
  }

  // v0.2.659: aggiunto last_seen a ad_dhcp_leases + dhcp_leases per filtrare
  // relitti vecchi. Migration additiva (ALTER ADD COLUMN), idempotente.
  try {
    for (const table of ["ad_dhcp_leases", "dhcp_leases"]) {
      const cols = newDb.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (cols.length > 0 && !cols.some((c) => c.name === "last_seen")) {
        newDb.exec(`ALTER TABLE ${table} ADD COLUMN last_seen TEXT`);
        console.info(`[db-tenant] ${tenantCode}: ${table}.last_seen aggiunto`);
      }
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione last_seen DHCP fallita:`, e);
  }

  // Migrazione runtime: network_devices.device_type CHECK include 'firewall'
  try {
    const row = newDb.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='network_devices'").get() as { sql?: string } | undefined;
    if (row?.sql && !row.sql.includes("'firewall'") && row.sql.includes("device_type")) {
      newDb.pragma("foreign_keys = OFF");
      newDb.exec("DROP TABLE IF EXISTS network_devices_v2");
      // CREATE TABLE con nuovo CHECK (compresi firewall e use_for_arp_poll). Copiamo la definizione completa.
      // Le colonne non elencate qui si perdono; quelle della topologia fase 1 le aggiunge dopo migrateTopologyPhase1 (ADR 0008).
      newDb.exec(`CREATE TABLE network_devices_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        device_type TEXT NOT NULL CHECK(device_type IN ('router', 'switch', 'firewall', 'hypervisor')),
        vendor TEXT NOT NULL CHECK(vendor IN ('mikrotik', 'ubiquiti', 'hp', 'cisco', 'omada', 'stormshield', 'proxmox', 'vmware', 'linux', 'windows', 'synology', 'qnap', 'other')),
        vendor_subtype TEXT CHECK(vendor_subtype IN ('procurve', 'comware')),
        protocol TEXT NOT NULL CHECK(protocol IN ('ssh', 'snmp_v2', 'snmp_v3', 'api', 'winrm')),
        credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
        snmp_credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
        username TEXT,
        encrypted_password TEXT,
        community_string TEXT,
        api_token TEXT,
        api_url TEXT,
        port INTEGER DEFAULT 22,
        enabled INTEGER DEFAULT 1,
        classification TEXT,
        sysname TEXT,
        sysdescr TEXT,
        model TEXT,
        firmware TEXT,
        serial_number TEXT,
        part_number TEXT,
        last_info_update TEXT,
        last_device_info_json TEXT,
        stp_info TEXT,
        last_proxmox_scan_at TEXT,
        last_proxmox_scan_result TEXT,
        scan_target TEXT CHECK(scan_target IN ('proxmox', 'vmware', 'windows', 'linux')),
        product_profile TEXT,
        use_for_arp_poll INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`);
      // INSERT mantiene tutte le colonne esistenti (use_for_arp_poll esiste già dopo la migrazione precedente)
      const existingCols = (newDb.prepare("PRAGMA table_info(network_devices)").all() as Array<{ name: string }>).map((c) => c.name);
      const v2Cols = (newDb.prepare("PRAGMA table_info(network_devices_v2)").all() as Array<{ name: string }>).map((c) => c.name);
      const sharedCols = existingCols.filter((c) => v2Cols.includes(c));
      newDb.exec(`INSERT INTO network_devices_v2 (${sharedCols.join(", ")}) SELECT ${sharedCols.join(", ")} FROM network_devices`);
      newDb.exec("DROP TABLE network_devices");
      newDb.exec("ALTER TABLE network_devices_v2 RENAME TO network_devices");
      newDb.pragma("foreign_keys = ON");
      console.info(`[db-tenant] ${tenantCode}: network_devices CHECK device_type aggiornato con 'firewall'`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione device_type firewall fallita:`, e);
  }

  // Migrazione runtime: inventory_assets — colonne NIS2 Fase 3 (sync metadata da discovery)
  try {
    const cols3 = newDb.prepare("PRAGMA table_info(inventory_assets)").all() as Array<{ name: string }>;
    const colNames3 = new Set(cols3.map((c) => c.name));
    const f3 = [
      { sql: "auto_sync_discovery INTEGER DEFAULT 1", name: "auto_sync_discovery" },
      { sql: "last_sync_at TEXT", name: "last_sync_at" },
      { sql: "last_sync_source TEXT", name: "last_sync_source" },
    ];
    const added3: string[] = [];
    for (const c of f3) {
      if (!colNames3.has(c.name)) {
        newDb.exec(`ALTER TABLE inventory_assets ADD COLUMN ${c.sql}`);
        added3.push(c.name);
      }
    }
    if (added3.length > 0) {
      console.info(`[db-tenant] ${tenantCode}: inventory_assets +${added3.length} colonne NIS2 Fase 3 (${added3.join(", ")})`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione NIS2 Fase 3 fallita:`, e);
  }

  // Migrazione runtime: inventory_assets — colonne NIS2 Fase 2 (checklist protezione art. 21)
  try {
    const cols2 = newDb.prepare("PRAGMA table_info(inventory_assets)").all() as Array<{ name: string }>;
    const colNames2 = new Set(cols2.map((c) => c.name));
    const f2 = [
      { sql: "backup_configurato INTEGER DEFAULT 0", name: "backup_configurato" },
      { sql: "backup_ultimo_test TEXT", name: "backup_ultimo_test" },
      { sql: "patching_automatico INTEGER DEFAULT 0", name: "patching_automatico" },
      { sql: "mfa_admin INTEGER DEFAULT 0", name: "mfa_admin" },
      { sql: "log_centralizzati INTEGER DEFAULT 0", name: "log_centralizzati" },
      { sql: "hardening_baseline INTEGER DEFAULT 0", name: "hardening_baseline" },
      { sql: "dr_plan_documentato INTEGER DEFAULT 0", name: "dr_plan_documentato" },
      { sql: "incident_response_documentata INTEGER DEFAULT 0", name: "incident_response_documentata" },
    ];
    const added2: string[] = [];
    for (const c of f2) {
      if (!colNames2.has(c.name)) {
        newDb.exec(`ALTER TABLE inventory_assets ADD COLUMN ${c.sql}`);
        added2.push(c.name);
      }
    }
    if (added2.length > 0) {
      console.info(`[db-tenant] ${tenantCode}: inventory_assets +${added2.length} colonne NIS2 Fase 2 (${added2.join(", ")})`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione NIS2 Fase 2 fallita:`, e);
  }

  // Migrazione runtime: inventory_assets — colonne NIS2 Fase 1
  // categoria_nis2, business/technical owner, criticita_nis2, dati_trattati, supporto_rimovibile, data_review_nis2
  try {
    const cols = newDb.prepare("PRAGMA table_info(inventory_assets)").all() as Array<{ name: string }>;
    const colNames = new Set(cols.map((c) => c.name));
    const addCol = (sqlFrag: string, name: string) => {
      if (!colNames.has(name)) {
        newDb.exec(`ALTER TABLE inventory_assets ADD COLUMN ${sqlFrag}`);
      }
    };
    addCol("categoria_nis2 TEXT", "categoria_nis2");
    addCol("business_owner_id INTEGER REFERENCES asset_assignees(id) ON DELETE SET NULL", "business_owner_id");
    addCol("technical_owner_id INTEGER REFERENCES asset_assignees(id) ON DELETE SET NULL", "technical_owner_id");
    addCol("criticita_nis2 TEXT", "criticita_nis2");
    addCol("dati_trattati TEXT", "dati_trattati");
    addCol("supporto_rimovibile INTEGER DEFAULT 0", "supporto_rimovibile");
    addCol("data_review_nis2 TEXT", "data_review_nis2");
    if (colNames.size !== cols.length || cols.length === 0) {
      // no-op: solo a scopo di soppressione linter
    }
    const added = ["categoria_nis2", "business_owner_id", "technical_owner_id", "criticita_nis2", "dati_trattati", "supporto_rimovibile", "data_review_nis2"].filter((n) => !colNames.has(n));
    if (added.length > 0) {
      console.info(`[db-tenant] ${tenantCode}: inventory_assets +${added.length} colonne NIS2 Fase 1 (${added.join(", ")})`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione NIS2 Fase 1 fallita:`, e);
  }

  // Migrazione runtime: multihomed_links.is_primary (flag scan-dedup).
  // Per ogni gruppo multihomed un solo host è "primary" e riceve gli scan
  // costosi (SNMP/test cred/software inventory). Vedi recomputeMultihomedLinks().
  try {
    const tbl = newDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='multihomed_links'").get();
    if (tbl) {
      const cols = newDb.prepare("PRAGMA table_info(multihomed_links)").all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === "is_primary")) {
        newDb.exec("ALTER TABLE multihomed_links ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0");
        console.info(`[db-tenant] ${tenantCode}: multihomed_links.is_primary aggiunto (verrà popolato al prossimo recomputeMultihomedLinks)`);
      }
      // v0.2.617: il CHECK constraint di multihomed_links accetta solo 4 valori
      // (serial_number/sysname/hostname/ad_dns) e non può essere esteso perché
      // ogni DROP/ALTER su hosts fallisce per via di un legacy bug sulla
      // GENERATED column os_family (double-quoted strings). Workaround:
      // recomputeMultihomedLinks usa match_type='serial_number' anche per il
      // bucket physical, con match_value che inizia per 'physical_device:' come
      // marker — passa il CHECK e mantiene la semantica.
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione multihomed_links.is_primary fallita:`, e);
  }

  // Migrazione runtime: physical_devices + device_interfaces + device_interface_addresses
  // (aggregazione device cross-subnet, vedi docs/adr/0002 se presente).
  // Le tabelle sono createIfNotExists dentro TENANT_SCHEMA_SQL ma su DB esistenti
  // serve anche aggiungere le FK su network_devices.physical_device_id e
  // hosts.physical_device_id + hosts.host_source.
  try {
    newDb.exec(`
      CREATE TABLE IF NOT EXISTS physical_devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vendor TEXT,
        model TEXT,
        serial_number TEXT,
        primary_mac TEXT,
        sys_object_id TEXT,
        sysname TEXT,
        manufacturer TEXT,
        identity_confidence INTEGER NOT NULL DEFAULT 0,
        identity_anchor TEXT,
        first_seen TEXT DEFAULT (datetime('now')),
        last_seen TEXT DEFAULT (datetime('now')),
        notes TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_physical_devices_serial ON physical_devices(serial_number) WHERE serial_number IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_physical_devices_mac ON physical_devices(primary_mac) WHERE primary_mac IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_physical_devices_sysname ON physical_devices(sysname) WHERE sysname IS NOT NULL;

      CREATE TABLE IF NOT EXISTS device_interfaces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        physical_device_id INTEGER NOT NULL REFERENCES physical_devices(id) ON DELETE CASCADE,
        ifname TEXT NOT NULL,
        ifindex INTEGER,
        mac TEXT,
        status TEXT CHECK(status IN ('up','down','unknown')) DEFAULT 'unknown',
        speed_mbps INTEGER,
        type TEXT,
        is_virtual_mac INTEGER NOT NULL DEFAULT 0,
        alias TEXT,
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(physical_device_id, ifname)
      );
      CREATE INDEX IF NOT EXISTS idx_device_interfaces_device ON device_interfaces(physical_device_id);
      CREATE INDEX IF NOT EXISTS idx_device_interfaces_mac ON device_interfaces(mac) WHERE mac IS NOT NULL;

      CREATE TABLE IF NOT EXISTS device_interface_addresses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        interface_id INTEGER NOT NULL REFERENCES device_interfaces(id) ON DELETE CASCADE,
        ip TEXT NOT NULL,
        prefix INTEGER,
        family INTEGER NOT NULL DEFAULT 4 CHECK(family IN (4,6)),
        scope TEXT CHECK(scope IN ('global','link','host','unknown')) DEFAULT 'global',
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(interface_id, ip)
      );
      CREATE INDEX IF NOT EXISTS idx_device_interface_addresses_iface ON device_interface_addresses(interface_id);
      CREATE INDEX IF NOT EXISTS idx_device_interface_addresses_ip ON device_interface_addresses(ip);
    `);

    const ndCols = newDb.prepare("PRAGMA table_info(network_devices)").all() as Array<{ name: string }>;
    if (!ndCols.some((c) => c.name === "physical_device_id")) {
      newDb.exec("ALTER TABLE network_devices ADD COLUMN physical_device_id INTEGER REFERENCES physical_devices(id) ON DELETE SET NULL");
      console.info(`[db-tenant] ${tenantCode}: network_devices.physical_device_id aggiunto`);
    }
    // F4 (v0.2.595+): FK formale network_devices.host_id → hosts(id).
    // Prima il join host↔device era solo per IP string (network_devices.host = hosts.ip):
    // fragile e ambiguo se più reti hanno lo stesso IP. Ora abbiamo una vera
    // relazione, con ON DELETE SET NULL (il device sopravvive se l'host viene
    // rimosso dal discovery, ma perde l'ancora).
    if (!ndCols.some((c) => c.name === "host_id")) {
      newDb.exec("ALTER TABLE network_devices ADD COLUMN host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL");
      newDb.exec("CREATE INDEX IF NOT EXISTS idx_network_devices_host_id ON network_devices(host_id)");
      // Backfill best-effort in 2 passi:
      //   1) match diretto su IP letterale (network_devices.host = hosts.ip)
      //   2) match su IP estratto da host URL/host:port (es. Proxmox "https://1.2.3.4:8006")
      //      usando SQLite REGEX semplificata via SUBSTR + INSTR.
      try {
        const phase1 = newDb.prepare(`
          UPDATE network_devices SET host_id = (
            SELECT h.id FROM hosts h WHERE h.ip = network_devices.host LIMIT 1
          ) WHERE host_id IS NULL
        `).run();

        // Per URL/host:port serve estrarre l'IP. SQLite non ha REGEXP built-in,
        // ma possiamo usare SUBSTR + INSTR per i pattern comuni: "scheme://IP[:port]"
        // o "IP:port". Faccio passi separati per ognuno dei pattern.
        let phase2Changes = 0;
        // Pattern A: "https://IP:port" o "http://IP:port" o "https://IP/path"
        const phase2a = newDb.prepare(`
          UPDATE network_devices SET host_id = (
            SELECT h.id FROM hosts h
             WHERE host LIKE 'http%://' || h.ip || ':%'
                OR host LIKE 'http%://' || h.ip || '/%'
                OR host LIKE 'http%://' || h.ip
             LIMIT 1
          ) WHERE host_id IS NULL AND host LIKE 'http%://%'
        `).run();
        phase2Changes += phase2a.changes;
        // Pattern B: "IP:port" senza scheme
        const phase2b = newDb.prepare(`
          UPDATE network_devices SET host_id = (
            SELECT h.id FROM hosts h
             WHERE host LIKE h.ip || ':%'
             LIMIT 1
          ) WHERE host_id IS NULL AND host LIKE '%:%' AND host NOT LIKE 'http%'
        `).run();
        phase2Changes += phase2b.changes;

        const total = phase1.changes + phase2Changes;
        console.info(`[db-tenant] ${tenantCode}: network_devices.host_id aggiunto (backfill: ${phase1.changes} direct + ${phase2Changes} URL/port = ${total} righe collegate)`);
      } catch (e) {
        console.warn(`[db-tenant] ${tenantCode}: backfill host_id fallito:`, e);
      }
    }
    const hCols = newDb.prepare("PRAGMA table_info(hosts)").all() as Array<{ name: string }>;
    if (!hCols.some((c) => c.name === "physical_device_id")) {
      newDb.exec("ALTER TABLE hosts ADD COLUMN physical_device_id INTEGER REFERENCES physical_devices(id) ON DELETE SET NULL");
      console.info(`[db-tenant] ${tenantCode}: hosts.physical_device_id aggiunto`);
    }
    if (!hCols.some((c) => c.name === "host_source")) {
      newDb.exec("ALTER TABLE hosts ADD COLUMN host_source TEXT DEFAULT 'scan'");
      console.info(`[db-tenant] ${tenantCode}: hosts.host_source aggiunto`);
    }
    // F1 (v0.2.590+): auto-classify server-side alla discovery.
    // Suggerimenti calcolati da OUI/hostname/open_ports/snmp_data; usati dal modale
    // di promozione come default editabili. classification_manual=1 li ignora.
    const inferredCols: Array<{ name: string; sql: string }> = [
      { name: "inferred_device_type", sql: "ALTER TABLE hosts ADD COLUMN inferred_device_type TEXT" },
      { name: "inferred_vendor",      sql: "ALTER TABLE hosts ADD COLUMN inferred_vendor TEXT" },
      { name: "inferred_protocol",    sql: "ALTER TABLE hosts ADD COLUMN inferred_protocol TEXT" },
      { name: "inferred_scan_target", sql: "ALTER TABLE hosts ADD COLUMN inferred_scan_target TEXT" },
      { name: "inferred_os_family",   sql: "ALTER TABLE hosts ADD COLUMN inferred_os_family TEXT" },
      { name: "inferred_confidence",  sql: "ALTER TABLE hosts ADD COLUMN inferred_confidence INTEGER" },
      { name: "inferred_reasons",     sql: "ALTER TABLE hosts ADD COLUMN inferred_reasons TEXT" },
      { name: "inferred_at",          sql: "ALTER TABLE hosts ADD COLUMN inferred_at TEXT" },
      // v0.2.602: versione classifier per ricomputo automatico quando le regole cambiano.
      { name: "inferred_classifier_version", sql: "ALTER TABLE hosts ADD COLUMN inferred_classifier_version INTEGER" },
      // Classification-engine summary (confidence = inferred_confidence, no duplicate column).
      { name: "classification_reason", sql: "ALTER TABLE hosts ADD COLUMN classification_reason TEXT" },
      { name: "classification_json", sql: "ALTER TABLE hosts ADD COLUMN classification_json TEXT" },
    ];
    for (const col of inferredCols) {
      if (!hCols.some((c) => c.name === col.name)) {
        newDb.exec(col.sql);
        console.info(`[db-tenant] ${tenantCode}: hosts.${col.name} aggiunto`);
      }
    }
    // Attribution v2 fase 1 — colonne risultato fusione (spec §5)
    const attrCols: Array<{ name: string; sql: string }> = [
      { name: "attr_vendor", sql: "ALTER TABLE hosts ADD COLUMN attr_vendor TEXT" },
      { name: "attr_vendor_name", sql: "ALTER TABLE hosts ADD COLUMN attr_vendor_name TEXT" },
      { name: "attr_category", sql: "ALTER TABLE hosts ADD COLUMN attr_category TEXT" },
      { name: "attr_os_family", sql: "ALTER TABLE hosts ADD COLUMN attr_os_family TEXT" },
      { name: "attr_os_name", sql: "ALTER TABLE hosts ADD COLUMN attr_os_name TEXT" },
      { name: "attr_confidence_vendor", sql: "ALTER TABLE hosts ADD COLUMN attr_confidence_vendor INTEGER" },
      { name: "attr_confidence_category", sql: "ALTER TABLE hosts ADD COLUMN attr_confidence_category INTEGER" },
      { name: "attr_confidence_os", sql: "ALTER TABLE hosts ADD COLUMN attr_confidence_os INTEGER" },
      { name: "attr_min_phase", sql: "ALTER TABLE hosts ADD COLUMN attr_min_phase TEXT" },
      { name: "attr_at", sql: "ALTER TABLE hosts ADD COLUMN attr_at TEXT" },
      { name: "attr_engine_version", sql: "ALTER TABLE hosts ADD COLUMN attr_engine_version TEXT" },
    ];
    for (const col of attrCols) {
      if (!hCols.some((c) => c.name === col.name)) {
        newDb.exec(col.sql);
        console.info(`[db-tenant] ${tenantCode}: hosts.${col.name} aggiunto`);
      }
    }
    // Tabella evidenze per DB creati prima di questa versione
    newDb.exec(`CREATE TABLE IF NOT EXISTS attribution_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      phase TEXT NOT NULL,
      dimension TEXT NOT NULL CHECK(dimension IN ('vendor','category','os')),
      claim TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      weight REAL NOT NULL DEFAULT 0,
      raw_value TEXT,
      observed_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT,
      superseded_by INTEGER REFERENCES attribution_evidence(id) ON DELETE SET NULL
    )`);
    newDb.exec("CREATE INDEX IF NOT EXISTS idx_attr_evidence_host ON attribution_evidence(host_id, dimension)");
    newDb.exec("CREATE INDEX IF NOT EXISTS idx_attr_evidence_active ON attribution_evidence(host_id, superseded_by) WHERE superseded_by IS NULL");

    // Fase 4b Task 2 — colonne SNMPv3 completo su credentials (§7.1): niente
    // CHECK sui protocolli (validati in TS da buildV3Options), idempotente
    // come il pattern attrCols sopra. Tappa 1 credenziali (15/10): `port`,
    // NULL = porta standard del protocollo. Tappa 2c (T11): metodo d'accesso
    // (NULL = il primo del tipo, tipi.ts) e chiave SSH con la sua passphrase.
    // Qui, prima della ricostruzione senza CHECK in fondo a getTenantDb: un
    // DEFAULT con lo schema vecchio arriva senza `port`.
    const credCols = newDb.prepare("PRAGMA table_info(credentials)").all() as Array<{ name: string }>;
    const credColsNuove: Array<{ name: string; sql: string }> = [
      { name: "encrypted_auth_key", sql: "ALTER TABLE credentials ADD COLUMN encrypted_auth_key TEXT" },
      { name: "auth_protocol", sql: "ALTER TABLE credentials ADD COLUMN auth_protocol TEXT" },
      { name: "encrypted_priv_key", sql: "ALTER TABLE credentials ADD COLUMN encrypted_priv_key TEXT" },
      { name: "priv_protocol", sql: "ALTER TABLE credentials ADD COLUMN priv_protocol TEXT" },
      { name: "security_level", sql: "ALTER TABLE credentials ADD COLUMN security_level TEXT" },
      { name: "port", sql: "ALTER TABLE credentials ADD COLUMN port INTEGER" },
      { name: "auth_method", sql: "ALTER TABLE credentials ADD COLUMN auth_method TEXT" },
      { name: "encrypted_private_key", sql: "ALTER TABLE credentials ADD COLUMN encrypted_private_key TEXT" },
      { name: "encrypted_key_passphrase", sql: "ALTER TABLE credentials ADD COLUMN encrypted_key_passphrase TEXT" },
    ];
    for (const col of credColsNuove) {
      if (!credCols.some((c) => c.name === col.name)) {
        newDb.exec(col.sql);
        console.info(`[db-tenant] ${tenantCode}: credentials.${col.name} aggiunto`);
      }
    }

    // Fase 1b credenziali — stato fallimenti su host_credentials (resolver unico, §7.5)
    const hostCredCols = newDb.prepare("PRAGMA table_info(host_credentials)").all() as Array<{ name: string }>;
    const hostCredNewCols: Array<{ name: string; sql: string }> = [
      { name: "fail_count", sql: "ALTER TABLE host_credentials ADD COLUMN fail_count INTEGER NOT NULL DEFAULT 0" },
      { name: "last_error", sql: "ALTER TABLE host_credentials ADD COLUMN last_error TEXT" },
      { name: "last_attempt_at", sql: "ALTER TABLE host_credentials ADD COLUMN last_attempt_at TEXT" },
      { name: "backoff_until", sql: "ALTER TABLE host_credentials ADD COLUMN backoff_until TEXT" },
    ];
    for (const col of hostCredNewCols) {
      if (!hostCredCols.some((c) => c.name === col.name)) {
        newDb.exec(col.sql);
        console.info(`[db-tenant] ${tenantCode}: host_credentials.${col.name} aggiunto`);
      }
    }
    // History estesa alle 3 dimensioni (il CHECK su trigger resta invariato — decisione 8 del piano)
    const histCols = newDb.prepare("PRAGMA table_info(host_classification_history)").all() as Array<{ name: string }>;
    for (const c of ["attr_vendor", "attr_category", "attr_os"]) {
      if (!histCols.some((x) => x.name === c)) {
        newDb.exec(`ALTER TABLE host_classification_history ADD COLUMN ${c} TEXT`);
      }
    }
    // History decisioni classificazione (CREATE IF NOT EXISTS → idempotente su DB esistenti).
    newDb.exec(`
      CREATE TABLE IF NOT EXISTS host_classification_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
        at TEXT NOT NULL DEFAULT (datetime('now')),
        classification TEXT,
        confidence INTEGER NOT NULL DEFAULT 0,
        reason TEXT,
        evidence_json TEXT,
        conflicts_json TEXT,
        trigger TEXT NOT NULL CHECK(trigger IN ('scan','apply','manual','backfill'))
      );
      CREATE INDEX IF NOT EXISTS idx_host_class_hist_host ON host_classification_history(host_id, at DESC);
    `);
    // Migrazione: estendi il CHECK device_type con access_point/nas/server.
    // SQLite non consente ALTER di un CHECK → ricostruzione tabella (stesso idiom
    // di network_devices_hypervisor_new). Idempotente: il probe INSERT/DELETE
    // fallisce solo finché il CHECK vecchio è in vigore.
    try {
      newDb.prepare(
        "INSERT INTO network_devices (name, host, device_type, vendor, protocol) VALUES ('__probe__', '0.0.0.0', 'access_point', 'other', 'ssh')"
      ).run();
      newDb.prepare("DELETE FROM network_devices WHERE name = '__probe__'").run();
    } catch {
      newDb.pragma("foreign_keys = OFF");
      newDb.transaction(() => {
        // FK verso physical_devices solo se la tabella esiste (tenant molto vecchi
        // possono non averla ancora al momento di questo rebuild).
        const hasPhysicalDevices = Boolean(
          newDb.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='physical_devices'").get()
        );
        const physicalDeviceCol = hasPhysicalDevices
          ? "physical_device_id INTEGER REFERENCES physical_devices(id) ON DELETE SET NULL,"
          : "physical_device_id INTEGER,";
        // Le colonne non elencate qui si perdono; quelle della topologia fase 1 le aggiunge dopo migrateTopologyPhase1 (ADR 0008).
        newDb.exec(`CREATE TABLE network_devices__ap_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          host TEXT NOT NULL,
          device_type TEXT NOT NULL CHECK(device_type IN ('router', 'switch', 'firewall', 'hypervisor', 'access_point', 'nas', 'server')),
          vendor TEXT NOT NULL CHECK(vendor IN ('mikrotik', 'ubiquiti', 'hp', 'cisco', 'omada', 'stormshield', 'proxmox', 'vmware', 'linux', 'windows', 'synology', 'qnap', 'other')),
          vendor_subtype TEXT CHECK(vendor_subtype IN ('procurve', 'comware')),
          protocol TEXT NOT NULL CHECK(protocol IN ('ssh', 'snmp_v2', 'snmp_v3', 'api', 'winrm')),
          credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
          snmp_credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
          username TEXT, encrypted_password TEXT, community_string TEXT, api_token TEXT, api_url TEXT,
          port INTEGER DEFAULT 22, enabled INTEGER DEFAULT 1, classification TEXT,
          sysname TEXT, sysdescr TEXT, model TEXT, firmware TEXT, serial_number TEXT, part_number TEXT,
          last_info_update TEXT, last_device_info_json TEXT, stp_info TEXT,
          last_proxmox_scan_at TEXT, last_proxmox_scan_result TEXT,
          scan_target TEXT CHECK(scan_target IN ('proxmox', 'vmware', 'windows', 'linux')),
          product_profile TEXT,
          use_for_arp_poll INTEGER NOT NULL DEFAULT 0,
          host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
          ${physicalDeviceCol}
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )`);
        const srcCols = (newDb.prepare("PRAGMA table_info(network_devices)").all() as Array<{ name: string }>)
          .map((r) => r.name);
        const dstCols = new Set(
          (newDb.prepare("PRAGMA table_info(network_devices__ap_new)").all() as Array<{ name: string }>)
            .map((r) => r.name)
        );
        const common = srcCols.filter((c) => dstCols.has(c)).join(", ");
        newDb.exec(`INSERT INTO network_devices__ap_new (${common}) SELECT ${common} FROM network_devices`);
        newDb.exec("DROP TABLE network_devices");
        newDb.exec("ALTER TABLE network_devices__ap_new RENAME TO network_devices");
        newDb.exec(`
          CREATE INDEX IF NOT EXISTS idx_network_devices_credential ON network_devices(credential_id);
          CREATE INDEX IF NOT EXISTS idx_network_devices_host ON network_devices(host);
          CREATE INDEX IF NOT EXISTS idx_network_devices_device_type ON network_devices(device_type);
          CREATE INDEX IF NOT EXISTS idx_network_devices_product_profile ON network_devices(product_profile);
          CREATE INDEX IF NOT EXISTS idx_network_devices_classification ON network_devices(classification);
          CREATE INDEX IF NOT EXISTS idx_network_devices_physical_device_id ON network_devices(physical_device_id);
          CREATE INDEX IF NOT EXISTS idx_network_devices_host_id ON network_devices(host_id);
        `);
      })();
      newDb.pragma("foreign_keys = ON");
      console.info(`[db-tenant] ${tenantCode}: network_devices.device_type esteso (access_point/nas/server)`);
    }
    // Fase 4 (ritiro legacy, 2026-07-28): il backfill auto-classify al boot
    // tenant è stato rimosso — era lavoro inutile ad ogni avvio (v0.2.641
    // l'aveva già reso 1 fsync/tenant, ma resta comunque un giro completo
    // della tabella hosts ad ogni boot). Le colonne inferred_*/classification
    // sono ora una proiezione dell'attribution v2 (vedi
    // src/lib/attribution/legacy-projection.ts + persist.ts), scritta quando
    // la fusione ricomputa un host — nessun backfill dedicato necessario.
    // v0.2.610: bridge multihomed. Identity-resolver automatico (anchor=serial_number/
    // primary_mac) ha popolato hosts.physical_device_id, ma `recomputeMultihomedLinks`
    // non era chiamato in quel path → tabella multihomed_links vuota nonostante
    // i cluster esistano. Detect del mismatch e ricomputo idempotente.
    try {
      const orphan = newDb.prepare(
        `SELECT COUNT(*) AS n FROM hosts h
         WHERE h.physical_device_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM multihomed_links ml WHERE ml.host_id = h.id)`
      ).get() as { n: number };
      if (orphan.n > 0) {
        // recomputeMultihomedLinks è definita più sotto nello stesso modulo:
        // chiamata sicura via re-import (evita circular initialization issue in
        // SQL builder). Idempotente.
        const result = recomputeMultihomedLinks(newDb);
        console.info(`[db-tenant] ${tenantCode}: multihomed bridge — ${orphan.n} host orphan → ricomputati ${result.groups} gruppi, ${result.hosts_linked} link`);
      }
    } catch (e) {
      console.warn(`[db-tenant] ${tenantCode}: bridge multihomed fallito:`, e);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione physical_devices fallita:`, e);
  }

  // Tappa 2f credenziali (T22): controller e AD puntano una voce d'archivio.
  // Un ADD COLUMN con REFERENCES e default NULL è ammesso con le chiavi esterne
  // attive. A sé, fuori dal blocco qui sopra: se fallisce, la conversione in
  // fondo lo dice col segno errore: e si riprova all'apertura dopo.
  try {
    for (const tabella of ["network_controllers", "ad_integrations"]) {
      const cols = newDb.prepare(`PRAGMA table_info(${tabella})`).all() as Array<{ name: string }>;
      if (cols.length > 0 && !cols.some((c) => c.name === "credential_id")) {
        newDb.exec(`ALTER TABLE ${tabella} ADD COLUMN credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL`);
        console.info(`[db-tenant] ${tenantCode}: ${tabella}.credential_id aggiunto`);
      }
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: colonne credential_id di controller e AD (2f) non aggiunte:`, e);
  }

  // v0.2.651: cleanup one-shot mac_port_entries all'apertura del DB tenant.
  // Topologia fase 2 (spec §10.5): la soglia è la stessa del job cleanup
  // (30 giorni), non più 24 ore — con le 24 ore ogni riavvio, o ogni riapertura
  // dopo l'uscita dalla LRU, cancellava il «visto l'ultima volta».
  try {
    const r = newDb.prepare(
      "DELETE FROM mac_port_entries WHERE timestamp < datetime('now', '-' || ? || ' days')"
    ).run(MAC_PORT_RETENTION_DAYS) as { changes: number };
    if (r.changes > 0) {
      console.info(`[db-tenant] ${tenantCode}: mac_port_entries one-shot cleanup — ${r.changes} righe rimosse`);
    }
  } catch (e) {
    console.warn(`[db-tenant] ${tenantCode}: mac_port_entries cleanup fallito:`, e);
  }

  // v0.2.652: recovery patch_operations stuck. Se ci sono job con status='queued'
  // o 'running' all'apertura del DB, vuol dire che il process Node è stato
  // riavviato durante la loro esecuzione → la Promise fire-and-forget è morta
  // con il process e nessuno li riprenderà. Marchiamoli failed con messaggio
  // chiaro così la UI sblocca e l'utente può ricreare l'operazione.
  // Skip se patch management non è abilitato per il tenant (tabella non creata).
  try {
    const hasTable = newDb.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='patch_operations'"
    ).get();
    if (hasTable) {
      const r = newDb.prepare(
        `UPDATE patch_operations
         SET status = 'failed',
             finished_at = datetime('now'),
             error_message = COALESCE(error_message, '') ||
               CASE WHEN error_message IS NULL OR error_message = ''
                    THEN 'Service restart durante esecuzione: job non ripreso al riavvio. Ricrea l''operazione.'
                    ELSE '' END
         WHERE status IN ('queued', 'running')
           AND (started_at IS NULL OR
                substr(replace(replace(started_at,'T',' '),'Z',''),1,19) < datetime('now', '-10 minutes'))`
      ).run() as { changes: number };
      if (r.changes > 0) {
        console.info(`[db-tenant] ${tenantCode}: patch_operations recovery — ${r.changes} job orfani segnati failed`);
      }
    }
  } catch (e) {
    console.warn(`[db-tenant] ${tenantCode}: patch_operations recovery fallito:`, e);
  }

  // Watchdog software_scans (fix R3 2026-06-23): come patch_operations, uno scan
  // software interrotto da un restart del processo restava 'running' per sempre
  // (nessun try/finally nel runner) → UI in-progress perenne, re-scan bloccato.
  try {
    const hasTable = newDb.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='software_scans'"
    ).get();
    if (hasTable) {
      // NB: il CHECK di software_scans.status ammette solo
      // running/ok/error/timeout/cancelled → usiamo 'error' (non 'failed').
      const r = newDb.prepare(
        `UPDATE software_scans
         SET status = 'error',
             finished_at = datetime('now')
         WHERE status = 'running'
           AND substr(replace(replace(started_at,'T',' '),'Z',''),1,19) < datetime('now', '-10 minutes')`
      ).run() as { changes: number };
      if (r.changes > 0) {
        console.info(`[db-tenant] ${tenantCode}: software_scans recovery — ${r.changes} scan orfani segnati failed`);
      }
    }
  } catch (e) {
    console.warn(`[db-tenant] ${tenantCode}: software_scans recovery fallito:`, e);
  }

  // v0.2.694: networks.targeting_mode — colonna additiva per persistere la
  // modalità targeting VA per subnet (full_subnet / found_ips / populated_24).
  try {
    const netCols = newDb.prepare("PRAGMA table_info(networks)").all() as Array<{ name: string }>;
    if (netCols.length > 0 && !netCols.some((c) => c.name === "targeting_mode")) {
      newDb.exec("ALTER TABLE networks ADD COLUMN targeting_mode TEXT DEFAULT 'full_subnet'");
      console.info(`[db-tenant] ${tenantCode}: aggiunta networks.targeting_mode`);
    }
  } catch (e) {
    console.warn(`[db-tenant] ${tenantCode}: migrazione networks.targeting_mode fallita:`, e);
  }

  // Assessment IPAM-driven (2026-07-21): post-scan moduli sull'edge.
  try {
    const netCols = newDb.prepare("PRAGMA table_info(networks)").all() as Array<{ name: string }>;
    const names = new Set(netCols.map((c) => c.name));
    if (names.size > 0 && !names.has("assessment_enabled")) {
      newDb.exec("ALTER TABLE networks ADD COLUMN assessment_enabled INTEGER NOT NULL DEFAULT 0");
      console.info(`[db-tenant] ${tenantCode}: aggiunta networks.assessment_enabled`);
    }
    if (names.size > 0 && !names.has("assessment_profile_id")) {
      newDb.exec("ALTER TABLE networks ADD COLUMN assessment_profile_id TEXT");
      console.info(`[db-tenant] ${tenantCode}: aggiunta networks.assessment_profile_id`);
    }
  } catch (e) {
    console.warn(`[db-tenant] ${tenantCode}: migrazione networks.assessment_* fallita:`, e);
  }

  // Attribution v2 fase 3 — override per rete del gating probe passivi (default ON).
  try {
    const netCols = newDb.prepare("PRAGMA table_info(networks)").all() as Array<{ name: string }>;
    if (netCols.length > 0 && !netCols.some((c) => c.name === "probes_enabled")) {
      newDb.exec("ALTER TABLE networks ADD COLUMN probes_enabled INTEGER DEFAULT 1");
      console.info(`[db-tenant] ${tenantCode}: aggiunta networks.probes_enabled`);
    }
  } catch (e) {
    console.warn(`[db-tenant] ${tenantCode}: migrazione networks.probes_enabled fallita:`, e);
  }

  // Migrazione runtime: host_credentials.protocol_type CHECK include 'redfish'/'onvif'
  // (Fase 4b Task 3+4 — BMC Redfish e telecamere ONVIF ora hanno un protocol_type
  // dedicato invece di riusare 'api', vedi task-1-report.md §Decisione da confermare).
  try {
    const row = newDb.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='host_credentials'").get() as { sql?: string } | undefined;
    if (row?.sql && !row.sql.includes("'redfish'")) {
      newDb.pragma("foreign_keys = OFF");
      newDb.exec("DROP TABLE IF EXISTS host_credentials_v2");
      newDb.exec(`CREATE TABLE host_credentials_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
        credential_id INTEGER NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
        protocol_type TEXT NOT NULL CHECK(protocol_type IN ('ssh', 'snmp', 'winrm', 'api', 'redfish', 'onvif')),
        port INTEGER NOT NULL,
        validated INTEGER NOT NULL DEFAULT 0,
        validated_at TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        auto_detected INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        fail_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        last_attempt_at TEXT,
        backoff_until TEXT,
        UNIQUE(host_id, credential_id, protocol_type, port)
      )`);
      newDb.exec(`INSERT INTO host_credentials_v2 (
        id, host_id, credential_id, protocol_type, port, validated, validated_at,
        sort_order, auto_detected, created_at, fail_count, last_error, last_attempt_at, backoff_until
      ) SELECT
        id, host_id, credential_id, protocol_type, port, validated, validated_at,
        sort_order, auto_detected, created_at, fail_count, last_error, last_attempt_at, backoff_until
      FROM host_credentials`);
      newDb.exec("DROP TABLE host_credentials");
      newDb.exec("ALTER TABLE host_credentials_v2 RENAME TO host_credentials");
      newDb.exec("CREATE INDEX IF NOT EXISTS idx_host_credentials_host ON host_credentials(host_id, sort_order)");
      newDb.exec("CREATE INDEX IF NOT EXISTS idx_host_credentials_validated ON host_credentials(host_id, validated)");
      newDb.pragma("foreign_keys = ON");
      console.info(`[db-tenant] ${tenantCode}: host_credentials CHECK aggiornato (+ redfish/onvif)`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione host_credentials protocol_type fallita:`, e);
  }

  // Migrazione runtime: device_credential_bindings.protocol_type CHECK include 'redfish'/'onvif'
  // (stessa motivazione della migrazione host_credentials sopra).
  try {
    const row = newDb.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='device_credential_bindings'").get() as { sql?: string } | undefined;
    if (row?.sql && !row.sql.includes("'redfish'")) {
      newDb.pragma("foreign_keys = OFF");
      newDb.exec("DROP TABLE IF EXISTS device_credential_bindings_v2");
      newDb.exec(`CREATE TABLE device_credential_bindings_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
        credential_id INTEGER REFERENCES credentials(id) ON DELETE CASCADE,
        protocol_type TEXT NOT NULL CHECK(protocol_type IN ('ssh', 'snmp', 'winrm', 'api', 'redfish', 'onvif')),
        port INTEGER NOT NULL DEFAULT 22,
        sort_order INTEGER NOT NULL DEFAULT 0,
        inline_username TEXT,
        inline_encrypted_password TEXT,
        test_status TEXT NOT NULL DEFAULT 'untested' CHECK(test_status IN ('success', 'failed', 'untested')),
        test_message TEXT,
        tested_at TEXT,
        auto_detected INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(device_id, credential_id, protocol_type, port)
      )`);
      newDb.exec(`INSERT INTO device_credential_bindings_v2 (
        id, device_id, credential_id, protocol_type, port, sort_order, inline_username,
        inline_encrypted_password, test_status, test_message, tested_at, auto_detected, created_at
      ) SELECT
        id, device_id, credential_id, protocol_type, port, sort_order, inline_username,
        inline_encrypted_password, test_status, test_message, tested_at, auto_detected, created_at
      FROM device_credential_bindings`);
      newDb.exec("DROP TABLE device_credential_bindings");
      newDb.exec("ALTER TABLE device_credential_bindings_v2 RENAME TO device_credential_bindings");
      newDb.exec("CREATE INDEX IF NOT EXISTS idx_dcb_device ON device_credential_bindings(device_id, sort_order)");
      newDb.exec("CREATE INDEX IF NOT EXISTS idx_dcb_credential ON device_credential_bindings(credential_id)");
      newDb.pragma("foreign_keys = ON");
      console.info(`[db-tenant] ${tenantCode}: device_credential_bindings CHECK aggiornato (+ redfish/onvif)`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione device_credential_bindings protocol_type fallita:`, e);
  }

  // Topologia fase 1 (piano 2026-10-13): colonne e tabella delle correzioni.
  // Gira PER ULTIMA: i rebuild di network_devices qui sopra (CHECK 'firewall',
  // 'access_point') copiano solo le colonne che conoscono, e una migrazione
  // fatta prima perderebbe colonne e indice fino all'apertura successiva
  // (prova: topology-phase1-migration.test.ts, «tenant vecchio … rebuild»).
  try {
    const added = migrateTopologyPhase1(newDb);
    if (added.length > 0) {
      console.info(`[db-tenant] ${tenantCode}: topologia fase 1, aggiunte ${added.length} colonne`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione topologia fase 1 fallita:`, e);
  }

  // Topologia fase 2 (piano 2026-10-13-topologia-fase2-mappa): MAC per porta
  // che invecchiano (indice unico, doppi ridotti) e tabella delle mappe. Dopo
  // la fase 1, per la stessa ragione (ADR 0008 punto 6).
  try {
    const added = migrateTopologyPhase2(newDb);
    if (added.length > 0) {
      console.info(`[db-tenant] ${tenantCode}: topologia fase 2, aggiunto ${added.join(", ")}`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione topologia fase 2 fallita:`, e);
  }

  // Topologia fase 2b (piano 2026-10-14-topologia-fase2b): tipo e principale dei
  // collegamenti, tipo di uplink UniFi. Subito dopo la fase 2, per la stessa
  // ragione (ADR 0008 punto 6). Se fallisce il tenant si apre lo stesso: le
  // letture che nominano le colonne nuove falliscono finché non riesce.
  try {
    const added = migrateTopologyPhase2b(newDb);
    if (added.length > 0) {
      console.info(`[db-tenant] ${tenantCode}: topologia fase 2b, aggiunto ${added.join(", ")}`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione topologia fase 2b fallita:`, e);
  }

  // Orientamento della mappa (piano 2026-10-14-topologia-verticale-stampa): colonne
  // su topology_maps e topology_position. Subito dopo la fase 2b (topology_maps nasce
  // nella fase 2). Se fallisce il tenant si apre lo stesso: le letture delle mappe
  // che nominano la colonna falliscono finché non riesce.
  try {
    const added = migrateTopologyOrientation(newDb);
    if (added.length > 0) {
      console.info(`[db-tenant] ${tenantCode}: topologia orientamento, aggiunto ${added.join(", ")}`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione topologia orientamento fallita:`, e);
  }

  // Versione SNMP per apparato (2026-10-15). Se fallisce il tenant si apre lo stesso:
  // chi legge snmp_version la trova assente e parla come prima.
  try {
    const added = migrateSnmpVersione(newDb);
    if (added.length > 0) {
      console.info(`[db-tenant] ${tenantCode}: versione SNMP, aggiunto ${added.join(", ")}`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione versione SNMP fallita:`, e);
  }

  try {
    const added = migrateClassificazioneManualeApparato(newDb);
    if (added.length > 0) console.info(`[db-tenant] ${tenantCode}: classificazione a mano, aggiunto ${added.join(", ")}`);
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione classificazione a mano fallita:`, e);
  }

  // Catalogo canonico (21/10): colonna server_roles e conversione una tantum degli slug doppi. Prima della
  // ricostruzione di network_devices (riparte dalla definizione attuale). Se fallisce il tenant si apre lo stesso:
  // la scrittura canonicalizza comunque e la conversione si riprova all'apertura dopo (segno non scritto).
  try {
    const added = migrateServerRoles(newDb);
    if (added.length > 0) console.info(`[db-tenant] ${tenantCode}: ruoli dei server, aggiunto ${added.join(", ")}`);
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione ruoli dei server fallita:`, e);
  }
  try {
    const esito = convertiClassificazioniV21(newDb);
    if (esito.eseguita) {
      console.info(`[db-tenant] ${tenantCode}: ${SEGNO_CLASSIFICAZIONI_V21}, convertiti ${esito.hosts} host e ${esito.apparati} apparati`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: ${SEGNO_CLASSIFICAZIONI_V21} fallita (ROLLBACK), si riprova alla prossima apertura:`, e);
  }
  // device_type corretto sulle righe vecchie (21/10, scheda per tipo): `switch` era il workaround di schema per
  // server/NAS/firewall. Dopo la conversione delle classificazioni; elenco per nome nel log prima di scrivere.
  try {
    const esito = convertiDeviceTypeV21(newDb, (riga) => console.info(`[db-tenant] ${tenantCode}: ${riga}`));
    if (esito.eseguita) {
      console.info(`[db-tenant] ${tenantCode}: ${SEGNO_DEVICE_TYPE_V21}, corretti ${esito.convertiti} apparati`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: ${SEGNO_DEVICE_TYPE_V21} fallita (ROLLBACK), si riprova alla prossima apertura:`, e);
  }

  // Apple e macOS nella tabella degli apparati (tappa 1b, 15/10). In fondo, dopo
  // ogni migrazione che aggiunge colonne a network_devices: la ricostruzione parte
  // dalla definizione attuale e non perde colonne. Se fallisce si annulla (ROLLBACK)
  // e il tenant si apre lo stesso: un Mac resta rifiutato come prima.
  try {
    const esito = migraAppleMacos(newDb);
    if (esito.eseguita) {
      console.info(`[db-tenant] ${tenantCode}: network_devices accetta apple/macos (${esito.righe} righe ricopiate)`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione apple/macos fallita:`, e);
  }

  // Binding SNMP inline con la community nel campo username (tappa 1 credenziali,
  // 15/10): community spostata nel campo cifrato. Idempotente; il 15/10 le righe
  // erano 0 sull'hub e sul cliente A. Se fallisce il tenant si apre lo stesso.
  try {
    const convertiti = convertiCommunityInlineSnmp(newDb);
    if (convertiti > 0) {
      console.info(`[db-tenant] ${tenantCode}: ${convertiti} binding SNMP inline con la community spostata nel campo cifrato`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: conversione community SNMP inline fallita:`, e);
  }

  // Tappa 2c credenziali (T11): credentials senza CHECK sui tipi, poi i tipi per
  // esteso (linux → ssh, SNMP v3 come tipo, ibride e v3 vecchie divise). Dopo
  // gli ALTER di credColsNuove e dopo le altre conversioni delle credenziali.
  // Col segno done:/parziale: non si richiama più; senza segno o con errore: si
  // riprova all'apertura dopo. Il journal ha il prima/dopo sullo stesso DB
  // (righe, figli per colonna, violazioni, seq): è quello che si controlla al
  // rilascio (procedura R, passo 6). Se fallisce il tenant si apre lo stesso.
  try {
    if (!conversioneChiusa(leggiSegno(newDb, SEGNO_TIPI))) {
      const prima = statoCredenziali(newDb);
      const ricostruzione = migraCredenzialiTipi(newDb);
      const esito = normalizzaTipiCredenziali(newDb);
      const dopo = statoCredenziali(newDb);
      const segno = segnoTipi(esito);
      scriviSegno(newDb, SEGNO_TIPI, segno);
      const riga =
        `[db-tenant] ${tenantCode}: ${SEGNO_TIPI} ${segno}; ${descriviRicostruzione(ricostruzione)}; ` +
        `prima ${descriviStato(prima)}; dopo ${descriviStato(dopo)}; ${descriviNormalizza(esito)}`;
      if (esito.lasciate.length > 0) console.warn(riga);
      else console.info(riga);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: ${SEGNO_TIPI} fallita (ROLLBACK), si riprova alla prossima apertura:`, e);
    try {
      scriviSegno(newDb, SEGNO_TIPI, segnoErrore(e));
    } catch (e2) {
      console.error(`[db-tenant] ${tenantCode}: ${SEGNO_TIPI}, segno d'errore non scritto:`, e2);
    }
  }

  // Tappa 2d credenziali (T16): catene vecchie per ruolo e pin nella lista
  // della rete e nelle righe dell'host; le chiavi «di default» dell'hub solo
  // con un tenant attivo (D3 = (a)). Dopo la 2c. Conversione e segno nella
  // stessa transazione; col segno done:/parziale: non si richiama più (le
  // catene vecchie restano congelate fino alla 2g, e una voce tolta dalla
  // lista tornerebbe). Se fallisce: ROLLBACK, segno errore:, il tenant si apre
  // lo stesso e si riprova all'apertura dopo.
  try {
    if (!conversioneChiusa(leggiSegno(newDb, SEGNO_CATENE))) {
      const globali = { ...chiaviGlobaliHub(getSetting), tenantAttivi: getActiveTenants().length };
      const { esito, segno } = newDb.transaction(() => {
        const esito = convertiCateneVecchie(newDb, globali, { aVuoto: false });
        const segno = segnoCatene(esito);
        scriviSegno(newDb, SEGNO_CATENE, segno);
        return { esito, segno };
      })();
      const riga = `[db-tenant] ${tenantCode}: ${SEGNO_CATENE} ${segno}; ${descriviCatene(esito)}`;
      if (esito.saltate.some((x) => x.motivo !== MOTIVO_DUE_TENANT)) console.warn(riga);
      else console.info(riga);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: ${SEGNO_CATENE} fallita (ROLLBACK), si riprova alla prossima apertura:`, e);
    try {
      scriviSegno(newDb, SEGNO_CATENE, segnoErrore(e));
    } catch (e2) {
      console.error(`[db-tenant] ${tenantCode}: ${SEGNO_CATENE}, segno d'errore non scritto:`, e2);
    }
  }

  // Tappa 2e credenziali (T19): binding inline e colonne di network_devices
  // diventano voci e binding d'archivio, e le colonne si svuotano. Dopo la 2c
  // (tipi per esteso) e la 2d. Conversione e segno nella stessa transazione;
  // col segno done:/parziale: non si richiama più (un binding tolto tornerebbe
  // da una colonna riscritta dal codice di prima). Il journal elenca per id
  // binding nati, voci nuove, colonne svuotate e apparati lasciati col motivo.
  // Se fallisce: ROLLBACK, segno errore:, il tenant si apre lo stesso e si
  // riprova all'apertura dopo.
  try {
    if (!conversioneChiusa(leggiSegno(newDb, SEGNO_APPARATI))) {
      const { esito, segno } = newDb.transaction(() => {
        const esito = convertiCredenzialiApparati(newDb, { aVuoto: false });
        const segno = segnoApparati(esito);
        scriviSegno(newDb, SEGNO_APPARATI, segno);
        return { esito, segno };
      })();
      const riga = `[db-tenant] ${tenantCode}: ${SEGNO_APPARATI} ${segno}; ${descriviApparati(esito)}`;
      if (esito.lasciati.length > 0) console.warn(riga);
      else console.info(riga);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: ${SEGNO_APPARATI} fallita (ROLLBACK), si riprova alla prossima apertura:`, e);
    try {
      scriviSegno(newDb, SEGNO_APPARATI, segnoErrore(e));
    } catch (e2) {
      console.error(`[db-tenant] ${tenantCode}: ${SEGNO_APPARATI}, segno d'errore non scritto:`, e2);
    }
  }

  // Tappa 2f credenziali (T22): i segreti di controller e AD diventano voci
  // d'archivio («UniFi · <nome>», «AD · <nome>») e la riga le punta con
  // credential_id; le colonne vecchie restano piene fino alla 2g. Dopo la 2c
  // (tipi per esteso) e la 2e. Conversione e segno nella stessa transazione;
  // col segno done:/parziale: non si richiama più: con le colonne ancora
  // piene ricreerebbe voci doppie, o ricollegherebbe a una voce un controller
  // spostato senza che nessuno l'abbia scelta. Il journal elenca per id le
  // righe convertite (confronto decifrato «uguale») e quelle lasciate col
  // motivo. Se fallisce (anche per un confronto «diverso»): ROLLBACK, segno
  // errore:, il tenant si apre lo stesso e si riprova all'apertura dopo.
  try {
    if (!conversioneChiusa(leggiSegno(newDb, SEGNO_INTEGRAZIONI))) {
      const { esito, segno } = newDb.transaction(() => {
        const esito = convertiControllerEAd(newDb, { aVuoto: false });
        const segno = segnoIntegrazioni(esito);
        scriviSegno(newDb, SEGNO_INTEGRAZIONI, segno);
        return { esito, segno };
      })();
      const riga = `[db-tenant] ${tenantCode}: ${SEGNO_INTEGRAZIONI} ${segno}; ${descriviIntegrazioni(esito)}`;
      if (esito.lasciati.length > 0) console.warn(riga);
      else console.info(riga);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: ${SEGNO_INTEGRAZIONI} fallita (ROLLBACK), si riprova alla prossima apertura:`, e);
    try {
      scriviSegno(newDb, SEGNO_INTEGRAZIONI, segnoErrore(e));
    } catch (e2) {
      console.error(`[db-tenant] ${tenantCode}: ${SEGNO_INTEGRAZIONI}, segno d'errore non scritto:`, e2);
    }
  }

  // Topologia T2 (spec §13.5.7): fatti delle letture in più. Per ultima, dopo le ricostruzioni di network_devices
  // (ADR 0008 punto 6; anche dopo migraAppleMacos, che riparte dalla definizione attuale e non perderebbe colonne,
  // ma così l'ordine non conta). Se fallisce il tenant si apre lo stesso: l'annotazione dice «schema assente», le
  // letture in più non scrivono, il modello per cavo riceve elenchi vuoti e «Dati della mappa» lo dice. La riga
  // «topologia cavi (T2), aggiunto …» nel journal è la prova del rilascio (piano di T2, Task 16).
  try {
    const added = migrateTopologyCavi(newDb);
    if (added.length > 0) {
      console.info(`[db-tenant] ${tenantCode}: topologia cavi (T2), aggiunto ${added.join(", ")}`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione topologia cavi (T2) fallita, le letture in più non scrivono:`, e);
  }
  // Anche la verifica non deve impedire l'apertura: se fallisce non si annota niente, e schemaCaviPresente() la rifà.
  try {
    SCHEMA_CAVI.set(newDb, verificaSchemaCavi(newDb));
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: verifica dello schema della topologia cavi (T2) fallita, si rifà alla prima scrittura:`, e);
  }

  // Unioni e separazioni a mano (piano 2026-10-16, ADR 0021): due tabelle e tre indici, solo cose nuove. Se la migrazione
  // fallisce il tenant si apre lo stesso: l'annotazione dice «schema assente», l'ingresso del modello non ha righe (la mappa di
  // oggi) e le rotte rispondono «non disponibili». La riga «topologia unioni, aggiunto …» nel journal è la prova del rilascio.
  try {
    const added = migrateTopologyUnioni(newDb);
    if (added.length > 0) {
      console.info(`[db-tenant] ${tenantCode}: topologia unioni, aggiunto ${added.join(", ")}`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione topologia unioni fallita, le unioni non sono disponibili:`, e);
  }
  // Come per i cavi: una verifica che fallisce non impedisce l'apertura; senza annotazione schemaUnioniPresente() la rifà.
  try {
    SCHEMA_UNIONI.set(newDb, verificaSchemaUnioni(newDb));
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: verifica dello schema delle unioni fallita, si rifà alla prima lettura:`, e);
  }

  // Archivio della pulizia degli host (piano 2026-10-20): una tabella e due indici, solo cose nuove. Se fallisce il tenant si
  // apre lo stesso: archiviare e recuperare falliscono con l'errore di SQLite (tabella assente), niente si cancella senza istantanea.
  try {
    const added = migrateHostsArchivio(newDb);
    if (added.length > 0) {
      console.info(`[db-tenant] ${tenantCode}: archivio host, aggiunto ${added.join(", ")}`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione dell'archivio host fallita, la pulizia degli host non è disponibile:`, e);
  }

  // Scheda MikroTik (piano 2026-10-21): cinque colonne nuove su tabelle che esistono già (v1), le tabelle di bridge, porte e
  // bond (v2) e quelle di VLAN dei bridge, interfacce VLAN, DNS e utenti (v3). Se fallisce il tenant si apre lo stesso: livelloSchemaSchedaMk() dice il livello che c'è e le letture scrivono
  // solo fin lì. La riga del journal è la prova del rilascio.
  try {
    const added = migrateSchedaMikrotik(newDb);
    if (added.length > 0) {
      console.info(`[db-tenant] ${tenantCode}: scheda mikrotik, aggiunto ${added.join(", ")}`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione scheda mikrotik fallita (ROLLBACK), le colonne nuove non si scrivono:`, e);
    chiudiMigrazioneSchedaMkFallita(newDb, tenantCode, e);
  }

  // Principale del cluster fisico (piano 2026-10-22 accorpamento): una colonna e un indice su physical_devices. Se fallisce il
  // tenant si apre lo stesso: Discovery usa la regola senza la scelta a mano (cluster-discovery.ts guarda se la colonna c'è).
  try {
    const added = migrateClusterPrincipale(newDb);
    if (added.length > 0) {
      console.info(`[db-tenant] ${tenantCode}: principale del cluster, aggiunto ${added.join(", ")}`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione principale del cluster fallita (ROLLBACK), la scelta a mano non si salva:`, e);
    chiudiMigrazioneClusterPrincipaleFallita(newDb, tenantCode, e);
  }

  // VLAN degli switch (piano 2026-10-22 accorpamento, ADR 0029): quattro tabelle nuove, solo se mancano. Se fallisce il tenant
  // si apre lo stesso: schemaSwitchVlanPresente() dice false, la lettura non scrive e la scheda mostra «mai lette».
  try {
    const added = migrateSwitchVlan(newDb);
    if (added.length > 0) {
      console.info(`[db-tenant] ${tenantCode}: switch vlan, aggiunto ${added.join(", ")}`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione switch vlan fallita (ROLLBACK), le VLAN degli switch non si scrivono:`, e);
    chiudiMigrazioneSwitchVlanFallita(newDb, tenantCode, e);
  }

  // VLAN native dal controller UniFi (Task 13): una tabella nuova, solo se manca. Se fallisce il tenant si apre lo stesso:
  // la sync non scrive le native e la matrice resta «dedotta» dove l'SNMP non dichiara gli untagged.
  try {
    const added = migrateSwitchVlanNativa(newDb);
    if (added.length > 0) {
      console.info(`[db-tenant] ${tenantCode}: switch vlan native, aggiunto ${added.join(", ")}`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione switch vlan native fallita (ROLLBACK), le native del controller non si scrivono:`, e);
    try {
      SCHEMA_SWITCH_VLAN_NATIVA.set(newDb, tabelleSchedaMkMancanti(newDb, DDL_SWITCH_VLAN_NATIVA).length === 0);
      scriviSegno(newDb, SEGNO_SWITCH_VLAN_NATIVA, segnoErrore(e));
    } catch (e2) {
      console.error(`[db-tenant] ${tenantCode}: ${SEGNO_SWITCH_VLAN_NATIVA}, segno non scritto:`, e2);
    }
  }

  // LibreNMS come fonte di dati (piano 2026-10-22 LibreNMS, task 2): dieci tabelle nuove e due indici, solo se mancano. Se
  // fallisce il tenant si apre lo stesso: livelloSchemaLibrenms() dice 0, la lettura non scrive e la scheda non ha dati.
  try {
    const added = migrateLibrenmsFonte(newDb);
    if (added.length > 0) {
      console.info(`[db-tenant] ${tenantCode}: librenms fonte, aggiunto ${added.join(", ")}`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione librenms fonte fallita (ROLLBACK), i dati di LibreNMS non si scrivono:`, e);
    chiudiMigrazioneLibrenmsFonteFallita(newDb, tenantCode, e);
  }

  // Esclusioni da LibreNMS (giro del 22/10): una tabella nuova, solo se manca. Se fallisce il tenant si apre lo stesso:
  // schemaEsclusioneLibrenms() dice false e il giro non aggiunge da solo gli oggetti SNMP.
  try {
    const added = migrateLibrenmsEsclusione(newDb);
    if (added.length > 0) {
      console.info(`[db-tenant] ${tenantCode}: librenms esclusioni, aggiunto ${added.join(", ")}`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione librenms esclusioni fallita (ROLLBACK), il giro non aggiunge oggetti SNMP:`, e);
    try {
      if (schemaEsclusioneLibrenms(newDb)) {
        const attuale = leggiSegno(newDb, SEGNO_LIBRENMS_ESCLUSIONE);
        if (!attuale?.startsWith("done:")) scriviSegno(newDb, SEGNO_LIBRENMS_ESCLUSIONE, `done:${new Date().toISOString().slice(0, 10)}:v${VERSIONE_LIBRENMS_ESCLUSIONE}`);
      } else {
        scriviSegno(newDb, SEGNO_LIBRENMS_ESCLUSIONE, segnoErrore(e));
      }
    } catch (e2) {
      console.error(`[db-tenant] ${tenantCode}: ${SEGNO_LIBRENMS_ESCLUSIONE}, segno non scritto:`, e2);
    }
  }

  // Coda verso DA-Vul-can (piano 2026-10-22 invio AD e inventario): due tabelle e un indice nuovi, solo se mancano. Se
  // fallisce il tenant si apre lo stesso: schemaVulcanPresente() dice false e il flusso non accoda (lo dice, non scrive a vuoto).
  try {
    const added = migrateVulcanCoda(newDb);
    if (added.length > 0) {
      console.info(`[db-tenant] ${tenantCode}: coda vulcan, aggiunto ${added.join(", ")}`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione coda vulcan fallita (ROLLBACK), gli invii verso DA-Vul-can non si accodano:`, e);
    try {
      // Schema completo dopo il fallimento = un altro processo ha vinto la corsa: segno `done`, non un errore.
      if (schemaVulcanPresente(newDb)) {
        const attuale = leggiSegno(newDb, SEGNO_VULCAN);
        if (!attuale?.startsWith("done:")) scriviSegno(newDb, SEGNO_VULCAN, `done:${new Date().toISOString().slice(0, 10)}:v${VERSIONE_VULCAN}`);
      } else {
        scriviSegno(newDb, SEGNO_VULCAN, segnoErrore(e));
      }
    } catch (e2) {
      console.error(`[db-tenant] ${tenantCode}: ${SEGNO_VULCAN}, segno non scritto:`, e2);
    }
  }

  // Assegnatari da AD (piano 2026-10-23): colonne nuove, la tabella degli accessi e tre indici, solo se mancano. Se fallisce
  // il tenant si apre lo stesso: schemaAssegnatariAdPresente() dice false, il giro non raccoglie e le pagine lo dicono.
  try {
    const added = migrateAssegnatariAd(newDb);
    if (added.length > 0) {
      console.info(`[db-tenant] ${tenantCode}: assegnatari da AD, aggiunto ${added.join(", ")}`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione assegnatari da AD fallita (ROLLBACK), proposte e importazione spente:`, e);
    try {
      if (schemaAssegnatariAdPresente(newDb)) {
        const attuale = leggiSegno(newDb, SEGNO_ASSEGNATARI_AD);
        if (!attuale?.startsWith("done:")) scriviSegno(newDb, SEGNO_ASSEGNATARI_AD, `done:${new Date().toISOString().slice(0, 10)}:v${VERSIONE_ASSEGNATARI_AD}`);
      } else {
        scriviSegno(newDb, SEGNO_ASSEGNATARI_AD, segnoErrore(e));
      }
    } catch (e2) {
      console.error(`[db-tenant] ${tenantCode}: ${SEGNO_ASSEGNATARI_AD}, segno non scritto:`, e2);
    }
  }

  // da-vault (piano 2026-10-23): riferimento a OpenBao e registro delle visualizzazioni, solo se mancano. Se fallisce il
  // tenant si apre lo stesso: schemaVaultPresente() dice false e le funzioni del vault lo dicono (a interruttori spenti
  // nessuno le usa).
  try {
    const added = migrateVault(newDb);
    if (added.length > 0) {
      console.info(`[db-tenant] ${tenantCode}: vault, aggiunto ${added.join(", ")}`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione del vault fallita (ROLLBACK), registro e riferimenti OpenBao non disponibili:`, e);
    try {
      if (schemaVaultPresente(newDb)) {
        const attuale = leggiSegno(newDb, SEGNO_VAULT);
        if (!attuale?.startsWith("done:")) scriviSegno(newDb, SEGNO_VAULT, `done:${new Date().toISOString().slice(0, 10)}:v${VERSIONE_VAULT}`);
      } else {
        scriviSegno(newDb, SEGNO_VAULT, segnoErrore(e));
      }
    } catch (e2) {
      console.error(`[db-tenant] ${tenantCode}: ${SEGNO_VAULT}, segno non scritto:`, e2);
    }
  }

  tenantDbs.set(tenantCode, { db: newDb, lastUsed: Date.now() });
  return newDb;
}

export function closeTenantDb(tenantCode: string): void {
  const entry = tenantDbs.get(tenantCode);
  if (entry) {
    try {
      entry.db.close();
    } catch {
      /* ignore */
    }
    tenantDbs.delete(tenantCode);
  }
}

export function closeAllTenantDbs(): void {
  for (const [code] of tenantDbs) {
    closeTenantDb(code);
  }
}

export function createTenantDatabase(tenantCode: string): void {
  getTenantDb(tenantCode);
}

export function deleteTenantDatabase(tenantCode: string): void {
  closeTenantDb(tenantCode);
  const dbPath = unisci(TENANTS_DIR, `${tenantCode}.db`);
  try { fs.unlinkSync(dbPath); } catch { /* file may not exist */ }
  try { fs.unlinkSync(`${dbPath}-wal`); } catch { /* ignore */ }
  try { fs.unlinkSync(`${dbPath}-shm`); } catch { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL: db() reads from AsyncLocalStorage
// ═══════════════════════════════════════════════════════════════════════════

function db(): Database.Database {
  const code = tenantContext.getStore();
  if (!code) throw new Error("Nessun contesto tenant — usare withTenant() prima di accedere al DB tenant");
  return getTenantDb(code);
}

// v0.2.648 audit perf MC2: statement cache per-Database. better-sqlite3 non
// cacha internamente, quindi `db.prepare(sql)` ricompila ad ogni call (~50-100µs).
// Su hot path (getHostsByNetwork, getScheduledJobById ad ogni cron tick, ...)
// è puro overhead. Cached via WeakMap automaticamente GC'd quando il Database
// handle viene evicted dalla LRU.
const statementCache = new WeakMap<Database.Database, Map<string, Database.Statement>>();

/**
 * Ritorna un prepared statement riusabile per (db, sql). Cache automatica.
 * USO: `prep("SELECT ...").get(...)` invece di `db().prepare("SELECT ...").get(...)`.
 * Idempotente: la stessa stringa SQL produce la stessa Statement istanza.
 *
 * Generic <P>: tipo varargs dei parameter. Default unknown[]. Necessario per
 * compatibilità con Statement.run/get/all che accettano signature variadica.
 */
export function prep<P extends unknown[] = unknown[]>(sql: string, targetDb?: Database.Database): Database.Statement<P> {
  const d = targetDb ?? db();
  let bucket = statementCache.get(d);
  if (!bucket) {
    bucket = new Map();
    statementCache.set(d, bucket);
  }
  let stmt = bucket.get(sql);
  if (!stmt) {
    stmt = d.prepare(sql);
    bucket.set(sql, stmt);
  }
  return stmt as Database.Statement<P>;
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES (local to this module)
// ═══════════════════════════════════════════════════════════════════════════

/** Convert IPv4 string to numeric value for sorting */
function ipToNum(ip: string): number {
  const p = ip.split(".").map(Number);
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

/** Confronto MAC normalizzato (ignora : - .) per match cross-vendor */
const MAC_HEX = (col: string) => `UPPER(REPLACE(REPLACE(REPLACE(COALESCE(${col},''), ':', ''), '-', ''), '.', ''))`;

type PortEntry = { port: number; protocol: string; service?: string | null; version?: string | null };

function parsePortsJson(json: string | null): PortEntry[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json) as Array<{ port: number; protocol?: string; service?: string | null; version?: string | null }>;
    if (Array.isArray(arr)) {
      return arr.map((p) => ({ port: p.port, protocol: p.protocol || "tcp", service: p.service, version: p.version }));
    }
  } catch { /* ignore */ }
  return [];
}

/**
 * Sostituisce le porte di un protocollo specifico mantenendo quelle dell'altro.
 */
function mergeOpenPortsByProtocol(existing: string | null, incoming: string, replaceProtocol: "tcp" | "udp"): string {
  const existingPorts = parsePortsJson(existing);
  const incomingPorts = parsePortsJson(incoming);
  const kept = existingPorts.filter((p) => p.protocol !== replaceProtocol);
  const newOfProtocol = incomingPorts.filter((p) => p.protocol === replaceProtocol);
  const merged = [...kept, ...newOfProtocol];
  const seen = new Set<string>();
  const unique: PortEntry[] = [];
  for (const p of merged) {
    const key = `${p.port}:${p.protocol}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(p);
    }
  }
  return JSON.stringify(unique.sort((a, b) => a.port - b.port || String(a.protocol).localeCompare(b.protocol)));
}

// ═══════════════════════════════════════════════════════════════════════════
// NETWORKS
// ═══════════════════════════════════════════════════════════════════════════

export function getNetworks(): (NetworkWithStats & { router_id: number | null })[] {
  return db().prepare(`
    SELECT
      n.*,
      nr.router_id,
      COALESCE(h.total_hosts, 0) as total_hosts,
      COALESCE(h.online_count, 0) as online_count,
      COALESCE(h.offline_count, 0) as offline_count,
      COALESCE(h.unknown_count, 0) as unknown_count,
      (SELECT MAX(timestamp) FROM scan_history WHERE network_id = n.id) as last_scan
    FROM networks n
    LEFT JOIN network_router nr ON nr.network_id = n.id
    LEFT JOIN (
      SELECT
        network_id,
        COUNT(*) as total_hosts,
        SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) as online_count,
        SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END) as offline_count,
        SUM(CASE WHEN status = 'unknown' THEN 1 ELSE 0 END) as unknown_count
      FROM hosts
      GROUP BY network_id
    ) h ON h.network_id = n.id
    ORDER BY n.name
  `).all() as (NetworkWithStats & { router_id: number | null })[];
}

export function getNetworksPaginated(
  page: number,
  pageSize: number,
  search?: string,
  sort?: { key?: string; dir?: SortDirection }
): { data: (NetworkWithStats & { router_id: number | null })[]; total: number } {
  const offset = (page - 1) * pageSize;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (search && search.trim()) {
    const like = `%${search.trim()}%`;
    conditions.push("(n.name LIKE ? OR n.cidr LIKE ? OR n.location LIKE ?)");
    params.push(like, like, like);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const total = (db().prepare(`SELECT COUNT(*) as cnt FROM networks n ${whereClause}`).get(...params) as { cnt: number }).cnt;

  const orderSql = sqlOrderByNetworks(sort?.key, sort?.dir ?? "asc");

  const data = db().prepare(`
    SELECT
      n.*,
      nr.router_id,
      COALESCE(h.total_hosts, 0) as total_hosts,
      COALESCE(h.online_count, 0) as online_count,
      COALESCE(h.offline_count, 0) as offline_count,
      COALESCE(h.unknown_count, 0) as unknown_count,
      (SELECT MAX(timestamp) FROM scan_history WHERE network_id = n.id) as last_scan
    FROM networks n
    LEFT JOIN network_router nr ON nr.network_id = n.id
    LEFT JOIN (
      SELECT
        network_id,
        COUNT(*) as total_hosts,
        SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) as online_count,
        SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END) as offline_count,
        SUM(CASE WHEN status = 'unknown' THEN 1 ELSE 0 END) as unknown_count
      FROM hosts
      GROUP BY network_id
    ) h ON h.network_id = n.id
    ${whereClause}
    ORDER BY ${orderSql}
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset) as (NetworkWithStats & { router_id: number | null })[];

  return { data, total };
}

export function getNetworkById(id: number): Network | undefined {
  return db().prepare("SELECT * FROM networks WHERE id = ?").get(id) as Network | undefined;
}

/** Router ARP associato alla subnet (tabella network_router), se presente. */
export function getNetworkRouterBinding(networkId: number): { id: number; name: string; host: string } | null {
  const row = db()
    .prepare(
      `SELECT nd.id, nd.name, nd.host
       FROM network_router nr
       JOIN network_devices nd ON nd.id = nr.router_id
       WHERE nr.network_id = ?
       LIMIT 1`
    )
    .get(networkId) as { id: number; name: string; host: string } | undefined;
  return row ?? null;
}

export function getNetworkContainingIp(ip: string): Network | undefined {
  const { isIpInCidr } = require("./utils") as { isIpInCidr: (ip: string, cidr: string) => boolean };
  const networks = db().prepare("SELECT * FROM networks").all() as Network[];
  for (const net of networks) {
    if (isIpInCidr(ip, net.cidr)) {
      return net;
    }
  }
  return undefined;
}

export function buildNetworkLookup(): (ip: string) => Network | undefined {
  const { ipToLong, parseCidr } = require("./utils") as {
    ipToLong: (ip: string) => number;
    parseCidr: (cidr: string) => { networkLong: number; broadcastLong: number; prefix: number };
  };
  const networks = db().prepare("SELECT * FROM networks").all() as Network[];
  const parsed = networks.map((net) => {
    const { networkLong, broadcastLong } = parseCidr(net.cidr);
    return { net, networkLong, broadcastLong };
  });

  return (ip: string) => {
    const ipLong = ipToLong(ip);
    for (const { net, networkLong, broadcastLong } of parsed) {
      if (ipLong >= networkLong && ipLong <= broadcastLong) return net;
    }
    return undefined;
  };
}

export function createNetwork(input: NetworkInput): Network {
  const { cidrOverlaps } = require("./utils") as { cidrOverlaps: (a: string, b: string) => boolean };
  const existing = db().prepare("SELECT cidr FROM networks").all() as { cidr: string }[];
  for (const net of existing) {
    if (cidrOverlaps(input.cidr, net.cidr)) {
      throw new Error(`La rete ${input.cidr} si sovrappone alla rete esistente ${net.cidr}`);
    }
  }

  const stmt = db().prepare(
    `INSERT INTO networks (cidr, name, description, gateway, vlan_id, location, snmp_community, dns_server)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    input.cidr,
    input.name,
    input.description || "",
    input.gateway || null,
    input.vlan_id || null,
    input.location || "",
    input.snmp_community || null,
    input.dns_server || null
  );
  const networkId = Number(result.lastInsertRowid);

  // Default scheduling: known_host_check (safe). Spalma il next_run in base ai
  // network già esistenti per evitare burst se l'utente crea reti in serie.
  try {
    const existingNets = (db()
      .prepare("SELECT COUNT(*) AS n FROM networks")
      .get() as { n: number }).n;
    const idx = Math.max(0, existingNets - 1);
    seedDefaultJobsForNetwork(networkId, idx, Math.max(1, existingNets));
  } catch (err) {
    console.warn(`[createNetwork] seed default jobs failed per network ${networkId}:`, err);
  }

  return db().prepare("SELECT * FROM networks WHERE id = ?").get(networkId) as Network;
}

export function updateNetwork(id: number, input: Partial<NetworkInput>): Network | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.cidr !== undefined) { fields.push("cidr = ?"); values.push(input.cidr); }
  if (input.name !== undefined) { fields.push("name = ?"); values.push(input.name); }
  if (input.description !== undefined) { fields.push("description = ?"); values.push(input.description); }
  if (input.gateway !== undefined) { fields.push("gateway = ?"); values.push(input.gateway); }
  if (input.vlan_id !== undefined) { fields.push("vlan_id = ?"); values.push(input.vlan_id); }
  if (input.location !== undefined) { fields.push("location = ?"); values.push(input.location); }
  if (input.snmp_community !== undefined) { fields.push("snmp_community = ?"); values.push(input.snmp_community); }
  if (input.dns_server !== undefined) { fields.push("dns_server = ?"); values.push(input.dns_server); }

  if (fields.length === 0) return getNetworkById(id);

  fields.push("updated_at = datetime('now')");
  values.push(id);

  db().prepare(`UPDATE networks SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getNetworkById(id);
}

export function setNetworkTargetingMode(
  id: number,
  mode: "full_subnet" | "found_ips" | "populated_24",
): void {
  db()
    .prepare("UPDATE networks SET targeting_mode = ?, updated_at = datetime('now') WHERE id = ?")
    .run(mode, id);
}

export function setNetworkAssessmentConfig(
  id: number,
  opts: { enabled: boolean; profileId: string | null },
): void {
  db()
    .prepare(
      `UPDATE networks SET assessment_enabled = ?, assessment_profile_id = ?,
       updated_at = datetime('now') WHERE id = ?`,
    )
    .run(opts.enabled ? 1 : 0, opts.profileId, id);
}

export function deleteNetwork(id: number): boolean {
  const result = db().prepare("DELETE FROM networks WHERE id = ?").run(id);
  return result.changes > 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// HOSTS
// ═══════════════════════════════════════════════════════════════════════════

export function getHostsByNetwork(networkId: number): Host[] {
  // v0.2.648 audit perf MC2: prep cached (chiamato 100+ volte per scan grande).
  const hosts = prep("SELECT * FROM hosts WHERE network_id = ?").all(networkId) as Host[];
  return hosts.sort((a, b) => ipToNum(a.ip) - ipToNum(b.ip));
}

export function getAllHostsFlat(): Host[] {
  return db().prepare("SELECT * FROM hosts").all() as Host[];
}

export function getAllHosts(limit: number = 10000): Host[] {
  const hosts = db()
    .prepare("SELECT * FROM hosts ORDER BY network_id, ip LIMIT ?")
    .all(limit) as Host[];
  return hosts.sort((a, b) => {
    if (a.network_id !== b.network_id) return a.network_id - b.network_id;
    return ipToNum(a.ip) - ipToNum(b.ip);
  });
}

/** Tutti gli host arricchiti con nome rete, device associato, porta switch, AD. Per pagina Discovery. */
export function getAllHostsEnriched(limit = 5000): Array<Host & {
  network_name: string;
  network_cidr: string;
  vlan_id: number | null;
  location: string;
  device_id?: number;
  device_name?: string;
  device_vendor?: string;
  device_type?: string;
  switch_port?: string;
  switch_device_name?: string;
  ad_dns_host_name?: string | null;
  /** Frequenza dello scan attivo più rapido sulla rete (per derivare la soglia
   *  "unreachable = 4 cicli" in UI). Null se nessun job scan abilitato. */
  scan_interval_minutes?: number | null;
}> {
  const rows = db().prepare(`
    SELECT h.*,
           n.name  AS _net_name,
           n.cidr  AS _net_cidr,
           n.vlan_id AS _net_vlan,
           COALESCE(n.location, '') AS _net_location,
           nd.id   AS _dev_id,
           nd.name AS _dev_name,
           nd.vendor AS _dev_vendor,
           nd.device_type AS _dev_type,
           mpe.port_name AS _sw_port,
           sw.name AS _sw_name,
           ac.ad_dns AS _ad_dns,
           ia.id AS _asset_id,
           ia.asset_tag AS _asset_tag,
           ia.categoria AS _asset_categoria,
           ssw.id AS _sw_scan_id,
           ssw.apps_count AS _sw_apps_count,
           ssw.started_at AS _sw_scan_at,
           sj.min_interval AS _scan_interval
    FROM hosts h
    JOIN networks n ON n.id = h.network_id
    LEFT JOIN (
      SELECT network_id, MIN(interval_minutes) AS min_interval
      FROM scheduled_jobs
      WHERE enabled = 1
        AND job_type IN ('fast_scan', 'network_discovery', 'ping_sweep')
        AND network_id IS NOT NULL
      GROUP BY network_id
    ) sj ON sj.network_id = h.network_id
    LEFT JOIN network_devices nd ON nd.host = h.ip
    -- v0.2.645 audit perf DB2 + v0.2.650 hotfix: pre-aggregato seek-only su MAX(rowid).
    -- Prima ROW_NUMBER() OVER (PARTITION BY mac) full-scan; il fix v0.2.645 usava
    -- MAX(timestamp) ma le righe (mac, timestamp) NON sono uniche (fino a 4096
    -- duplicati osservati su switch_port discovery che inserisce stessa riga ad
    -- ogni tick) → INNER JOIN moltiplicava gli host. MAX(rowid) garantisce 1 riga
    -- per mac (rowid univoco di default in SQLite).
    -- Topologia fase 2: con le righe aggiornate sul posto (una per apparato, MAC,
    -- porta) MAX(rowid) non è più la lettura più recente. SQLite, con un solo
    -- MAX() nel GROUP BY, restituisce le colonne nude della riga che lo realizza:
    -- una riga per mac, quella col timestamp più recente.
    LEFT JOIN (
      SELECT mac, port_name, device_id
      FROM mac_port_entries
      WHERE rowid IN (SELECT rid FROM (SELECT rowid AS rid, MAX(timestamp) FROM mac_port_entries GROUP BY mac))
    ) mpe ON mpe.mac = h.mac
    LEFT JOIN network_devices sw ON sw.id = mpe.device_id
    LEFT JOIN (
      SELECT host_id, MAX(dns_host_name) AS ad_dns
      FROM ad_computers WHERE host_id IS NOT NULL
      GROUP BY host_id
    ) ac ON ac.host_id = h.id
    LEFT JOIN (
      SELECT host_id, MAX(id) AS id, MAX(asset_tag) AS asset_tag, MAX(categoria) AS categoria
      FROM inventory_assets WHERE host_id IS NOT NULL
      GROUP BY host_id
    ) ia ON ia.host_id = h.id
    LEFT JOIN (
      SELECT s.host_id, s.id, s.apps_count, s.started_at
      FROM software_scans s
      JOIN (
        SELECT host_id, MAX(started_at) AS max_at
        FROM software_scans
        WHERE host_id IS NOT NULL AND status = 'ok'
        GROUP BY host_id
      ) latest ON latest.host_id = s.host_id AND latest.max_at = s.started_at
    ) ssw ON ssw.host_id = h.id
    ORDER BY h.network_id, h.ip
    LIMIT ?
  `).all(limit) as Array<Host & {
    _net_name: string; _net_cidr: string; _net_vlan: number | null; _net_location: string;
    _dev_id?: number; _dev_name?: string; _dev_vendor?: string; _dev_type?: string;
    _sw_port?: string; _sw_name?: string; _ad_dns?: string | null;
    _asset_id?: number | null; _asset_tag?: string | null; _asset_categoria?: string | null;
    _sw_scan_id?: number | null; _sw_apps_count?: number | null; _sw_scan_at?: string | null;
    _scan_interval?: number | null;
  }>;

  return rows.map(({ _net_name, _net_cidr, _net_vlan, _net_location, _dev_id, _dev_name, _dev_vendor, _dev_type, _sw_port, _sw_name, _ad_dns, _asset_id, _asset_tag, _asset_categoria, _sw_scan_id, _sw_apps_count, _sw_scan_at, _scan_interval, ...h }) => ({
    ...h,
    network_name: _net_name,
    network_cidr: _net_cidr,
    vlan_id: _net_vlan,
    location: _net_location,
    device_id: _dev_id ?? undefined,
    device_name: _dev_name ?? undefined,
    device_vendor: _dev_vendor ?? undefined,
    device_type: _dev_type ?? undefined,
    switch_port: _sw_port ?? undefined,
    switch_device_name: _sw_name ?? undefined,
    ad_dns_host_name: _ad_dns ?? undefined,
    asset_id: _asset_id ?? undefined,
    asset_tag: _asset_tag ?? undefined,
    asset_categoria: _asset_categoria ?? undefined,
    last_software_scan_id: _sw_scan_id ?? undefined,
    last_software_scan_apps: _sw_apps_count ?? undefined,
    last_software_scan_at: _sw_scan_at ?? undefined,
    scan_interval_minutes: _scan_interval ?? null,
  }));
}

export function getHostsByNetworkWithDevices(networkId: number): (Host & {
  device_id?: number;
  device?: { id: number; name: string; sysname: string | null; vendor: string; protocol: string };
  ad_dns_host_name?: string | null;
  multihomed?: { group_id: string; match_type: string; is_primary: boolean; primary_host_id: number | null; primary_ip: string | null; peers: Array<{ ip: string; network_name: string; host_id: number; is_primary: boolean }> } | null;
})[] {
  const hosts = db().prepare(
    `SELECT h.*, nd.id as _dev_id, nd.name as _dev_name, nd.sysname as _dev_sysname, nd.vendor as _dev_vendor, nd.protocol as _dev_protocol,
            ac.ad_dns as _ad_dns,
            ml.group_id as _mh_group, ml.match_type as _mh_type, ml.is_primary as _mh_is_primary
     FROM hosts h
     LEFT JOIN network_devices nd ON nd.host = h.ip
     LEFT JOIN (
       SELECT host_id, MAX(dns_host_name) as ad_dns
       FROM ad_computers
       WHERE host_id IS NOT NULL
       GROUP BY host_id
     ) ac ON ac.host_id = h.id
     LEFT JOIN multihomed_links ml ON ml.host_id = h.id
     WHERE h.network_id = ?`
  ).all(networkId) as (Host & {
    _dev_id?: number; _dev_name?: string; _dev_sysname?: string | null; _dev_vendor?: string; _dev_protocol?: string;
    _ad_dns?: string | null; _mh_group?: string | null; _mh_type?: string | null; _mh_is_primary?: number | null;
  })[];

  const groupIds = new Set<string>();
  for (const h of hosts) {
    if (h._mh_group) groupIds.add(h._mh_group);
  }
  const peersByGroup = new Map<string, Array<{ ip: string; network_name: string; host_id: number; is_primary: boolean }>>();
  const primaryByGroup = new Map<string, { host_id: number; ip: string }>();
  if (groupIds.size > 0) {
    const placeholders = [...groupIds].map(() => "?").join(",");
    // Carico TUTTI i peer del gruppo (anche stessa rete) per poter sempre indicare
    // il primary nei dati restituiti. Filtro out questo host stesso più sotto.
    const peers = db().prepare(
      `SELECT ml.group_id, h.id as host_id, h.ip, n.name as network_name, ml.is_primary
       FROM multihomed_links ml
       JOIN hosts h ON h.id = ml.host_id
       JOIN networks n ON n.id = h.network_id
       WHERE ml.group_id IN (${placeholders})`
    ).all(...groupIds) as Array<{ group_id: string; host_id: number; ip: string; network_name: string; is_primary: number }>;
    for (const p of peers) {
      if (!peersByGroup.has(p.group_id)) peersByGroup.set(p.group_id, []);
      peersByGroup.get(p.group_id)!.push({ ip: p.ip, network_name: p.network_name, host_id: p.host_id, is_primary: p.is_primary === 1 });
      if (p.is_primary === 1) primaryByGroup.set(p.group_id, { host_id: p.host_id, ip: p.ip });
    }
  }

  return hosts
    .sort((a, b) => ipToNum(a.ip) - ipToNum(b.ip))
    .map(({ _dev_id, _dev_name, _dev_sysname, _dev_vendor, _dev_protocol, _ad_dns, _mh_group, _mh_type, _mh_is_primary, ...h }) => {
      let multihomed = null;
      if (_mh_group && peersByGroup.has(_mh_group)) {
        const allPeers = peersByGroup.get(_mh_group)!;
        const otherPeers = allPeers.filter((p) => p.host_id !== h.id);
        const primary = primaryByGroup.get(_mh_group) ?? null;
        multihomed = {
          group_id: _mh_group,
          match_type: _mh_type ?? "hostname",
          is_primary: _mh_is_primary === 1,
          primary_host_id: primary?.host_id ?? null,
          primary_ip: primary?.ip ?? null,
          peers: otherPeers,
        };
      }
      return {
        ...h,
        device_id: _dev_id ?? undefined,
        device: _dev_id ? { id: _dev_id, name: _dev_name!, sysname: _dev_sysname ?? null, vendor: _dev_vendor!, protocol: _dev_protocol! } : undefined,
        ad_dns_host_name: _ad_dns ?? undefined,
        multihomed,
      };
    });
}

export function getKnownHosts(networkId?: number | null): Host[] {
  if (networkId != null) {
    return db().prepare("SELECT * FROM hosts WHERE known_host = 1 AND network_id = ?").all(networkId) as Host[];
  }
  return db().prepare("SELECT * FROM hosts WHERE known_host = 1").all() as Host[];
}

export function getHostByMac(mac: string, preferIp?: string): Host | undefined {
  const hex = macToHex(mac);
  if (hex.length < 12) return undefined;
  // MAC NON è unique in hosts (multi-homed / VRRP-HSRP / VM clone): un LIMIT 1
  // senza ORDER BY restituiva una riga ARBITRARIA → Wazuh attribuiva CVE/software
  // all'host sbagliato (fix B4 2026-06-23). Disambigua con l'IP se fornito,
  // altrimenti ritorna il match deterministico (id minore).
  const rows = db().prepare(`SELECT * FROM hosts WHERE ${MAC_HEX("mac")} = ? ORDER BY id`).all(hex) as Host[];
  if (rows.length <= 1) return rows[0];
  if (preferIp) {
    const exact = rows.find((r) => r.ip === preferIp);
    if (exact) return exact;
  }
  return rows[0];
}

export function resolveMacToNetworkDevice(mac: string, excludeDeviceId?: number): { device_id: number; device_name: string; device_type: string } | null {
  let ip: string | null = null;
  const host = getHostByMac(mac);
  if (host) ip = host.ip;
  if (!ip) {
    const hex = macToHex(mac);
    const arp = db().prepare(
      `SELECT ip FROM arp_entries WHERE ${MAC_HEX("mac")} = ? AND ip IS NOT NULL ORDER BY timestamp DESC LIMIT 1`
    ).get(hex) as { ip: string } | undefined;
    ip = arp?.ip ?? null;
  }
  if (!ip) return null;
  const nd = db().prepare(
    "SELECT id, name, device_type FROM network_devices WHERE host = ? AND (enabled = 1 OR enabled IS NULL)"
  ).get(ip) as { id: number; name: string; device_type: string } | undefined;
  if (!nd || (excludeDeviceId != null && nd.id === excludeDeviceId)) return null;
  return { device_id: nd.id, device_name: nd.name, device_type: nd.device_type };
}

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
  const arp = db().prepare(
    `SELECT ip FROM arp_entries WHERE ${MAC_HEX("mac")} = ? AND ip IS NOT NULL ORDER BY timestamp DESC LIMIT 1`
  ).get(hex) as { ip: string } | undefined;
  if (arp?.ip) {
    return { ip: arp.ip, hostname: null, vendor: null, host_id: null };
  }
  const mapping = db().prepare(
    "SELECT ip, hostname, vendor, host_id FROM mac_ip_mapping WHERE mac_normalized = ?"
  ).get(hex) as { ip: string; hostname: string | null; vendor: string | null; host_id: number | null } | undefined;
  return {
    ip: mapping?.ip ?? null,
    hostname: mapping?.hostname ?? null,
    vendor: mapping?.vendor ?? null,
    host_id: mapping?.host_id ?? null,
  };
}

export function getHostBasic(
  id: number
): Pick<Host, "id" | "ip" | "custom_name" | "hostname" | "vendor" | "device_manufacturer"> | undefined {
  return db()
    .prepare("SELECT id, ip, custom_name, hostname, vendor, device_manufacturer FROM hosts WHERE id = ?")
    .get(id) as Pick<Host, "id" | "ip" | "custom_name" | "hostname" | "vendor" | "device_manufacturer"> | undefined;
}

/**
 * Stato di raggiungibilità degli host scansionati per un insieme di IP, in una
 * sola query (a blocchi, per il limite di parametri di SQLite). Se lo stesso IP
 * sta in più reti vince l'host visto più di recente. Serve alla lista
 * Dispositivi, che prima mostrava "Online" per ogni dispositivo abilitato in
 * anagrafica (difetto UI-8, analisi 2026-10-12). Gli IP senza host non compaiono.
 */
export function getHostStatusesByIp(ips: string[]): Map<string, { status: string; last_seen: string | null }> {
  const stati = new Map<string, { status: string; last_seen: string | null }>();
  const unici = [...new Set(ips.filter((ip) => ip && ip.trim()))];
  for (let i = 0; i < unici.length; i += 500) {
    const blocco = unici.slice(i, i + 500);
    const righe = db()
      .prepare(
        `SELECT ip, status, last_seen FROM hosts WHERE ip IN (${blocco.map(() => "?").join(",")})
         ORDER BY last_seen DESC`
      )
      .all(...blocco) as { ip: string; status: string; last_seen: string | null }[];
    for (const r of righe) {
      if (!stati.has(r.ip)) stati.set(r.ip, { status: r.status, last_seen: r.last_seen });
    }
  }
  return stati;
}

export function getHostByIp(ip: string): Host | undefined {
  return db().prepare("SELECT * FROM hosts WHERE ip = ? LIMIT 1").get(ip) as Host | undefined;
}

export function getHostById(id: number): HostDetail | undefined {
  const host = db().prepare(`
    SELECT h.*, n.cidr as network_cidr, n.name as network_name
    FROM hosts h
    JOIN networks n ON n.id = h.network_id
    WHERE h.id = ?
  `).get(id) as (Host & { network_cidr: string; network_name: string }) | undefined;

  if (!host) return undefined;

  const recentScans = db().prepare(
    "SELECT * FROM scan_history WHERE host_id = ? ORDER BY timestamp DESC LIMIT 50"
  ).all(id) as ScanHistory[];

  const arpSource = host.mac ? db().prepare(`
    SELECT nd.name as device_name, nd.vendor as device_vendor, ae.timestamp as last_query
    FROM arp_entries ae
    JOIN network_devices nd ON nd.id = ae.device_id
    WHERE ${MAC_HEX("ae.mac")} = ? AND nd.device_type = 'router'
    ORDER BY ae.timestamp DESC LIMIT 1
  `).get(macToHex(host.mac)) as { device_name: string; device_vendor: string; last_query: string } | undefined : undefined;

  // Tie-breaker MAX(rowid), NON timestamp (fix D1 2026-06-23): (mac,timestamp)
  // non è unique e datetime('now') ha risoluzione 1s → lo stesso MAC su più
  // switch nello stesso scan dava una porta ARBITRARIA che cambiava a ogni
  // refresh (es. porta trunk del core invece dell'access). rowid è monotono.
  const switchPort = host.mac ? db().prepare(`
    SELECT nd.name as device_name, nd.vendor as device_vendor, mpe.port_name, mpe.vlan
    FROM mac_port_entries mpe
    JOIN network_devices nd ON nd.id = mpe.device_id
    WHERE ${MAC_HEX("mpe.mac")} = ? AND nd.device_type = 'switch'
    -- Topologia fase 2: le righe si aggiornano sul posto, il rowid non dice più
    -- «la lettura più recente»; il timestamp sì (rowid solo a parità).
    ORDER BY mpe.timestamp DESC, mpe.rowid DESC LIMIT 1
  `).get(macToHex(host.mac)) as { device_name: string; device_vendor: string; port_name: string; vlan: number | null } | undefined : undefined;

  // F4: prefer FK lookup (network_devices.host_id) over fragile IP string match;
  // fallback all'IP per compatibilità con device pre-migration che potrebbero avere
  // host_id NULL se il backfill non ha matchato (es. proxmox host="https://..."
  // anziché IP plain).
  const networkDevice = getNetworkDeviceByHostId(host.id) ?? getNetworkDeviceByHost(host.ip);

  const scanTypesSeen = [...new Set(recentScans.map((s) => s.scan_type))];

  // v0.2.603: include multihomed group info (peers + is_primary). Prima era
  // popolato solo dalla list discovery, /objects/[id] non lo riceveva → simbolo
  // multihomed sempre nascosto anche dopo manual link manualLinkHostsToPhysicalDevice.
  // Un apparato, una scheda da qualunque suo IP (specchio di db.ts).
  const cluster = networkDevice ? null : apparatoDelCluster(db(), host.id);
  const apparatoCluster = cluster?.esito === "cluster" ? cluster.apparato : null;

  const mhLink = db().prepare(
    "SELECT group_id, match_type, is_primary FROM multihomed_links WHERE host_id = ? LIMIT 1"
  ).get(id) as { group_id: string; match_type: string; is_primary: number } | undefined;
  let multihomed: {
    group_id: string;
    match_type: string;
    is_primary: boolean;
    primary_host_id: number | null;
    primary_ip: string | null;
    peers: Array<{ ip: string; network_name: string; host_id: number; is_primary: boolean }>;
  } | null = null;
  if (mhLink) {
    const peers = db().prepare(
      `SELECT ml.host_id, h.ip, n.name AS network_name, ml.is_primary
         FROM multihomed_links ml
         JOIN hosts h ON h.id = ml.host_id
         JOIN networks n ON n.id = h.network_id
        WHERE ml.group_id = ? AND ml.host_id != ?
        ORDER BY h.ip`
    ).all(mhLink.group_id, id) as Array<{ host_id: number; ip: string; network_name: string; is_primary: number }>;
    const primary = db().prepare(
      `SELECT ml.host_id, h.ip FROM multihomed_links ml
         JOIN hosts h ON h.id = ml.host_id
        WHERE ml.group_id = ? AND ml.is_primary = 1
        LIMIT 1`
    ).get(mhLink.group_id) as { host_id: number; ip: string } | undefined;
    multihomed = {
      group_id: mhLink.group_id,
      match_type: mhLink.match_type,
      is_primary: mhLink.is_primary === 1,
      primary_host_id: primary?.host_id ?? null,
      primary_ip: primary?.ip ?? null,
      peers: peers.map((p) => ({ host_id: p.host_id, ip: p.ip, network_name: p.network_name, is_primary: p.is_primary === 1 })),
    };
  }

  return {
    ...host,
    recent_scans: recentScans,
    scan_types_used: scanTypesSeen,
    host_credentials: getHostCredentials(id),
    arp_source: arpSource || null,
    switch_port: switchPort || null,
    network_device: networkDevice ? { id: networkDevice.id, name: networkDevice.name, sysname: networkDevice.sysname, vendor: networkDevice.vendor, protocol: networkDevice.protocol } : null,
    apparato_cluster: apparatoCluster,
    multihomed,
  };
}

export function mergeOpenPortsJson(existing: string | null, incoming: string): string {
  const toMap = (ports: PortEntry[]): Map<string, PortEntry> => {
    const map = new Map<string, PortEntry>();
    for (const p of ports) {
      const key = `${p.port}:${p.protocol}`;
      if (!map.has(key)) map.set(key, p);
    }
    return map;
  };
  const merged = toMap(parsePortsJson(existing));
  const incomingMap = toMap(parsePortsJson(incoming));
  for (const [k, v] of incomingMap) {
    merged.set(k, v);
  }
  return JSON.stringify([...merged.values()].sort((a, b) => a.port - b.port || String(a.protocol).localeCompare(b.protocol)));
}

export function upsertHost(input: HostInput & { mac?: string; vendor?: string; hostname?: string; hostname_source?: string; dns_forward?: string; dns_reverse?: string; status?: "online" | "offline" | "unknown"; open_ports?: string; open_ports_replace?: boolean; open_ports_replace_protocol?: "tcp" | "udp"; os_info?: string; model?: string; serial_number?: string; firmware?: string | null; device_manufacturer?: string | null; detection_json?: string | null; snmp_data?: string | null; preserve_existing?: boolean; bypassExclusion?: boolean }): Host | null {
  const existing = db().prepare(
    "SELECT id FROM hosts WHERE network_id = ? AND ip = ?"
  ).get(input.network_id, input.ip) as { id: number } | undefined;

  if (existing) {
    // v0.2.637 audit B3: aggiunti snmp_data/detection_json/vendor/hostname al
    // SELECT per poter confrontare i SIGNAL del classifier e gate-are la
    // chiamata a applyAutoClassification — vedi `shouldRecomputeClassification`.
    const existingRow = db().prepare(
      "SELECT open_ports, classification_manual, model, serial_number, firmware, device_manufacturer, os_info, mac, snmp_data, detection_json, vendor, hostname FROM hosts WHERE id = ?"
    ).get(existing.id) as { open_ports: string | null; classification_manual?: number; model?: string | null; serial_number?: string | null; firmware?: string | null; device_manufacturer?: string | null; os_info?: string | null; mac?: string | null; snmp_data?: string | null; detection_json?: string | null; vendor?: string | null; hostname?: string | null } | undefined;
    const classificationManual = existingRow?.classification_manual === 1;
    const preserve = input.preserve_existing === true;
    const fields: string[] = ["updated_at = datetime('now')"];
    const values: unknown[] = [];

    if (input.mac !== undefined) {
      fields.push("mac = ?");
      values.push(normalizeMacForStorage(input.mac) ?? null);
    }
    if (input.vendor !== undefined) { fields.push("vendor = ?"); values.push(input.vendor); }
    if (input.hostname !== undefined) {
      const HOSTNAME_PRIORITY: Record<string, number> = { manual: 6, dhcp: 5, glpi_agent: 5, snmp: 4, nmap: 3, dns: 2, arp: 1 };
      const existingSource = (db().prepare("SELECT hostname_source FROM hosts WHERE id = ?").get(existing.id) as { hostname_source?: string })?.hostname_source;
      const newPriority = HOSTNAME_PRIORITY[input.hostname_source ?? ""] ?? 0;
      const oldPriority = HOSTNAME_PRIORITY[existingSource ?? ""] ?? 0;
      if (newPriority >= oldPriority || !existingSource) {
        fields.push("hostname = ?"); values.push(input.hostname);
        if (input.hostname_source) { fields.push("hostname_source = ?"); values.push(input.hostname_source); }
      }
    }
    if (input.dns_forward !== undefined) { fields.push("dns_forward = ?"); values.push(input.dns_forward); }
    if (input.dns_reverse !== undefined) { fields.push("dns_reverse = ?"); values.push(input.dns_reverse); }
    if (input.status !== undefined) {
      fields.push("status = ?");
      values.push(input.status);
      if (input.status === "online") {
        fields.push("last_seen = datetime('now')");
      }
    }
    if (input.custom_name !== undefined) { fields.push("custom_name = ?"); values.push(input.custom_name); }
    // Catalogo canonico (21/10): lo slug passa da canonicalizza; il ruolo del server va in server_roles dopo l'UPDATE.
    let ruoloDaAggiungere: Canonica | null = null;
    const canonIn = input.classification !== undefined ? canonicalizza(input.classification) : null;
    if (input.classification !== undefined && canonIn && !classificationManual) {
      if (canonIn.classificazione !== "unknown") {
        ruoloDaAggiungere = canonIn;
        fields.push("classification = ?"); values.push(canonIn.classificazione);
      } else {
        const cur = (db().prepare("SELECT classification FROM hosts WHERE id = ?").get(existing.id) as { classification?: string })?.classification;
        if (!cur || cur === "unknown") {
          fields.push("classification = ?"); values.push(canonIn.classificazione);
        }
      }
    }
    if (input.inventory_code !== undefined) { fields.push("inventory_code = ?"); values.push(input.inventory_code); }
    if (input.notes !== undefined) { fields.push("notes = ?"); values.push(input.notes); }
    if (input.open_ports !== undefined) {
      let portsValue: string;
      if (input.open_ports_replace_protocol) {
        portsValue = mergeOpenPortsByProtocol(existingRow?.open_ports ?? null, input.open_ports, input.open_ports_replace_protocol);
      } else if (input.open_ports_replace) {
        portsValue = input.open_ports;
      } else {
        portsValue = mergeOpenPortsJson(existingRow?.open_ports ?? null, input.open_ports);
      }
      fields.push("open_ports = ?");
      values.push(portsValue);
    }
    if (input.os_info !== undefined) {
      if (!preserve || !existingRow?.os_info) { fields.push("os_info = ?"); values.push(input.os_info); }
    }
    // Un modello che è solo l'etichetta di un'impronta di porte (pilota 16/10: «QNAP QTS» su un
    // UniFi Cloud Gateway) non si preserva: il modello nuovo lo sostituisce, e una scansione con
    // l'impronta ma senza modello lo azzera. Gli altri modelli (a mano, SNMP, agenti) restano.
    const modelloDiPorte = modelloEtichettaDiPorte(existingRow?.model, [existingRow?.detection_json, input.detection_json]);
    if (input.model !== undefined) {
      if (!preserve || !existingRow?.model || modelloDiPorte) { fields.push("model = ?"); values.push(input.model); }
    } else if (modelloDiPorte && input.detection_json !== undefined) {
      fields.push("model = NULL");
    }
    if (input.serial_number !== undefined) {
      if (!preserve || !existingRow?.serial_number) { fields.push("serial_number = ?"); values.push(input.serial_number); }
    }
    if (input.firmware !== undefined) {
      if (!preserve || !existingRow?.firmware) { fields.push("firmware = ?"); values.push(input.firmware); }
    }
    if (input.device_manufacturer !== undefined) {
      if (!preserve || !existingRow?.device_manufacturer) { fields.push("device_manufacturer = ?"); values.push(input.device_manufacturer); }
    }
    if (input.snmp_data !== undefined) { fields.push("snmp_data = ?"); values.push(input.snmp_data); }
    if (input.detection_json !== undefined) {
      let shouldUpdate = true;
      if (input.detection_json && !input.open_ports_replace) {
        try {
          const incoming = JSON.parse(input.detection_json) as { final_confidence?: number; open_ports?: number[] };
          const existingDet = (db().prepare("SELECT detection_json FROM hosts WHERE id = ?").get(existing.id) as { detection_json?: string | null })?.detection_json;
          if (existingDet) {
            const prev = JSON.parse(existingDet) as { final_confidence?: number; open_ports?: number[] };
            const prevPorts = prev.open_ports?.length ?? 0;
            const newPorts = incoming.open_ports?.length ?? 0;
            if (prevPorts > newPorts && (prev.final_confidence ?? 0) > (incoming.final_confidence ?? 0)) {
              shouldUpdate = false;
            }
          }
        } catch { /* parse error → update anyway */ }
      }
      if (shouldUpdate) { fields.push("detection_json = ?"); values.push(input.detection_json); }
    }

    values.push(existing.id);
    db().prepare(`UPDATE hosts SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    if (ruoloDaAggiungere) aggiungiRuoloServer(db(), "hosts", existing.id, ruoloDaAggiungere);
    const host = db().prepare("SELECT * FROM hosts WHERE id = ?").get(existing.id) as Host;
    if (host.mac && input.ip) {
      upsertMacIpMapping({
        mac: host.mac,
        ip: input.ip,
        source: "host",
        network_id: input.network_id,
        host_id: host.id,
        vendor: host.vendor ?? undefined,
        hostname: host.hostname ?? undefined,
      });
    }
    if (input.mac !== undefined && host.mac && existing) {
      const duplicate = db().prepare(
        "SELECT id, ip FROM hosts WHERE network_id = ? AND mac = ? AND id != ?"
      ).get(input.network_id, host.mac, existing.id) as { id: number; ip: string } | undefined;
      if (duplicate) {
        db().prepare("UPDATE hosts SET conflict_flags = ? WHERE id = ?")
          .run(`mac_duplicate:${duplicate.ip}`, existing.id);
        db().prepare("UPDATE hosts SET conflict_flags = ? WHERE id = ?")
          .run(`mac_duplicate:${input.ip}`, duplicate.id);
      }
    }
    if (input.mac !== undefined) {
      const prevHex = macToHex(existingRow?.mac ?? "");
      const newHex = macToHex(host.mac ?? "");
      if (prevHex !== newHex) {
        syncIpAssignmentsForNetwork(input.network_id);
      }
    }
    // v0.2.637 audit B3: ricomputo SOLO se cambia un signal rilevante. Prima
    // `applyAutoClassification` veniva chiamato a ogni upsert — quindi anche
    // su passaggi `status=online ↔ offline` da fast_scan/ping → migliaia di
    // UPDATE+ricalcoli inutili al minuto. Gate con shouldRecomputeClassification
    // (preservato dall'audit, i segnali rilevanti non cambiano con l'engine).
    // Fase 4: applyAutoClassification (legacy) rimosso — un solo scrittore
    // (attribution v2, vedi src/lib/attribution/). recomputeAttributionSafe
    // emette evidenza dai segnali già in DB e proietta classification/inferred_*.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { shouldRecomputeClassification } = require("./devices/auto-classify");
      const changedSignals = new Set<string>();
      if (input.open_ports !== undefined && input.open_ports !== existingRow?.open_ports) changedSignals.add("open_ports");
      if (input.snmp_data !== undefined && input.snmp_data !== existingRow?.snmp_data) changedSignals.add("snmp_data");
      if (input.device_manufacturer !== undefined && input.device_manufacturer !== existingRow?.device_manufacturer) changedSignals.add("device_manufacturer");
      if (input.hostname !== undefined && input.hostname !== existingRow?.hostname) changedSignals.add("hostname");
      if (input.vendor !== undefined && input.vendor !== existingRow?.vendor) changedSignals.add("vendor");
      if (input.detection_json !== undefined && input.detection_json !== existingRow?.detection_json) changedSignals.add("detection_json");
      if (input.os_info !== undefined && input.os_info !== existingRow?.os_info) changedSignals.add("os_info");
      if (shouldRecomputeClassification(changedSignals)) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { recomputeAttributionSafe } = require("@/lib/attribution/recompute") as typeof import("@/lib/attribution/recompute");
        recomputeAttributionSafe(host.id, "scan");
      }
    } catch { /* non blocca l'upsert se il recompute fallisce */ }
    // F4 v0.2.597: reverse trigger — se esiste un network_device con host = IP
    // dell'host appena aggiornato e host_id NULL, lo collega ora (caso tipico:
    // device creato manualmente prima che l'host fosse scoperto via discovery).
    try {
      db().prepare(
        "UPDATE network_devices SET host_id = ?, updated_at = datetime('now') WHERE host_id IS NULL AND host = ?"
      ).run(host.id, host.ip);
    } catch { /* niente */ }
    return host;
  }

  // INSERT branch: l'host non esiste. L'IP potrebbe essere in blacklist (tombstone post-delete).
  // - Senza bypassExclusion (chiamate passive / generiche): blocca l'insert.
  // - Con bypassExclusion (probe attivo ICMP-confermato, creazione manuale): l'IP risponde
  //   davvero → device nuovo con stesso IP, rimuoviamo il tombstone e procediamo.
  if (isIpExcluded(input.network_id, input.ip)) {
    if (!input.bypassExclusion) {
      return null;
    }
    try {
      db().prepare("DELETE FROM excluded_ips WHERE network_id = ? AND ip = ?")
        .run(input.network_id, input.ip);
    } catch { /* ignore */ }
  }

  const stmt = db().prepare(`
    INSERT INTO hosts (network_id, ip, mac, vendor, hostname, hostname_source, dns_forward, dns_reverse, custom_name, classification, inventory_code, notes, status, open_ports, os_info, model, serial_number, firmware, device_manufacturer, detection_json, snmp_data, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${input.status === "online" ? "datetime('now')" : "NULL"}, ${input.status === "online" ? "datetime('now')" : "NULL"})
  `);
  const result = stmt.run(
    input.network_id,
    input.ip,
    normalizeMacForStorage(input.mac ?? "") ?? null,
    input.vendor || null,
    input.hostname || null,
    input.hostname_source || null,
    input.dns_forward || null,
    input.dns_reverse || null,
    input.custom_name || null,
    canonicalizza(input.classification).classificazione,
    input.inventory_code || null,
    input.notes || "",
    input.status || "unknown",
    (input as { open_ports?: string }).open_ports || null,
    (input as { os_info?: string }).os_info || null,
    (input as { model?: string }).model || null,
    (input as { serial_number?: string }).serial_number || null,
    (input as { firmware?: string | null }).firmware ?? null,
    (input as { device_manufacturer?: string | null }).device_manufacturer ?? null,
    (input as { detection_json?: string | null }).detection_json ?? null,
    (input as { snmp_data?: string | null }).snmp_data ?? null
  );
  aggiungiRuoloServer(db(), "hosts", Number(result.lastInsertRowid), canonicalizza(input.classification));
  const host = db().prepare("SELECT * FROM hosts WHERE id = ?").get(result.lastInsertRowid) as Host;
  if (host.mac && input.ip) {
    upsertMacIpMapping({
      mac: host.mac,
      ip: input.ip,
      source: "host",
      network_id: input.network_id,
      host_id: host.id,
      vendor: host.vendor ?? undefined,
      hostname: host.hostname ?? undefined,
    });
  }
  // F1: prima attribuzione all'insert. Fase 4: applyAutoClassification
  // (legacy) rimosso — recomputeAttributionSafe emette evidenza dai segnali
  // già scritti sopra e proietta classification/inferred_* (un solo scrittore).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { recomputeAttributionSafe } = require("@/lib/attribution/recompute") as typeof import("@/lib/attribution/recompute");
    recomputeAttributionSafe(host.id, "scan");
  } catch { /* non blocca l'insert se il recompute fallisce */ }
  // F4 v0.2.597: reverse trigger anche nel branch INSERT (host nuovo) — un device
  // potrebbe già esistere col suo IP e attendere il host_id.
  try {
    db().prepare(
      "UPDATE network_devices SET host_id = ?, updated_at = datetime('now') WHERE host_id IS NULL AND host = ?"
    ).run(host.id, host.ip);
  } catch { /* niente */ }
  return host;
}

// Snapshot dei segnali di un host già persistiti (nessun probe): input puro per gli
// emettitori di src/lib/attribution/emitters.ts.
export interface AttributionSignals {
  host: {
    id: number; ip: string; mac: string | null; vendor: string | null;
    hostname: string | null; os_info: string | null; open_ports: string | null;
    snmp_data: string | null; detection_json: string | null;
  };
  adComputer: { operating_system: string | null; operating_system_version: string | null } | null;
  wazuh: { os_platform: string | null; os_name: string | null; os_version: string | null; board_vendor: string | null } | null;
  neighborSightings: Array<{ protocol: string; remote_platform: string | null; remote_device_name: string }>;
}

export function getAttributionSignalsForHost(hostId: number): AttributionSignals | null {
  const d = db();
  const host = d.prepare(
    `SELECT id, ip, mac, vendor, hostname, os_info, open_ports, snmp_data, detection_json
     FROM hosts WHERE id = ?`
  ).get(hostId) as AttributionSignals["host"] | undefined;
  if (!host) return null;
  const adComputer = d.prepare(
    `SELECT operating_system, operating_system_version FROM ad_computers
     WHERE host_id = ? ORDER BY synced_at DESC LIMIT 1`
  ).get(hostId) as AttributionSignals["adComputer"] ?? null;
  const wazuh = d.prepare(
    `SELECT wo.os_platform, wo.os_name, wo.os_version, wh.board_vendor
     FROM wazuh_agent wa
     LEFT JOIN wazuh_os wo ON wo.agent_id = wa.agent_id
     LEFT JOIN wazuh_hw wh ON wh.agent_id = wa.agent_id
     WHERE wa.host_id = ? LIMIT 1`
  ).get(hostId) as AttributionSignals["wazuh"] ?? null;
  const neighborSightings = d.prepare(
    `SELECT dn.protocol, dn.remote_platform, dn.remote_device_name
     FROM device_neighbors dn, hosts h
     WHERE h.id = ?
       AND ((dn.remote_mac IS NOT NULL AND dn.remote_mac = h.mac)
         OR (dn.remote_ip IS NOT NULL AND dn.remote_ip = h.ip))
       AND ${NEIGHBORS_LATEST_ROUND_SQL}
       AND ${NEIGHBORS_MODEL_SOURCES_SQL}
     ORDER BY dn.timestamp DESC LIMIT 5`
  ).all(hostId) as AttributionSignals["neighborSightings"];
  return { host, adComputer, wazuh, neighborSightings };
}

/**
 * Ririsolve `hosts.vendor` dal MAC per gli host il cui vendor è assente o è
 * ancora un placeholder scritto a scan-time da una vecchia catena di
 * risoluzione (es. "IEEE Registration Authority" da oui-data, prima che la KB
 * vendorizzata — 57.778 prefissi incl. MA-M/28 e MA-S/36 — fosse disponibile).
 * Caso reale: VM 533/tenant 70791 dopo il deploy KB v0.3.236, 16 host restati
 * bloccati sul placeholder finché non venissero riscansionati — il ricalcolo
 * attribuzione legge `hosts.vendor` così com'è e non rifà da solo il lookup.
 *
 * Passo di risoluzione riusabile (non solo dal CLI): un solo lookup MAC→vendor
 * per host, via `lookupVendorSync` (stesso ordine custom_oui → KB → oui-data
 * usato a scan-time), scritto SOLO se il risultato è diverso ed è a sua volta
 * un produttore reale (non un placeholder). Non tocca altri campi. Non lancia
 * mai: un errore sul singolo host viene loggato e contato in `unresolved`,
 * senza abortire il giro sugli altri host.
 */
export function refreshHostVendorsFromMac(
  networkId?: number
): { examined: number; updated: number; unresolved: number } {
  const d = db();
  const rows = (
    networkId != null
      ? d.prepare(
          "SELECT id, mac, vendor FROM hosts WHERE network_id = ? AND mac IS NOT NULL AND mac != ''"
        ).all(networkId)
      : d.prepare(
          "SELECT id, mac, vendor FROM hosts WHERE mac IS NOT NULL AND mac != ''"
        ).all()
  ) as Array<{ id: number; mac: string; vendor: string | null }>;

  const candidates = rows.filter(
    (r) => !r.vendor || VENDOR_PLACEHOLDER_RE.test(r.vendor.trim())
  );

  const result = { examined: candidates.length, updated: 0, unresolved: 0 };
  const updateStmt = d.prepare(
    "UPDATE hosts SET vendor = ? WHERE id = ?"
  );

  const run = d.transaction((items: typeof candidates) => {
    for (const row of items) {
      try {
        const resolved = lookupVendorSync(row.mac);
        if (!resolved || VENDOR_PLACEHOLDER_RE.test(resolved.trim())) {
          result.unresolved += 1;
          continue;
        }
        if (resolved === row.vendor) continue;
        updateStmt.run(resolved, row.id);
        result.updated += 1;
      } catch (err) {
        result.unresolved += 1;
        console.error(`[refreshHostVendorsFromMac] host ${row.id} (mac ${row.mac}) fallito:`, err instanceof Error ? err.message : String(err));
      }
    }
  });
  run(candidates);

  return result;
}

export function updateHost(id: number, input: HostUpdate): Host | undefined {
  const prevForMac =
    input.mac !== undefined
      ? (db().prepare("SELECT network_id, mac FROM hosts WHERE id = ?").get(id) as
          | { network_id: number; mac: string | null }
          | undefined)
      : undefined;

  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.custom_name !== undefined) { fields.push("custom_name = ?"); values.push(input.custom_name); }
  const canonManuale = input.classification !== undefined ? canonicalizza(input.classification) : null;
  if (input.classification !== undefined && canonManuale) {
    fields.push("classification = ?");
    values.push(canonManuale.classificazione);
    fields.push("classification_manual = 1");
  }
  if (input.inventory_code !== undefined) { fields.push("inventory_code = ?"); values.push(input.inventory_code); }
  if (input.notes !== undefined) { fields.push("notes = ?"); values.push(input.notes); }
  if (input.mac !== undefined) { fields.push("mac = ?"); values.push(normalizeMacForStorage(input.mac) ?? null); }
  if (input.known_host !== undefined) { fields.push("known_host = ?"); values.push(input.known_host); }
  if (input.monitor_ports !== undefined) { fields.push("monitor_ports = ?"); values.push(input.monitor_ports); }
  if (input.device_manufacturer !== undefined) { fields.push("device_manufacturer = ?"); values.push(input.device_manufacturer); }
  // v0.2.605: editing manuale anagrafica device da scheda asset
  if (input.serial_number !== undefined) { fields.push("serial_number = ?"); values.push(input.serial_number || null); }
  if (input.model !== undefined) { fields.push("model = ?"); values.push(input.model || null); }
  if (input.firmware !== undefined) { fields.push("firmware = ?"); values.push(input.firmware || null); }
  if (input.ip_assignment !== undefined) { fields.push("ip_assignment = ?"); values.push(input.ip_assignment); }
  if (input.status !== undefined) {
    fields.push("status = ?");
    values.push(input.status);
    if (input.status === "online") {
      fields.push("last_seen = datetime('now')");
    }
  }

  if (fields.length === 0) return db().prepare("SELECT * FROM hosts WHERE id = ?").get(id) as Host | undefined;

  fields.push("updated_at = datetime('now')");
  values.push(id);

  db().prepare(`UPDATE hosts SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  if (canonManuale) aggiungiRuoloServer(db(), "hosts", id, canonManuale);
  const updated = db().prepare("SELECT * FROM hosts WHERE id = ?").get(id) as Host | undefined;
  if (input.mac !== undefined && prevForMac && updated) {
    if (macToHex(prevForMac.mac ?? "") !== macToHex(updated.mac ?? "")) {
      syncIpAssignmentsForNetwork(prevForMac.network_id);
    }
  }
  return updated;
}

export function deleteHost(id: number, options?: { reason?: string; excludedBy?: string | null; skipExclusion?: boolean }): boolean {
  const d = db();
  const row = d.prepare("SELECT network_id, ip FROM hosts WHERE id = ?").get(id) as { network_id: number; ip: string } | undefined;
  const changes = d.prepare("DELETE FROM hosts WHERE id = ?").run(id).changes;
  if (changes > 0 && row && !options?.skipExclusion) {
    try {
      d.prepare(
        "INSERT OR IGNORE INTO excluded_ips (network_id, ip, reason, excluded_by) VALUES (?, ?, ?, ?)"
      ).run(row.network_id, row.ip, options?.reason ?? "host_deleted", options?.excludedBy ?? null);
    } catch { /* tabella mancante su DB pre-migrazione: ignora */ }
  }
  return changes > 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// excluded_ips — tombstone IP esclusi
// ═══════════════════════════════════════════════════════════════════════════

export function isIpExcluded(networkId: number, ip: string): boolean {
  try {
    const row = db()
      .prepare("SELECT 1 FROM excluded_ips WHERE network_id = ? AND ip = ? LIMIT 1")
      .get(networkId, ip);
    return !!row;
  } catch {
    return false;
  }
}

export function addToExcludedIps(networkId: number, ip: string, reason?: string | null, excludedBy?: string | null): void {
  db()
    .prepare(
      "INSERT OR IGNORE INTO excluded_ips (network_id, ip, reason, excluded_by) VALUES (?, ?, ?, ?)"
    )
    .run(networkId, ip, reason ?? null, excludedBy ?? null);
}

export function removeFromExcludedIps(networkId: number, ip: string): boolean {
  return db()
    .prepare("DELETE FROM excluded_ips WHERE network_id = ? AND ip = ?")
    .run(networkId, ip).changes > 0;
}

export function getExcludedIps(networkId?: number): ExcludedIpWithNetwork[] {
  const where = networkId != null ? "WHERE e.network_id = ?" : "";
  const params = networkId != null ? [networkId] : [];
  return db()
    .prepare(
      `SELECT e.*, n.name AS network_name, n.cidr AS network_cidr
       FROM excluded_ips e
       JOIN networks n ON n.id = e.network_id
       ${where}
       ORDER BY e.excluded_at DESC`
    )
    .all(...params) as ExcludedIpWithNetwork[];
}

/**
 * UPDATE-only: aggiorna solo host già esistenti (network_id+ip). MAI inserisce.
 * Da usare nelle fonti passive (ARP/DHCP/AD/DNS): vedi commento in db.ts.
 */
export function updateHostIfExists(input: HostInput & { mac?: string; vendor?: string; hostname?: string; hostname_source?: string; dns_forward?: string; dns_reverse?: string; status?: "online" | "offline" | "unknown"; os_info?: string; model?: string; serial_number?: string; firmware?: string | null; device_manufacturer?: string | null }): Host | null {
  const existing = db()
    .prepare("SELECT id FROM hosts WHERE network_id = ? AND ip = ?")
    .get(input.network_id, input.ip) as { id: number } | undefined;
  if (!existing) return null;
  return upsertHost(input) as Host;
}

export function bulkUpdateHostsKnownHost(networkId: number, hostIds: number[], knownHost: 0 | 1): number {
  if (hostIds.length === 0) return 0;
  const placeholders = hostIds.map(() => "?").join(",");
  const stmt = db().prepare(
    `UPDATE hosts SET known_host = ?, updated_at = datetime('now') WHERE network_id = ? AND id IN (${placeholders})`
  );
  return stmt.run(knownHost, networkId, ...hostIds).changes;
}

export function bulkDeleteHosts(networkId: number, hostIds: number[], options?: { reason?: string; excludedBy?: string | null; skipExclusion?: boolean }): number {
  if (hostIds.length === 0) return 0;
  const d = db();
  const placeholders = hostIds.map(() => "?").join(",");
  let ips: string[] = [];
  if (!options?.skipExclusion) {
    ips = (d.prepare(`SELECT ip FROM hosts WHERE network_id = ? AND id IN (${placeholders})`)
      .all(networkId, ...hostIds) as { ip: string }[]).map((r) => r.ip);
  }
  const stmt = d.prepare(`DELETE FROM hosts WHERE network_id = ? AND id IN (${placeholders})`);
  const changes = stmt.run(networkId, ...hostIds).changes;
  if (changes > 0 && ips.length > 0) {
    try {
      const ins = d.prepare(
        "INSERT OR IGNORE INTO excluded_ips (network_id, ip, reason, excluded_by) VALUES (?, ?, ?, ?)"
      );
      d.transaction(() => {
        for (const ip of ips) ins.run(networkId, ip, options?.reason ?? "host_bulk_deleted", options?.excludedBy ?? null);
      })();
    } catch { /* tabella mancante: ignora */ }
  }
  return changes;
}

export function countHostsInNetwork(networkId: number, hostIds: number[]): number {
  if (hostIds.length === 0) return 0;
  const unique = [...new Set(hostIds)];
  const placeholders = unique.map(() => "?").join(",");
  const row = db()
    .prepare(`SELECT COUNT(*) AS c FROM hosts WHERE network_id = ? AND id IN (${placeholders})`)
    .get(networkId, ...unique) as { c: number };
  return row.c;
}

export function getKnownHostsWithNetwork(): KnownHostWithNetworkRow[] {
  return db()
    .prepare(
      `SELECT h.*, n.name AS network_name, n.cidr AS network_cidr
       FROM hosts h
       INNER JOIN networks n ON h.network_id = n.id
       WHERE h.known_host = 1
       ORDER BY n.name COLLATE NOCASE, h.ip`
    )
    .all() as KnownHostWithNetworkRow[];
}

/** Forma di `datetime('now')` di SQLite, la stessa di `hosts.last_seen`. */
const FORMA_DATA_SQLITE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * Ora del database del tenant, nella forma di `datetime('now')`: è l'inizio di un
 * giro di scansione, da confrontare come testo con `hosts.last_seen` (stesso
 * formato e stesso fuso, UTC). Un'ora presa da JavaScript (`toISOString`, col
 * «T») si confronterebbe male.
 */
export function oraDelDatabase(): string {
  const r = db().prepare("SELECT datetime('now') AS ora").get() as { ora: string };
  return r.ora;
}

/**
 * Filtro unico del passaggio a offline di fine giro (T3-20, INV-1/INV-2), usato
 * sia dalla lettura dei candidati sia dalla scrittura:
 * - solo gli IP scansionati dal giro che non hanno risposto;
 * - solo host non ancora offline (un host già offline non si riscrive: prima
 *   ogni giro ne aggiornava `updated_at`);
 * - solo host con `last_seen` nullo o anteriore all'inizio del giro: un host
 *   visto vivo dopo la partenza (da un altro giro, dal controllo degli host
 *   noti) non lo spegne un giro che non l'ha visto.
 */
const WHERE_OFFLINE =
  "network_id = ? AND (status IS NULL OR status <> 'offline') AND (last_seen IS NULL OR last_seen < ?)";

function candidatiOffline(
  networkId: number,
  onlineIps: readonly string[],
  scannedIps: readonly string[],
  startedAt: string,
): Array<{ id: number; ip: string }> {
  if (!FORMA_DATA_SQLITE.test(startedAt)) {
    throw new Error("Inizio del giro non valido: serve la forma di datetime('now') (AAAA-MM-GG hh:mm:ss)");
  }
  if (scannedIps.length === 0) return [];
  const online = new Set(onlineIps);
  const scansionati = new Set(scannedIps);
  const righe = db()
    .prepare(`SELECT id, ip FROM hosts WHERE ${WHERE_OFFLINE} ORDER BY id`)
    .all(networkId, startedAt) as Array<{ id: number; ip: string }>;
  return righe.filter((r) => scansionati.has(r.ip) && !online.has(r.ip));
}

/**
 * Host che il giro manderebbe offline, senza scrivere (T3-20). Stesso filtro di
 * `markHostsOffline`: le righe restituite sono quelle che cambierebbe.
 * @param startedAt inizio del giro, da `oraDelDatabase()`
 */
export function selectOfflineCandidates(
  networkId: number,
  onlineIps: readonly string[],
  scannedIps: readonly string[],
  startedAt: string,
): Array<{ id: number; ip: string }> {
  return candidatiOffline(networkId, onlineIps, scannedIps, startedAt);
}

/**
 * Host della rete non offline (online, `unknown` o senza stato) fra gli IP
 * scansionati: il denominatore della soglia offline (T3-21). Usa la stessa
 * idea di «non offline» del filtro dei candidati, così i candidati sono sempre
 * un sottoinsieme; gli host già offline non entrano nel conto.
 */
export function contaHostAttiviScansionati(networkId: number, scannedIps: readonly string[]): number {
  if (scannedIps.length === 0) return 0;
  const scansionati = new Set(scannedIps);
  const righe = db()
    .prepare("SELECT ip FROM hosts WHERE network_id = ? AND (status IS NULL OR status <> 'offline')")
    .all(networkId) as Array<{ ip: string }>;
  let n = 0;
  for (const r of righe) if (scansionati.has(r.ip)) n++;
  return n;
}

/**
 * Id degli host della rete divisi fra quelli di cui il giro ha scansionato l'IP
 * (`dentro`) e gli altri (`fuori`): il perimetro della soglia offline (T3-21,
 * revisione 3b).
 */
export function idHostScansionati(
  networkId: number,
  scannedIps: readonly string[],
): { dentro: number[]; fuori: number[] } {
  const scansionati = new Set(scannedIps);
  const righe = db().prepare("SELECT id, ip FROM hosts WHERE network_id = ?").all(networkId) as Array<{
    id: number;
    ip: string;
  }>;
  const dentro: number[] = [];
  const fuori: number[] = [];
  for (const r of righe) (scansionati.has(r.ip) ? dentro : fuori).push(r.id);
  return { dentro, fuori };
}

/**
 * Marca offline gli host scansionati che non hanno risposto, col filtro di
 * `selectOfflineCandidates` (T3-20). Una lista di scansionati vuota non tocca
 * niente (prima valeva come «tutta la rete»). Restituisce quanti host ha
 * cambiato.
 * @param startedAt inizio del giro, da `oraDelDatabase()`
 */
export function markHostsOffline(
  networkId: number,
  onlineIps: readonly string[],
  scannedIps: readonly string[],
  startedAt: string,
): number {
  const d = db();
  return d.transaction((): number => {
    const ids = candidatiOffline(networkId, onlineIps, scannedIps, startedAt).map((r) => r.id);
    // 20/10: il passaggio a offline va anche nello storico, come i controlli degli host
    // noti; senza, grafico e transizioni non vedevano chi andava offline per una scansione.
    const storico = d.prepare("INSERT INTO status_history (host_id, status, response_time_ms) VALUES (?, 'offline', NULL)");
    let cambiati = 0;
    for (let i = 0; i < ids.length; i += 500) {
      const blocco = ids.slice(i, i + 500);
      const segnaposti = blocco.map(() => "?").join(",");
      const daCambiare = (d
        .prepare(`SELECT id FROM hosts WHERE id IN (${segnaposti}) AND ${WHERE_OFFLINE}`)
        .all(...blocco, networkId, startedAt) as { id: number }[]).map((r) => r.id);
      cambiati += d
        .prepare(
          `UPDATE hosts SET status = 'offline', updated_at = datetime('now')
           WHERE id IN (${segnaposti}) AND ${WHERE_OFFLINE}`,
        )
        .run(...blocco, networkId, startedAt).changes;
      for (const id of daCambiare) storico.run(id);
    }
    return cambiati;
  })();
}

export function noteHostsNonResponding(
  networkId: number,
  onlineIps: string[],
  scannedIps: string[],
  scanType: string
): void {
  const onlineSet = new Set(onlineIps);
  const nonResponding = scannedIps.filter((ip) => !onlineSet.has(ip));
  if (nonResponding.length === 0) return;
  const dateStr = new Date().toISOString().slice(0, 10);
  const tag = `[${dateStr}] Non risposto (${scanType}) — verificare se eliminare`;
  const d = db();
  for (const ip of nonResponding) {
    const row = d.prepare(
      "SELECT id, notes FROM hosts WHERE network_id = ? AND ip = ?"
    ).get(networkId, ip) as { id: number; notes: string } | undefined;
    if (!row) continue;
    const existingNotes = row.notes ?? "";
    if (existingNotes.includes(`[${dateStr}]`)) continue;
    const updated = existingNotes.trim() ? `${existingNotes.trim()}\n${tag}` : tag;
    d.prepare(
      "UPDATE hosts SET notes = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(updated, row.id);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SCAN HISTORY
// ═══════════════════════════════════════════════════════════════════════════

export function addScanHistory(entry: Omit<ScanHistory, "id" | "timestamp">): void {
  db().prepare(
    `INSERT INTO scan_history (host_id, network_id, scan_type, status, ports_open, raw_output, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.host_id,
    entry.network_id,
    entry.scan_type,
    entry.status,
    entry.ports_open,
    entry.raw_output,
    entry.duration_ms
  );
}

export function getScanHistory(filters: { host_id?: number; network_id?: number; limit?: number }): ScanHistory[] {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.host_id) { conditions.push("host_id = ?"); values.push(filters.host_id); }
  if (filters.network_id) { conditions.push("network_id = ?"); values.push(filters.network_id); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters.limit || 100;

  return db().prepare(
    `SELECT * FROM scan_history ${where} ORDER BY timestamp DESC LIMIT ?`
  ).all(...values, limit) as ScanHistory[];
}

// Chiave fase acquisizione (spec §6.2) → scan_type multipli in scan_history che la alimentano.
export type ScanPhaseKey = "initial" | "nmap_deep" | "snmp" | "enrich" | "credentials";

// Mappa fase→scan_type. 'enrich' (ARP/DHCP/AD, endpoint scan_type="scan_enrich" in
// /api/scans/trigger) scrive ora "scan_enrich" in scan_history a fine esecuzione
// (fix 2026-07-27: prima non scriveva nulla → last_run sempre null in UI). Teniamo
// anche i tipi legacy 'arp'/'dhcp'/'dns' nell'OR nel caso esistano righe storiche o
// scritture dirette introdotte altrove.
const SCAN_PHASE_TYPES: Record<ScanPhaseKey, string[]> = {
  initial: ["scan_icmp", "scan_naabu", "network_discovery"],
  nmap_deep: ["scan_nmap_base", "nmap", "network_discovery"],
  snmp: ["scan_snmp_verify", "snmp", "network_discovery"],
  enrich: ["scan_enrich", "arp", "dhcp", "dns", "network_discovery"],
  credentials: ["credential_validate"],
};

export interface ScanPhaseStatus {
  key: ScanPhaseKey;
  last_run: string | null;
  stale: boolean;
}

const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export function getScanPhaseStatusForNetwork(networkId: number): ScanPhaseStatus[] {
  const rows = db().prepare(
    `SELECT scan_type, MAX(timestamp) t FROM scan_history WHERE network_id = ? GROUP BY scan_type`
  ).all(networkId) as Array<{ scan_type: string; t: string | null }>;
  const maxByType = new Map(rows.map((r) => [r.scan_type, r.t]));
  const now = Date.now();
  return (Object.keys(SCAN_PHASE_TYPES) as ScanPhaseKey[]).map((key) => {
    const types = SCAN_PHASE_TYPES[key];
    let lastRun: string | null = null;
    for (const t of types) {
      const v = maxByType.get(t);
      if (v && (lastRun === null || v > lastRun)) lastRun = v;
    }
    const stale = lastRun !== null && now - new Date(lastRun).getTime() > STALE_AFTER_MS;
    return { key, last_run: lastRun, stale };
  });
}

export interface AttributionCompleteness {
  total: number;
  level2: number;
  level1: number;
  none: number;
  suggestion: string | null;
}

export function getAttributionCompletenessForNetwork(networkId: number): AttributionCompleteness {
  const row = db().prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN attr_category LIKE '%.%' THEN 1 ELSE 0 END) AS level2,
       SUM(CASE WHEN attr_category IS NOT NULL AND attr_category != 'unknown' AND attr_category NOT LIKE '%.%' THEN 1 ELSE 0 END) AS level1
     FROM hosts WHERE network_id = ?`
  ).get(networkId) as { total: number; level2: number | null; level1: number | null };
  const total = row.total ?? 0;
  const level2 = row.level2 ?? 0;
  const level1 = row.level1 ?? 0;
  const none = total - level2 - level1;

  let suggestion: string | null = null;
  const snmpNeverRun = getScanPhaseStatusForNetwork(networkId).find((p) => p.key === "snmp")?.last_run == null;
  if (level1 + none > 0 && snmpNeverRun) {
    suggestion = `${level1 + none} host fermi al livello 1: esegui SNMP per distinguere AP da switch`;
  } else if (none > level2) {
    suggestion = `${none} host senza attribuzione: esegui la scansione iniziale`;
  }

  return { total, level2, level1, none, suggestion };
}

export interface CredentialCoverageRow {
  category: string;
  hosts: number;
  withValidCredential: number;
  expectedProtocol: string;
}

// Fase 4b Task 4 (spec §7.6): categoria attribuita → protocollo/i pertinenti
// per raggiungerla con credenziali. Solo le categorie con un protocollo
// "giusto" chiaro compaiono nella vista — le altre (peripheral.*, voip.*,
// power.*, iot.*, mobile.*, av.nvr/display/speaker) non hanno un protocollo
// di autenticazione bersaglio in questa fase e sono escluse deliberatamente
// (mostrare "nessun protocollo pertinente" sarebbe rumore, non un'evidenza
// utile). compute.server/hypervisor: BMC (redfish) è alternativo a OS
// (winrm/ssh) — qualunque delle tre soddisfa la copertura.
const CREDENTIAL_COVERAGE_PROTOCOLS: Record<string, readonly CredProtocol[]> = {
  network: ["snmp"],
  "network.router": ["snmp"],
  "network.switch": ["snmp"],
  "network.access_point": ["snmp"],
  "network.firewall": ["snmp"],
  "network.controller": ["snmp"],
  "network.modem": ["snmp"],
  "compute.workstation": ["winrm"],
  "compute.laptop": ["winrm"],
  "compute.server": ["winrm", "ssh", "redfish"],
  "compute.hypervisor": ["winrm", "ssh", "redfish"],
  "av.camera": ["onvif"],
  storage: ["ssh", "snmp"],
  "storage.nas": ["ssh", "snmp"],
  "storage.san": ["ssh", "snmp"],
  "storage.tape": ["ssh", "snmp"],
};

/**
 * Vista di copertura credenziali (§7.6): per ogni categoria attribuita con un
 * protocollo pertinente noto, conta quanti host in totale e quanti hanno
 * ALMENO una credenziale VALIDATA (`host_credentials.validated=1`) su uno dei
 * protocolli applicabili a quella categoria (es. compute.server: winrm O ssh
 * O redfish soddisfano la copertura). Loop bounded sul piccolo insieme fisso
 * di categorie mappate (non per-host): non è il pattern N+1 vietato dalle
 * regole DB, il numero di query è costante indipendentemente dal numero di
 * host. Non lancia mai (coerente col resto del modulo attribuzione): un
 * errore su una singola categoria la esclude dal risultato invece di far
 * fallire l'intera vista.
 */
export function getCredentialCoverageByCategory(): CredentialCoverageRow[] {
  const d = db();
  let categoryRows: Array<{ category: string; hosts: number }>;
  try {
    categoryRows = d
      .prepare(
        `SELECT attr_category AS category, COUNT(*) AS hosts
         FROM hosts
         WHERE attr_category IS NOT NULL AND attr_category != 'unknown'
         GROUP BY attr_category`
      )
      .all() as Array<{ category: string; hosts: number }>;
  } catch (e) {
    console.error("[db-tenant] getCredentialCoverageByCategory: query categorie fallita:", e);
    return [];
  }

  const out: CredentialCoverageRow[] = [];
  for (const row of categoryRows) {
    const protocols = CREDENTIAL_COVERAGE_PROTOCOLS[row.category];
    if (!protocols || protocols.length === 0) continue;
    try {
      const placeholders = protocols.map(() => "?").join(",");
      const withValid = d
        .prepare(
          `SELECT COUNT(*) AS n FROM hosts h
           WHERE h.attr_category = ? AND EXISTS (
             SELECT 1 FROM host_credentials hc
             WHERE hc.host_id = h.id AND hc.validated = 1 AND hc.protocol_type IN (${placeholders})
           )`
        )
        .get(row.category, ...protocols) as { n: number };
      out.push({
        category: row.category,
        hosts: row.hosts,
        withValidCredential: withValid.n ?? 0,
        expectedProtocol: protocols.join("/"),
      });
    } catch (e) {
      console.error(`[db-tenant] getCredentialCoverageByCategory: query copertura fallita per ${row.category}:`, e);
    }
  }

  return out.sort((a, b) => a.category.localeCompare(b.category));
}

// ═══════════════════════════════════════════════════════════════════════════
// NETWORK DEVICES
// ═══════════════════════════════════════════════════════════════════════════

export function getNetworkDevices(): NetworkDevice[] {
  return db().prepare("SELECT * FROM network_devices ORDER BY name").all() as NetworkDevice[];
}

/**
 * v0.2.661: sources DHCP effettive — qualunque network_device con almeno 1
 * lease in `dhcp_leases`. Include Mikrotik, Windows DHCP (auto-create da sync AD),
 * o altri (Cisco, OpenWRT, ecc). Sostituisce il filtro hardcoded
 * "vendor=mikrotik AND protocol=ssh" che escludeva Microsoft DHCP.
 */
export function getDhcpSources(): Array<{ id: number; name: string; host: string; vendor: string; type: string; lease_count: number; last_synced: string | null }> {
  return db().prepare(`
    SELECT nd.id, nd.name, nd.host, nd.vendor, d.source_type AS type,
           COUNT(d.id) AS lease_count,
           MAX(d.last_synced) AS last_synced
    FROM network_devices nd
    JOIN dhcp_leases d ON d.source_device_id = nd.id
    GROUP BY nd.id, nd.name, nd.host, nd.vendor, d.source_type
    ORDER BY lease_count DESC, nd.name ASC
  `).all() as Array<{ id: number; name: string; host: string; vendor: string; type: string; lease_count: number; last_synced: string | null }>;
}

export function getRouters(): NetworkDevice[] {
  return db().prepare("SELECT * FROM network_devices WHERE device_type = 'router' ORDER BY name").all() as NetworkDevice[];
}

/** Sorgenti ARP utilizzabili come "Router ARP default" di una subnet:
 *  qualsiasi device con use_for_arp_poll=1 (router, firewall, switch L3, ...).
 *  Fallback per record legacy: device_type='router' o vendor='stormshield'. */
export function getArpSourceDevices(): NetworkDevice[] {
  return db().prepare(
    `SELECT * FROM network_devices
     WHERE use_for_arp_poll = 1
        OR device_type IN ('router', 'firewall')
        OR vendor = 'stormshield'
     ORDER BY name`
  ).all() as NetworkDevice[];
}

export function getSwitches(): NetworkDevice[] {
  return db().prepare("SELECT * FROM network_devices WHERE device_type = 'switch' ORDER BY name").all() as NetworkDevice[];
}

export function getDevicesByClassification(classification: string): NetworkDevice[] {
  if (classification === "storage") {
    return db()
      .prepare("SELECT * FROM network_devices WHERE classification = 'nas' ORDER BY name")
      .all() as NetworkDevice[];
  }
  return db()
    .prepare("SELECT * FROM network_devices WHERE classification = ? ORDER BY name")
    .all(canonicalizza(classification).classificazione) as NetworkDevice[];
}

export function getDevicesByClassificationOrLegacy(classification: string): NetworkDevice[] {
  if (classification === "router") {
    // "Router" come pagina unificata di sorgenti ARP: include router, firewall e qualsiasi device
    // (anche switch L3) con use_for_arp_poll=1. Più i legacy device_type='router' senza classification.
    return db().prepare(
      `SELECT * FROM network_devices
       WHERE classification IN ('router', 'firewall')
          OR use_for_arp_poll = 1
          OR (device_type = 'router' AND (classification IS NULL OR classification = ''))
       ORDER BY name`
    ).all() as NetworkDevice[];
  }
  if (classification === "switch") {
    return db().prepare(
      "SELECT * FROM network_devices WHERE classification = 'switch' OR (device_type = 'switch' AND (classification IS NULL OR classification = '')) ORDER BY name"
    ).all() as NetworkDevice[];
  }
  return getDevicesByClassification(classification);
}

export function getHostsByClassification(classification: string): (Host & { network_name?: string })[] {
  if (classification === "storage") {
    return db()
      .prepare(
        `SELECT h.*, n.name as network_name FROM hosts h
         JOIN networks n ON n.id = h.network_id
         WHERE h.classification = 'nas' ORDER BY h.custom_name, h.hostname, h.ip`
      )
      .all() as (Host & { network_name?: string })[];
  }
  return db()
    .prepare(
      `SELECT h.*, n.name as network_name FROM hosts h
       JOIN networks n ON n.id = h.network_id
       WHERE h.classification = ? ORDER BY h.custom_name, h.hostname, h.ip`
    )
    .all(canonicalizza(classification).classificazione) as (Host & { network_name?: string })[];
}

export function getNetworkRouterId(networkId: number): number | null {
  const row = db().prepare("SELECT router_id FROM network_router WHERE network_id = ?").get(networkId) as { router_id: number } | undefined;
  return row?.router_id ?? null;
}

export function setNetworkRouter(networkId: number, routerId: number): void {
  db().prepare(
    "INSERT OR REPLACE INTO network_router (network_id, router_id) VALUES (?, ?)"
  ).run(networkId, routerId);
}

export function deleteNetworkRouter(networkId: number): void {
  db().prepare("DELETE FROM network_router WHERE network_id = ?").run(networkId);
}

export function getNetworkDeviceById(id: number): NetworkDevice | undefined {
  return db().prepare("SELECT * FROM network_devices WHERE id = ?").get(id) as NetworkDevice | undefined;
}

export function getNetworkDeviceByHost(ip: string): NetworkDevice | undefined {
  return db().prepare("SELECT * FROM network_devices WHERE host = ?").get(ip) as NetworkDevice | undefined;
}

/** F4: lookup device via FK host_id (più affidabile della string match su IP). */
export function getNetworkDeviceByHostId(hostId: number): NetworkDevice | undefined {
  return db().prepare("SELECT * FROM network_devices WHERE host_id = ? ORDER BY id LIMIT 1").get(hostId) as NetworkDevice | undefined;
}

/**
 * Salva la versione SNMP che la discovery ha visto rispondere. Non tocca gli
 * apparati con la versione fissata a mano né quelli che hanno già quel valore.
 * Restituisce la versione precedente se ha scritto, `undefined` se no.
 */
export function registraVersioneSnmpRilevata(deviceId: number, versione: "1" | "2c"): { prima: "1" | "2c" | null } | undefined {
  const row = db().prepare("SELECT snmp_version, snmp_version_fissata FROM network_devices WHERE id = ?").get(deviceId) as
    | { snmp_version: "1" | "2c" | null; snmp_version_fissata: number }
    | undefined;
  if (!row || row.snmp_version_fissata === 1 || row.snmp_version === versione) return undefined;
  db().prepare("UPDATE network_devices SET snmp_version = ?, updated_at = datetime('now') WHERE id = ? AND snmp_version_fissata = 0").run(versione, deviceId);
  return { prima: row.snmp_version };
}

type CreateDeviceInput = Omit<NetworkDevice, "id" | "created_at" | "updated_at" | "sysname" | "sysdescr" | "model" | "firmware" | "serial_number" | "part_number" | "last_info_update" | "last_device_info_json" | "classification" | "stp_info" | "last_proxmox_scan_at" | "last_proxmox_scan_result" | "scan_target" | "product_profile" | "use_for_arp_poll" | "voci_provvisorie"> & {
  classification?: string | null;
  scan_target?: string | null;
  product_profile?: string | null;
  use_for_arp_poll?: number | boolean | null;
  /** F4: opzionale — se non passato, lookup automatico via IP. */
  host_id?: number | null;
};

export function createNetworkDevice(input: CreateDeviceInput): NetworkDevice {
  // F4: auto-lookup host_id da IP se non passato esplicitamente. Best-effort:
  // se più reti hanno lo stesso IP, prendiamo il primo match (raro nei deploy reali).
  let hostId: number | null = input.host_id ?? null;
  if (hostId === null && input.host) {
    const match = db().prepare("SELECT id FROM hosts WHERE ip = ? ORDER BY id LIMIT 1").get(input.host) as { id: number } | undefined;
    if (match) hostId = match.id;
  }

  const classIn = (input as { classification?: string | null }).classification;
  const canonDev = classIn ? canonicalizza(classIn) : null;
  const stmt = db().prepare(
    `INSERT INTO network_devices (name, host, device_type, vendor, vendor_subtype, protocol, api_url, port, enabled, classification, scan_target, product_profile, use_for_arp_poll, host_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    input.name, input.host, input.device_type, input.vendor,
    input.vendor_subtype ?? null, input.protocol,
    // Le credenziali si legano dopo, coi binding d'archivio (T20): le colonne vecchie non si scrivono (T26).
    input.api_url, input.port, input.enabled,
    canonDev ? canonDev.classificazione : null,
    (input as { scan_target?: string | null }).scan_target ?? null,
    (input as { product_profile?: string | null }).product_profile ?? null,
    // use_for_arp_poll: rispetta il flag esplicito se fornito; altrimenti default
    // by-type (router/firewall/stormshield → 1). Evita il trap "router creato da un
    // percorso che non setta il flag → ARP poll mai eseguito" (incident 2026-06-20).
    ((): number => {
      const f = (input as { use_for_arp_poll?: number | boolean | null }).use_for_arp_poll;
      if (f === 1 || f === true) return 1;
      if (f === 0 || f === false) return 0;
      return input.device_type === "router" || input.device_type === "firewall" || input.vendor === "stormshield" ? 1 : 0;
    })(),
    hostId
  );
  if (canonDev) {
    aggiungiRuoloServer(db(), "network_devices", Number(result.lastInsertRowid), canonDev);
    impostaVendorSeVuoto(db(), Number(result.lastInsertRowid), canonDev);
  }
  return db().prepare("SELECT * FROM network_devices WHERE id = ?").get(result.lastInsertRowid) as NetworkDevice;
}

export function updateNetworkDevice(id: number, input: Partial<Omit<NetworkDevice, "id" | "created_at" | "updated_at">>): NetworkDevice | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];

  const keys = ["name", "host", "device_type", "vendor", "vendor_subtype", "protocol", "api_url", "port", "enabled", "classification", "sysname", "sysdescr", "model", "firmware", "serial_number", "part_number", "last_info_update", "last_device_info_json", "stp_info", "last_proxmox_scan_at", "last_proxmox_scan_result", "scan_target", "product_profile", "use_for_arp_poll", "host_id", "snmp_version", "snmp_version_fissata"] as const;
  let canonAgg: Canonica | null = null;
  for (const key of keys) {
    if (input[key] !== undefined) {
      fields.push(`${key} = ?`);
      // Catalogo canonico (21/10): la classificazione scritta è sempre quella canonica.
      if (key === "classification" && typeof input[key] === "string" && input[key]) {
        canonAgg = canonicalizza(input[key] as string);
        values.push(canonAgg.classificazione);
      } else {
        values.push(input[key]);
      }
    }
  }

  if (fields.length === 0) return getNetworkDeviceById(id);

  fields.push("updated_at = datetime('now')");
  values.push(id);
  db().prepare(`UPDATE network_devices SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  if (canonAgg) {
    aggiungiRuoloServer(db(), "network_devices", id, canonAgg);
    if (input.vendor === undefined) impostaVendorSeVuoto(db(), id, canonAgg);
  }
  return getNetworkDeviceById(id);
}

export function deleteNetworkDevice(id: number): boolean {
  return db().prepare("DELETE FROM network_devices WHERE id = ?").run(id).changes > 0;
}

// ========================
// Cleanup FK orfani (una volta per database)
// ========================

/**
 * Database già ripuliti in questo processo. Uno per database e non uno solo
 * per il processo: con la bandierina unica di `db.ts` sull'hub con più tenant
 * la pulizia avveniva sul primo tenant toccato e mai sugli altri (NUC-2).
 */
const fkCleanedDbs = new WeakSet<Database.Database>();

/**
 * Pulisce riferimenti FK orfani in mac_ip_mapping e dhcp_leases (causati da
 * migrazioni con foreign_keys=OFF). `target` serve alla facciata `db.ts`, che
 * lo chiama sul database che ha già risolto; senza, il tenant del contesto.
 */
export function cleanOrphanedForeignKeys(target?: Database.Database): void {
  const d = target ?? db();
  if (fkCleanedDbs.has(d)) return;
  d.prepare("UPDATE mac_ip_mapping SET source_device_id = NULL WHERE source_device_id IS NOT NULL AND source_device_id NOT IN (SELECT id FROM network_devices)").run();
  d.prepare("UPDATE mac_ip_mapping SET network_id = NULL WHERE network_id IS NOT NULL AND network_id NOT IN (SELECT id FROM networks)").run();
  d.prepare("UPDATE mac_ip_mapping SET host_id = NULL WHERE host_id IS NOT NULL AND host_id NOT IN (SELECT id FROM hosts)").run();
  d.prepare("UPDATE dhcp_leases SET host_id = NULL WHERE host_id IS NOT NULL AND host_id NOT IN (SELECT id FROM hosts)").run();
  d.prepare("UPDATE dhcp_leases SET network_id = NULL WHERE network_id IS NOT NULL AND network_id NOT IN (SELECT id FROM networks)").run();
  fkCleanedDbs.add(d);
}

export function getDevicesPaginated(
  page: number,
  pageSize: number,
  search?: string
): { data: NetworkDevice[]; total: number } {
  const offset = (page - 1) * pageSize;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (search && search.trim()) {
    const like = `%${search.trim()}%`;
    conditions.push("(name LIKE ? OR host LIKE ? OR vendor LIKE ? OR classification LIKE ?)");
    params.push(like, like, like, like);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const total = (db().prepare(`SELECT COUNT(*) as cnt FROM network_devices ${whereClause}`).get(...params) as { cnt: number }).cnt;

  const data = db().prepare(`
    SELECT * FROM network_devices ${whereClause} ORDER BY name LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset) as NetworkDevice[];

  return { data, total };
}

export function syncDeviceToHost(deviceId: number): void {
  const device = getNetworkDeviceById(deviceId);
  if (!device) return;

  const host = db().prepare("SELECT id, vendor, device_manufacturer FROM hosts WHERE ip = ? LIMIT 1")
    .get(device.host) as { id: number; vendor: string | null; device_manufacturer: string | null } | undefined;
  if (!host) return;

  // Parse last_device_info_json per campi estesi (manufacturer, os_name, os_version)
  let extInfo: Record<string, unknown> = {};
  if (device.last_device_info_json) {
    try { extInfo = JSON.parse(device.last_device_info_json); } catch { /* ignore */ }
  }

  const updates: string[] = ["updated_at = datetime('now')"];
  const values: unknown[] = [];

  if (device.model) { updates.push("model = ?"); values.push(device.model); }
  if (device.serial_number) { updates.push("serial_number = ?"); values.push(device.serial_number); }
  if (device.firmware) { updates.push("firmware = ?"); values.push(device.firmware); }
  if (device.sysname && !device.sysname.match(/^[\d.]+$/)) {
    updates.push("hostname = ?"); values.push(device.sysname);
    updates.push("hostname_source = ?"); values.push("snmp");
  }

  // OS info: preferisci os_name+os_version (WinRM/SSH) se presenti, altrimenti sysdescr
  const osName = typeof extInfo.os_name === "string" ? extInfo.os_name : null;
  const osVersion = typeof extInfo.os_version === "string" ? extInfo.os_version : null;
  if (osName) {
    updates.push("os_info = ?");
    values.push(osVersion ? `${osName} ${osVersion}` : osName);
  } else if (device.sysdescr) {
    updates.push("os_info = ?");
    values.push(device.sysdescr);
  }

  // Produttore: da device info > da SNMP manufacturer > fallback MAC vendor dell'host
  const mfr = typeof extInfo.manufacturer === "string" ? extInfo.manufacturer : null;
  const manufacturer = mfr || host.vendor || null;
  if (manufacturer && !host.device_manufacturer) {
    updates.push("device_manufacturer = ?");
    values.push(manufacturer);
  } else if (mfr) {
    // Se abbiamo un produttore specifico da SNMP/SSH/WinRM, sovrascrive sempre
    updates.push("device_manufacturer = ?");
    values.push(mfr);
  }

  if (values.length > 0) {
    values.push(host.id);
    db().prepare(`UPDATE hosts SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  }
}

export function trackDeviceInfoChanges(deviceId: number, newInfoObj: object): string[] {
  const device = getNetworkDeviceById(deviceId);
  if (!device || !device.last_device_info_json) return [];

  const newInfo = newInfoObj as Record<string, unknown>;
  let oldInfo: Record<string, unknown>;
  try { oldInfo = JSON.parse(device.last_device_info_json); } catch { return []; }

  const changes: string[] = [];
  const importantFields = ["firmware", "model", "serial_number", "os_name", "os_version", "hostname", "sysname", "sysdescr"];

  for (const field of importantFields) {
    const oldVal = oldInfo[field];
    const newVal = newInfo[field];
    if (newVal != null && oldVal != null && String(oldVal) !== String(newVal)) {
      changes.push(field);
    }
  }

  if (changes.length > 0) {
    const hostRow = db().prepare("SELECT id FROM hosts WHERE ip = ? LIMIT 1").get(device.host) as { id: number } | undefined;
    db().prepare(
      "INSERT INTO scan_history (host_id, network_id, scan_type, status, raw_output, duration_ms) VALUES (?, NULL, 'snmp', ?, ?, 0)"
    ).run(
      hostRow?.id ?? null,
      `device_info_changed: ${changes.join(", ")}`,
      JSON.stringify({ device_id: deviceId, device_name: device.name, changes: changes.map(f => ({ field: f, old: String(oldInfo[f] ?? ""), new: String(newInfo[f] ?? "") })) })
    );
  }

  return changes;
}

export function syncNetworkDeviceFromHostScan(ip: string, hostOpenPorts: Array<{ port: number; protocol?: string }>, hostClassification: string | null): void {
  const device = getNetworkDeviceByHost(ip);
  if (!device) return;

  const tcpPorts = new Set(hostOpenPorts.filter((p) => (p.protocol ?? "tcp") === "tcp").map((p) => p.port));
  const updates: Partial<NetworkDevice> = {};

  const candidatesMap: Record<string, number[]> = {
    ssh: [22, 2222],
    snmp_v2: [161],
    snmp_v3: [161],
    api: [443, 8728, 8006, 80],
    winrm: [5985, 5986],
  };
  const candidatesVendor: Record<string, number[]> = {
    mikrotik: [8291, 8728, 22, 443],
    proxmox: [8006, 443],
    omada: [443],
    cisco: [22, 23, 443],
    ubiquiti: [443, 22],
    hp: [22, 23, 443],
    fortinet: [443, 22],
    vmware: [443],
    generic: [22, 443, 80],
  };

  const currentPort = device.port ?? 22;
  const protocol = device.protocol ?? "ssh";
  const vendor = (device.vendor ?? "generic").toLowerCase();

  // SNMP è UDP: la 161 non compare mai fra le porte TCP aperte, e prima la
  // scansione spostava un MikroTik in SNMP sulla 8291 (tappa 1, 15/10).
  const protocolloSnmp = protocol === "snmp_v2" || protocol === "snmp_v3";
  if (!protocolloSnmp && !tcpPorts.has(currentPort)) {
    // Prima le porte del protocollo: per SSH le porte del produttore (8291 Winbox,
    // 8728 API di MikroTik, 23 telnet…) non sono SSH, e un MikroTik in SSH finiva
    // sulla 8291 (pilota, 16/10). Le porte del produttore restano solo per l'API.
    const vendorCandidates = protocol === "api" ? candidatesVendor[vendor] ?? [] : [];
    const protoCandidates = candidatesMap[protocol] ?? [];
    const orderedCandidates = [...new Set([...protoCandidates, ...vendorCandidates])];
    for (const c of orderedCandidates) {
      if (tcpPorts.has(c)) {
        updates.port = c;
        break;
      }
    }
  }

  if (hostClassification && hostClassification !== "unknown") {
    // Catalogo canonico (21/10): si confronta e si scrive lo slug canonico (updateNetworkDevice aggiunge ruolo e vendor).
    const classCanonica = canonicalizza(hostClassification).classificazione;
    const deviceClassification = canonicalizza(device.classification ?? device.device_type).classificazione;
    const isInfra = ["router", "switch", "hypervisor"].includes(device.device_type);
    // Scelta a mano sull'apparato (tappa 5): la scansione non la riscrive.
    if (isInfra && device.classification_manual !== 1 && deviceClassification !== classCanonica) {
      const infraSpecific = ["router", "switch", "hypervisor", "firewall", "access_point", "load_balancer", "vpn_gateway", "server", "nas"];
      if (infraSpecific.includes(classCanonica)) {
        updates.classification = hostClassification;
      }
    }
  }

  if (Object.keys(updates).length > 0) {
    updateNetworkDevice(device.id, updates);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CREDENTIALS
// ═══════════════════════════════════════════════════════════════════════════

export function getAllCredentials(): Credential[] {
  return db().prepare("SELECT * FROM credentials ORDER BY name").all() as Credential[];
}

export function getCredentialById(id: number): Credential | undefined {
  return db().prepare("SELECT * FROM credentials WHERE id = ?").get(id) as Credential | undefined;
}

/** CRUD dell'archivio: `creaCredenzialeDb` (tipo controllato, `linux` scritto come `ssh`). */
export function createCredential(input: ColonneCredenziale): Credential {
  return creaCredenzialeDb(db(), input);
}

export function updateCredential(id: number, input: Partial<ColonneCredenziale>): Credential | undefined {
  return aggiornaCredenzialeDb(db(), id, input);
}

export function deleteCredential(id: number): boolean {
  return eliminaCredenzialeDb(db(), id);
}

/**
 * Username/password decifrati se la credenziale esiste ed è del tipo atteso
 * (Windows/Linux/API — "api" riusato anche per Redfish/BMC, Fase 4b Task 1:
 * niente tipo dedicato finché il CHECK di host_credentials/device_credential_bindings
 * non viene migrato, vedi Task 4).
 */
export function getCredentialLoginPair(
  credentialId: number,
  expectedType: "windows" | "linux" | "api"
): { username: string; password: string } | null {
  return coppiaLoginDb(db(), credentialId, expectedType);
}

export function getSshLinuxCredentialPair(credentialId: number): { username: string; password: string; port: number | null } | null {
  return coppiaSshDb(db(), credentialId);
}

/** Accesso SSH di una voce: utente con password o con chiave (T14), con la porta della voce, o il perché no. */
export function accessoSshCredenziale(credentialId: number): EsitoAccessoSsh {
  return accessoSshDb(db(), credentialId);
}

/** Le verifiche (fotografia, prova a vuoto) passano `registra: false`: i ripieghi non si scrivono. */
type OpzioniRegistro = { registra?: boolean };

/**
 * Catena di rilevamento (Windows o Linux) di una rete: involucro del motore
 * (`catenaReteDb`, tappa 2 credenziali, T7): le voci della lista della rete,
 * col filtro di tipo. Dalla 2g (T26) niente catene vecchie né chiave «di
 * default» dell'hub: la 2d le ha portate nella lista, e le tabelle vecchie
 * (`network_host_credentials`, `host_detect_credential`) non hanno più né
 * lettori né scrittori. `role="linux"` è il protocollo SSH. `registra: false`
 * (fotografia, prova a vuoto) non scrive i ripieghi.
 */
export function getOrderedDetectCredentialIds(networkId: number, role: "windows" | "linux", opts: OpzioniRegistro = {}): number[] {
  return catenaReteDb(db(), networkId, role === "windows" ? "winrm" : "ssh", { registra: opts.registra });
}

/** Catena SSH di una rete per la scansione: involucro del motore (vedi sopra). */
export function getOrderedSshLinuxCredentialIds(networkId: number, opts: OpzioniRegistro = {}): number[] {
  return catenaReteDb(db(), networkId, "ssh", { registra: opts.registra });
}

/**
 * Community SNMP per una rete: involucro del motore (`communitySnmpDb`). Voci
 * della rete e catene vecchie, poi override, community della rete e
 * public/private in fondo, dichiarati come ripiego (D5).
 */
export function buildSnmpCommunitiesForNetwork(networkId: number, profileOrOverride?: string | null, opts: OpzioniRegistro = {}): string[] {
  return communitySnmpDb(db(), { networkId }, profileOrOverride ?? null, opts).map((c) => c.community);
}

/**
 * Community SNMP per un host: come per la rete, con davanti le voci
 * dell'host (righe validate, binding dell'apparato collegato, pin vecchio).
 */
export function buildSnmpCommunitiesForHost(
  networkId: number,
  hostId: number | null,
  profileOrOverride?: string | null,
  opts: OpzioniRegistro = {}
): string[] {
  return communitySnmpDb(db(), { hostId: hostId ?? undefined, networkId }, profileOrOverride ?? null, opts).map((c) => c.community);
}

// ── network_credentials v2 ──

export interface NetworkCredentialRow {
  id: number;
  network_id: number;
  credential_id: number;
  sort_order: number;
  credential_name: string;
  credential_type: string;
  /** Porta propria della credenziale, NULL = standard del protocollo. */
  credential_port: number | null;
}

export function getNetworkCredentials(networkId: number): NetworkCredentialRow[] {
  return db()
    .prepare(
      `SELECT nc.id, nc.network_id, nc.credential_id, nc.sort_order,
              c.name AS credential_name, c.credential_type, c.port AS credential_port
       FROM network_credentials nc
       JOIN credentials c ON c.id = nc.credential_id
       WHERE nc.network_id = ?
       ORDER BY nc.sort_order ASC, nc.id ASC`
    )
    .all(networkId) as NetworkCredentialRow[];
}

export function replaceNetworkCredentials(networkId: number, credentialIds: number[]): void {
  sostituisciListaReteDb(db(), networkId, credentialIds);
}

export function addNetworkCredential(networkId: number, credentialId: number): void {
  aggiungiAllaListaReteDb(db(), networkId, credentialId);
}

export function removeNetworkCredential(networkId: number, credentialId: number): void {
  db().prepare(
    `DELETE FROM network_credentials WHERE network_id = ? AND credential_id = ?`
  ).run(networkId, credentialId);
}

export function reorderNetworkCredentials(networkId: number, orderedCredentialIds: number[]): void {
  const d = db();
  d.transaction(() => {
    const upd = d.prepare(
      `UPDATE network_credentials SET sort_order = ? WHERE network_id = ? AND credential_id = ?`
    );
    orderedCredentialIds.forEach((cid, i) => upd.run(i, networkId, cid));
  })();
}

export function copyNetworkCredentials(sourceNetworkId: number, targetNetworkId: number): number {
  return copiaListaReteDb(db(), sourceNetworkId, targetNetworkId);
}

export function getNetworksWithCredentials(): Array<{ id: number; name: string; cidr: string; credential_count: number }> {
  return db()
    .prepare(
      `SELECT n.id, n.name, n.cidr, COUNT(nc.id) AS credential_count
       FROM networks n
       JOIN network_credentials nc ON nc.network_id = n.id
       GROUP BY n.id
       HAVING credential_count > 0
       ORDER BY n.name`
    )
    .all() as Array<{ id: number; name: string; cidr: string; credential_count: number }>;
}

// ── host_credentials ──

export interface HostCredentialRow {
  id: number;
  host_id: number;
  credential_id: number;
  protocol_type: "ssh" | "snmp" | "winrm" | "api" | "redfish" | "onvif";
  port: number;
  validated: number;
  validated_at: string | null;
  sort_order: number;
  auto_detected: number;
  created_at: string;
  credential_name: string;
  credential_type: string;
}

export function getHostCredentials(hostId: number): HostCredentialRow[] {
  return db()
    .prepare(
      `SELECT hc.*, c.name AS credential_name, c.credential_type
       FROM host_credentials hc
       JOIN credentials c ON c.id = hc.credential_id
       WHERE hc.host_id = ?
       ORDER BY hc.sort_order ASC, hc.id ASC`
    )
    .all(hostId) as HostCredentialRow[];
}

export function getHostValidatedProtocolsByNetwork(networkId: number): Map<number, string[]> {
  const rows = db()
    .prepare(
      `SELECT hc.host_id, hc.protocol_type
       FROM host_credentials hc
       JOIN hosts h ON h.id = hc.host_id
       WHERE h.network_id = ? AND hc.validated = 1
       ORDER BY hc.host_id, hc.protocol_type`
    )
    .all(networkId) as Array<{ host_id: number; protocol_type: string }>;
  const map = new Map<number, string[]>();
  for (const r of rows) {
    const arr = map.get(r.host_id) || [];
    if (!arr.includes(r.protocol_type)) arr.push(r.protocol_type);
    map.set(r.host_id, arr);
  }
  return map;
}

/** Mappa batch: per TUTTI gli host, i protocol_type validati. Per pagina Discovery. */
export function getAllHostValidatedProtocols(): Map<number, string[]> {
  const rows = db()
    .prepare(
      `SELECT hc.host_id, hc.protocol_type
       FROM host_credentials hc
       WHERE hc.validated = 1
       ORDER BY hc.host_id, hc.protocol_type`
    )
    .all() as Array<{ host_id: number; protocol_type: string }>;
  const map = new Map<number, string[]>();
  for (const r of rows) {
    const arr = map.get(r.host_id) || [];
    if (!arr.includes(r.protocol_type)) arr.push(r.protocol_type);
    map.set(r.host_id, arr);
  }
  return map;
}

/** Cluster fisici accorpati per la pagina Discovery (una query sola): host_id → principale/secondario e gli altri IP. */
export function getClusterDiscovery(): Map<number, InfoClusterDiscovery> {
  return leggiClusterDiscovery(db());
}

/** Tutti i link multihomed con i peer, per la pagina Discovery. */
export function getAllMultihomedLinks(): Map<number, { group_id: string; match_type: string; is_primary: boolean; primary_host_id: number | null; primary_ip: string | null; peers: Array<{ ip: string; network_name: string; host_id: number; is_primary: boolean }> }> {
  const rows = db().prepare(
    `SELECT ml.host_id, ml.group_id, ml.match_type, ml.is_primary
     FROM multihomed_links ml`
  ).all() as Array<{ host_id: number; group_id: string; match_type: string; is_primary: number }>;

  const groupIds = new Set<string>();
  const hostToGroup = new Map<number, { group_id: string; match_type: string; is_primary: number }>();
  for (const r of rows) {
    groupIds.add(r.group_id);
    hostToGroup.set(r.host_id, { group_id: r.group_id, match_type: r.match_type, is_primary: r.is_primary });
  }
  if (groupIds.size === 0) return new Map();

  const placeholders = [...groupIds].map(() => "?").join(",");
  const peers = db().prepare(
    `SELECT ml.group_id, ml.host_id, ml.is_primary, h.ip, n.name AS network_name
     FROM multihomed_links ml
     JOIN hosts h ON h.id = ml.host_id
     JOIN networks n ON n.id = h.network_id
     WHERE ml.group_id IN (${placeholders})`
  ).all(...groupIds) as Array<{ group_id: string; host_id: number; ip: string; network_name: string; is_primary: number }>;

  const peersByGroup = new Map<string, Array<{ ip: string; network_name: string; host_id: number; is_primary: boolean }>>();
  const primaryByGroup = new Map<string, { host_id: number; ip: string }>();
  for (const p of peers) {
    const arr = peersByGroup.get(p.group_id) || [];
    arr.push({ ip: p.ip, network_name: p.network_name, host_id: p.host_id, is_primary: p.is_primary === 1 });
    peersByGroup.set(p.group_id, arr);
    if (p.is_primary === 1) primaryByGroup.set(p.group_id, { host_id: p.host_id, ip: p.ip });
  }

  const result = new Map<number, { group_id: string; match_type: string; is_primary: boolean; primary_host_id: number | null; primary_ip: string | null; peers: Array<{ ip: string; network_name: string; host_id: number; is_primary: boolean }> }>();
  for (const [hostId, { group_id, match_type, is_primary }] of hostToGroup) {
    const allPeers = peersByGroup.get(group_id) || [];
    const otherPeers = allPeers.filter((p) => p.host_id !== hostId);
    if (otherPeers.length > 0) {
      const primary = primaryByGroup.get(group_id) ?? null;
      result.set(hostId, {
        group_id,
        match_type,
        is_primary: is_primary === 1,
        primary_host_id: primary?.host_id ?? null,
        primary_ip: primary?.ip ?? null,
        peers: otherPeers,
      });
    }
  }
  return result;
}

export function addHostCredential(
  hostId: number,
  credentialId: number,
  protocolType: "ssh" | "snmp" | "winrm" | "api" | "redfish" | "onvif",
  port: number,
  options?: { validated?: boolean; auto_detected?: boolean }
): void {
  const d = db();
  const max = d.prepare(
    `SELECT COALESCE(MAX(sort_order), -1) AS m FROM host_credentials WHERE host_id = ?`
  ).get(hostId) as { m: number };
  d.prepare(
    `INSERT OR IGNORE INTO host_credentials (host_id, credential_id, protocol_type, port, validated, validated_at, sort_order, auto_detected)
     VALUES (?, ?, ?, ?, ?, ${options?.validated ? "datetime('now')" : "NULL"}, ?, ?)`
  ).run(
    hostId,
    credentialId,
    protocolType,
    port,
    options?.validated ? 1 : 0,
    max.m + 1,
    options?.auto_detected ? 1 : 0
  );
}

export function removeHostCredential(id: number): void {
  db().prepare(`DELETE FROM host_credentials WHERE id = ?`).run(id);
}

/** Riordina credenziali host assegnando sort_order sequenziale. */
export function reorderHostCredentials(hostId: number, bindingIds: number[]): void {
  const d = db();
  const stmt = d.prepare(`UPDATE host_credentials SET sort_order = ? WHERE id = ? AND host_id = ?`);
  d.transaction(() => {
    for (let i = 0; i < bindingIds.length; i++) {
      stmt.run(i, bindingIds[i], hostId);
    }
  })();
}

export function setHostCredentialValidated(id: number, validated: boolean): void {
  db()
    .prepare(
      `UPDATE host_credentials SET validated = ?, validated_at = ${validated ? "datetime('now')" : "NULL"} WHERE id = ?`
    )
    .run(validated ? 1 : 0, id);
}

/** Upsert idempotente: marca un binding (host, cred, proto, port) come validato.
 * Crea il record se manca, altrimenti aggiorna validated/validated_at.
 * Chiamata dai test endpoint al successo per memorizzare cosa funziona contro un host. */
export function setHostCredentialValidatedByKey(
  hostId: number,
  credentialId: number,
  protocolType: "ssh" | "snmp" | "winrm" | "api" | "redfish" | "onvif",
  port: number,
  options?: { auto_detected?: boolean }
): void {
  const d = db();
  const max = d.prepare(
    `SELECT COALESCE(MAX(sort_order), -1) AS m FROM host_credentials WHERE host_id = ?`
  ).get(hostId) as { m: number };
  d.prepare(
    `INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, validated_at, sort_order, auto_detected)
     VALUES (?, ?, ?, ?, 1, datetime('now'), ?, ?)
     ON CONFLICT(host_id, credential_id, protocol_type, port) DO UPDATE SET
       validated = 1,
       validated_at = datetime('now')`
  ).run(
    hostId,
    credentialId,
    protocolType,
    port,
    max.m + 1,
    options?.auto_detected ? 1 : 0
  );
}

/** Bridge host→device best-effort per il cross-update dei binding: FK prima, poi match IP. */
function findDeviceIdForHostCred(hostId: number): number | null {
  const byFk = getNetworkDeviceByHostId(hostId);
  if (byFk) return byFk.id;
  const host = db().prepare(`SELECT ip FROM hosts WHERE id = ?`).get(hostId) as { ip: string } | undefined;
  if (!host) return null;
  const byIp = getNetworkDeviceByHost(host.ip);
  return byIp?.id ?? null;
}

/**
 * Registra un fallimento di autenticazione su (host, credenziale, protocollo, porta) —
 * resolver unico fase 1b, §7.5. Upsert idempotente: se la riga in `host_credentials`
 * non esiste ancora (es. la credenziale è stata tentata via network_chain/legacy_chain
 * e non era mai stata materializzata per questo host) la crea con fail_count=1,
 * MAI un no-op silenzioso — altrimenti il primo fallimento su una credenziale non
 * ancora vista per l'host andrebbe perso e il backoff non scatterebbe mai.
 * backoff_until = now + min(2^fail_count * 5min, 24h) col fail_count AGGIORNATO
 * (post-incremento). validated viene invalidato incondizionatamente (§7.5:
 * "invalidazione al fallimento") — se era già 0 l'UPDATE è un no-op sul valore.
 * last_attempt_at/backoff_until in ISO-8601 UTC (vedi commento sullo schema in
 * db-tenant-schema.ts e normalizeExpiresAt in attribution/evidence.ts).
 */
export function recordCredentialFailure(
  hostId: number,
  credentialId: number,
  protocol: CredProtocol,
  port: number,
  error: string
): void {
  const d = db();
  const existing = d
    .prepare(
      `SELECT id, fail_count FROM host_credentials WHERE host_id = ? AND credential_id = ? AND protocol_type = ? AND port = ?`
    )
    .get(hostId, credentialId, protocol, port) as { id: number; fail_count: number } | undefined;

  const newFailCount = (existing?.fail_count ?? 0) + 1;
  const backoffMs = Math.min(2 ** newFailCount * 5 * 60 * 1000, 24 * 60 * 60 * 1000);
  const nowIso = new Date().toISOString();
  const backoffUntil = new Date(Date.now() + backoffMs).toISOString();

  if (existing) {
    d.prepare(
      `UPDATE host_credentials
       SET fail_count = ?, last_error = ?, last_attempt_at = ?, backoff_until = ?,
           validated = 0, validated_at = NULL
       WHERE id = ?`
    ).run(newFailCount, error, nowIso, backoffUntil, existing.id);
  } else {
    const max = d.prepare(
      `SELECT COALESCE(MAX(sort_order), -1) AS m FROM host_credentials WHERE host_id = ?`
    ).get(hostId) as { m: number };
    d.prepare(
      `INSERT INTO host_credentials
         (host_id, credential_id, protocol_type, port, validated, validated_at, sort_order, auto_detected, fail_count, last_error, last_attempt_at, backoff_until)
       VALUES (?, ?, ?, ?, 0, NULL, ?, 0, ?, ?, ?, ?)`
    ).run(hostId, credentialId, protocol, port, max.m + 1, newFailCount, error, nowIso, backoffUntil);
  }

  const deviceId = findDeviceIdForHostCred(hostId);
  if (deviceId != null) {
    const binding = findExistingBinding(deviceId, credentialId, protocol, port);
    if (binding) updateBindingTestStatus(binding.id, "failed", error);
  }
}

/**
 * Registra un'autenticazione riuscita su (host, credenziale, protocollo, porta):
 * azzera fail_count/last_error/backoff_until e marca validated=1 (upsert, come
 * setHostCredentialValidatedByKey). Propaga anche a device_credential_bindings
 * se esiste un binding corrispondente per il device collegato all'host.
 */
export function recordCredentialSuccess(
  hostId: number,
  credentialId: number,
  protocol: CredProtocol,
  port: number
): void {
  const d = db();
  const nowIso = new Date().toISOString();
  const max = d.prepare(
    `SELECT COALESCE(MAX(sort_order), -1) AS m FROM host_credentials WHERE host_id = ?`
  ).get(hostId) as { m: number };
  d.prepare(
    `INSERT INTO host_credentials
       (host_id, credential_id, protocol_type, port, validated, validated_at, sort_order, auto_detected, fail_count, last_error, last_attempt_at, backoff_until)
     VALUES (?, ?, ?, ?, 1, datetime('now'), ?, 0, 0, NULL, ?, NULL)
     ON CONFLICT(host_id, credential_id, protocol_type, port) DO UPDATE SET
       validated = 1,
       validated_at = datetime('now'),
       fail_count = 0,
       last_error = NULL,
       last_attempt_at = excluded.last_attempt_at,
       backoff_until = NULL`
  ).run(hostId, credentialId, protocol, port, max.m + 1, nowIso);

  const deviceId = findDeviceIdForHostCred(hostId);
  if (deviceId != null) {
    const binding = findExistingBinding(deviceId, credentialId, protocol, port);
    if (binding) updateBindingTestStatus(binding.id, "success", "Autenticazione riuscita");
  }
}

export function getCredentialCommunityString(credentialId: number): string | null {
  return communityDb(db(), credentialId);
}

/**
 * Credenziale SNMP di un apparato per l'acquisizione: v3 coi protocolli della
 * voce, o community; porta del candidato; fonte dichiarata (tappa 2
 * credenziali, T8). Al posto di getDeviceCommunityString,
 * getDeviceSnmpV3Credentials e getEffectiveSnmpPort.
 */
export function credenzialeSnmpApparato(device: ApparatoInAcquisizione): SceltaSnmpApparato {
  return credenzialeSnmpApparatoDb(db(), device);
}

/** Token dell'API dell'apparato (client Omada): voce `api` a token legata all'apparato; fino alla 2g la colonna (T20). */
export function tokenApiApparato(device: ApparatoInAcquisizione): SceltaTokenApi {
  return tokenApiApparatoDb(db(), device);
}

/** Host di IPAM per l'abbinamento con Proxmox (scheda hypervisor): id, ip, nome e stato, senza il resto della riga. */
export function getHostNotoPerIp(ip: string): { id: number; ip: string; hostname: string | null; status: string | null } | undefined {
  return db().prepare("SELECT id, ip, COALESCE(hostname, custom_name) AS hostname, status FROM hosts WHERE ip = ? LIMIT 1")
    .get(ip) as { id: number; ip: string; hostname: string | null; status: string | null } | undefined;
}

/** Il nodo Proxmox «DA-PX-01» è l'host di IPAM «DA-PX-01» o «DA-PX-01.dominio» (hostname o nome personalizzato). */
export function getHostNotoPerNomeNodo(nome: string): { id: number; ip: string; hostname: string | null; status: string | null } | undefined {
  const n = nome.trim().toLowerCase();
  if (n === "") return undefined;
  return db().prepare(
    `SELECT id, ip, COALESCE(hostname, custom_name) AS hostname, status FROM hosts
      WHERE lower(hostname) = ?1 OR substr(lower(hostname), 1, length(?1) + 1) = ?1 || '.' OR lower(custom_name) = ?1
      ORDER BY id LIMIT 1`,
  ).get(n) as { id: number; ip: string; hostname: string | null; status: string | null } | undefined;
}

/** Le scansioni Proxmox salvate sugli apparati (JSON grezzo): da lì si risale alla VM di un host. */
export function getScansioniProxmoxSalvate(): Array<{ id: number; raw: string }> {
  return db()
    .prepare("SELECT id, last_proxmox_scan_result AS raw FROM network_devices WHERE last_proxmox_scan_result IS NOT NULL AND last_proxmox_scan_result <> '' ORDER BY id")
    .all() as Array<{ id: number; raw: string }>;
}

/** Vero solo con una fonte SNMP dell'apparato (livelli 1-5), mai con la catena della rete o «public». */
export function haSnmpApparato(device: ApparatoInAcquisizione): boolean {
  return haSnmpApparatoDb(db(), device);
}

/** Porta SSH di un apparato il cui protocollo principale non è SSH (Proxmox: device.port è l'API). */
export function portaSshApparato(device: ApparatoInAcquisizione): number {
  return portaSshApparatoDb(db(), device);
}

/** Accesso dell'acquisizione (utente con password, o con chiave per l'SSH), scelto dal motore (binding falliti saltati). */
export function getDeviceCredentials(device: ApparatoInAcquisizione): AccessoSsh | null {
  return loginApparatoDb(db(), device);
}

// ═══════════════════════════════════════════════════════════════════════════
// ARP ENTRIES
// ═══════════════════════════════════════════════════════════════════════════

export function upsertArpEntries(
  deviceId: number,
  entries: { mac: string; ip: string | null; interface_name: string | null; status?: string | null; dynamic?: boolean | null }[],
  getNetworkIdForIp?: (ip: string) => number | null
): void {
  const d = db();

  // Scheda MikroTik: stato e «dinamica» solo se lo schema ha le colonne; altrimenti l'INSERT di oggi.
  const conStato = livelloSchemaSchedaMk(d) >= 1;
  const stmt = conStato
    ? d.prepare(
      `INSERT INTO arp_entries (device_id, host_id, mac, ip, interface_name, status, dynamic)
       VALUES (?, (SELECT id FROM hosts WHERE ${MAC_HEX("mac")} = ? LIMIT 1), ?, ?, ?, ?, ?)`
    )
    : d.prepare(
      `INSERT INTO arp_entries (device_id, host_id, mac, ip, interface_name)
       VALUES (?, (SELECT id FROM hosts WHERE ${MAC_HEX("mac")} = ? LIMIT 1), ?, ?, ?)`
    );

  const replaceAll = d.transaction((items: typeof entries) => {
    d.prepare("DELETE FROM arp_entries WHERE device_id = ?").run(deviceId);

    for (const entry of items) {
      const hex = macToHex(entry.mac);
      if (conStato) {
        stmt.run(deviceId, hex, entry.mac, entry.ip, entry.interface_name, entry.status ?? null,
          entry.dynamic == null ? null : entry.dynamic ? 1 : 0);
      } else {
        stmt.run(deviceId, hex, entry.mac, entry.ip, entry.interface_name);
      }
      if (entry.ip && entry.mac) {
        const networkId = getNetworkIdForIp?.(entry.ip) ?? null;
        // Propaga il MAC all'host ESISTENTE per quell'IP (by-IP, non by-MAC):
        // l'ARP table del gateway è autoritativa sul MAC. Senza questo, un host
        // creato dal discovery nmap SENZA MAC restava a mac=NULL anche se il
        // gateway ne conosce il MAC (incident 2026-06-21: 20/29 host senza MAC
        // pur essendo in arp_entries). Aggiorna solo se l'host esiste già e ha
        // MAC mancante/diverso. NON crea host (resta fonte passiva).
        if (networkId != null) {
          const normMac = normalizeMacForStorage(entry.mac);
          if (normMac) {
            d.prepare(
              `UPDATE hosts SET mac = ?, updated_at = datetime('now')
               WHERE network_id = ? AND ip = ? AND (mac IS NULL OR mac = '' OR mac != ?)`
            ).run(normMac, networkId, entry.ip, normMac);
            // Propaga anche il VENDOR (OUI) by-IP se l'host esiste e non ne ha uno.
            // Stesso incident MAC 2026-06-21: gli host popolati col MAC ma senza
            // vendor (updateHostIfExists non li aggiornava) restavano senza marca.
            const vnd = lookupVendorSync(normMac);
            if (vnd) {
              d.prepare(
                `UPDATE hosts SET vendor = ?, updated_at = datetime('now')
                 WHERE network_id = ? AND ip = ? AND (vendor IS NULL OR vendor = '')`
              ).run(vnd, networkId, entry.ip);
            }
          }
        }
        try {
          upsertMacIpMapping({
            mac: entry.mac,
            ip: entry.ip,
            source: "arp",
            source_device_id: deviceId,
            network_id: networkId,
          });
        } catch (err) {
          // Diagnostica FK: dump valori e stato FK esistenti
          const macHex = macToHex(entry.mac);
          const existingMapping = d.prepare("SELECT source_device_id, network_id, host_id FROM mac_ip_mapping WHERE mac_normalized = ?").get(macHex) as { source_device_id: number | null; network_id: number | null; host_id: number | null } | undefined;
          const deviceOk = d.prepare("SELECT id FROM network_devices WHERE id = ?").get(deviceId);
          console.error(`[upsertArpEntries] FK error per MAC ${entry.mac} IP ${entry.ip}:`, {
            deviceId,
            deviceExists: !!deviceOk,
            networkId,
            existingMapping,
            error: err instanceof Error ? err.message : err,
          });
          // Non propagare: skippa questa entry e continua
        }
      }
    }
  });

  replaceAll(entries);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAC-IP MAPPING
// ═══════════════════════════════════════════════════════════════════════════

export type MacIpMappingSource = "arp" | "dhcp" | "host" | "switch";

export function upsertMacIpMapping(input: {
  mac: string;
  ip: string;
  source: MacIpMappingSource;
  source_device_id?: number | null;
  network_id?: number | null;
  host_id?: number | null;
  vendor?: string | null;
  hostname?: string | null;
}): void {
  const d = db();
  const hex = macToHex(input.mac);
  const display = normalizeMac(input.mac);
  const now = new Date().toISOString();

  const existing = d.prepare(
    "SELECT id, ip, last_seen FROM mac_ip_mapping WHERE mac_normalized = ?"
  ).get(hex) as { id: number; ip: string; last_seen: string } | undefined;

  if (existing) {
    const ipChanged = existing.ip !== input.ip;
    d.prepare(`
      UPDATE mac_ip_mapping SET
        ip = ?,
        source = ?,
        source_device_id = COALESCE(?, source_device_id),
        network_id = COALESCE(?, network_id),
        host_id = COALESCE(?, host_id),
        vendor = COALESCE(?, vendor),
        hostname = COALESCE(?, hostname),
        last_seen = ?,
        previous_ip = CASE WHEN ? = 1 THEN ? ELSE previous_ip END
      WHERE mac_normalized = ?
    `).run(
      input.ip,
      input.source,
      input.source_device_id ?? null,
      input.network_id ?? null,
      input.host_id ?? null,
      input.vendor ?? null,
      input.hostname ?? null,
      now,
      ipChanged ? 1 : 0,
      ipChanged ? existing.ip : null,
      hex
    );
    if (ipChanged) {
      d.prepare(
        "INSERT INTO mac_ip_history (mac_normalized, ip, source) VALUES (?, ?, ?)"
      ).run(hex, input.ip, input.source);
    }
  } else {
    d.prepare(`
      INSERT INTO mac_ip_mapping (mac_normalized, mac_display, ip, source, source_device_id, network_id, host_id, vendor, hostname, first_seen, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      hex,
      display,
      input.ip,
      input.source,
      input.source_device_id ?? null,
      input.network_id ?? null,
      input.host_id ?? null,
      input.vendor ?? null,
      input.hostname ?? null,
      now,
      now
    );
  }
}

export function getMacIpMappings(opts?: {
  network_id?: number;
  source?: MacIpMappingSource;
  q?: string;
  limit?: number;
}): import("@/types").MacIpMapping[] {
  let sql = `
    SELECT m.*, n.name as network_name, nd.name as source_device_name
    FROM mac_ip_mapping m
    LEFT JOIN networks n ON n.id = m.network_id
    LEFT JOIN network_devices nd ON nd.id = m.source_device_id
    WHERE 1=1
  `;
  const params: unknown[] = [];
  if (opts?.network_id) {
    sql += " AND m.network_id = ?";
    params.push(opts.network_id);
  }
  if (opts?.source) {
    sql += " AND m.source = ?";
    params.push(opts.source);
  }
  if (opts?.q?.trim()) {
    const q = `%${opts.q.trim()}%`;
    const qNorm = `%${opts.q.trim().replace(/[:-]/g, "")}%`;
    sql += " AND (m.mac_display LIKE ? OR m.mac_normalized LIKE ? OR m.ip LIKE ? OR m.hostname LIKE ?)";
    params.push(q, qNorm, q, q);
  }
  sql += " ORDER BY m.last_seen DESC";
  if (opts?.limit) {
    sql += " LIMIT ?";
    params.push(opts.limit);
  }
  return db().prepare(sql).all(...params) as import("@/types").MacIpMapping[];
}

export function getArpEntriesByDevice(deviceId: number): (ArpEntry & { host_ip?: string; host_name?: string })[] {
  return db().prepare(`
    SELECT ae.*, h.ip as host_ip, COALESCE(h.custom_name, h.hostname) as host_name
    FROM arp_entries ae
    LEFT JOIN hosts h ON h.id = ae.host_id
    WHERE ae.device_id = ?
    ORDER BY ae.ip
  `).all(deviceId) as (ArpEntry & { host_ip?: string; host_name?: string })[];
}

/**
 * Reti servite dal router: quelle collegate in network_router e quelle dei suoi lease. Un host con lo stesso IP in
 * un'altra sede non deve prestare nome né tenere in vita un'ARP «failed» (revisione finale, 22/10).
 */
function reteServiteDa(d: ReturnType<typeof db>, deviceId: number): Set<number> {
  return new Set((d.prepare(
    `SELECT network_id FROM network_router WHERE router_id = ?
     UNION SELECT network_id FROM dhcp_leases WHERE source_device_id = ? AND network_id IS NOT NULL`,
  ).all(deviceId, deviceId) as { network_id: number }[]).map((r) => r.network_id));
}

/**
 * Quali host si possono collegare a ciò che vede un router: con reti servite note vale solo un host di quelle; senza,
 * solo una chiave (IP o MAC) che nel tenant ha un host solo. In entrambi i casi una chiave rimasta con più host non
 * si collega. Unica regola per «Dispositivi» e per i vicini «non in IPAM».
 */
function hostDelRouter<T extends { network_id: number | null }>(candidati: T[], servite: Set<number>, chiave: (h: T) => string): T[] {
  const tenuti = servite.size > 0 ? candidati.filter((h) => h.network_id != null && servite.has(h.network_id)) : candidati;
  const quanti = new Map<string, number>();
  for (const h of tenuti) quanti.set(chiave(h), (quanti.get(chiave(h)) ?? 0) + 1);
  return tenuti.filter((h) => quanti.get(chiave(h)) === 1);
}

/**
 * Host di IPAM per i vicini LLDP/CDP/MNDP dell'ultimo giro di un apparato (stesse righe di `getNeighborsByDevice`):
 * per IP e per MAC (12 cifre esadecimali maiuscole), con la stessa restrizione della tab «Dispositivi».
 */
export function viciniConHost(deviceId: number): { ip: Record<string, number>; mac: Record<string, number> } {
  const d = db();
  const righe = d.prepare(
    `SELECT dn.remote_ip, dn.remote_mac FROM device_neighbors dn WHERE dn.device_id = ? AND ${NEIGHBORS_LATEST_ROUND_SQL}`,
  ).all(deviceId) as { remote_ip: string | null; remote_mac: string | null }[];
  const ips = [...new Set(righe.map((r) => (r.remote_ip ?? "").trim()).filter((x) => x !== ""))];
  const macs = [...new Set(righe.map((r) => (r.remote_mac ?? "").replace(/[^0-9a-fA-F]/g, "").toUpperCase()).filter((x) => x.length === 12))];
  const servite = reteServiteDa(d, deviceId);
  type Cand = { id: number; chiave: string; network_id: number | null };
  const perIp: Cand[] = [];
  const perMac: Cand[] = [];
  for (let k = 0; k < ips.length; k += 500) {
    const pezzo = ips.slice(k, k + 500);
    perIp.push(...(d.prepare(`SELECT id, ip AS chiave, network_id FROM hosts WHERE ip IN (${pezzo.map(() => "?").join(",")})`).all(...pezzo) as Cand[]));
  }
  for (let k = 0; k < macs.length; k += 500) {
    const pezzo = macs.slice(k, k + 500);
    perMac.push(...(d.prepare(`SELECT id, ${MAC_HEX("mac")} AS chiave, network_id FROM hosts WHERE ${MAC_HEX("mac")} IN (${pezzo.map(() => "?").join(",")})`).all(...pezzo) as Cand[]));
  }
  const mappa = (c: Cand[]): Record<string, number> => Object.fromEntries(hostDelRouter(c, servite, (h) => h.chiave).map((h) => [h.chiave, h.id]));
  return { ip: mappa(perIp), mac: mappa(perMac) };
}

/**
 * Le quattro letture della tab «Dispositivi» di un router MikroTik (ARP, lease DHCP, vicini dell'ultimo giro, host IPAM
 * con quegli IP). Niente N+1: gli host si cercano in blocco per `ip IN (...)`. L'unione e le precedenze stanno in
 * `src/lib/scheda/dispositivi-router.ts` (puro).
 */
export function ingressoDispositivi(deviceId: number): IngressoDispositivi {
  const d = db();
  // `status` esiste solo dallo schema della scheda MikroTik (livello 1): prima, lo stato dell'ARP è ignoto.
  const conStato = livelloSchemaSchedaMk(d) >= 1;
  const arp = d.prepare(`SELECT ip, mac, interface_name, ${conStato ? "status" : "NULL AS status"}, timestamp FROM arp_entries WHERE device_id = ?`).all(deviceId) as IngressoDispositivi["arp"];
  // I lease non si cancellano mai (upsert): si tengono quelli riscritti entro un giorno dall'ultima lettura
  // dell'apparato. Non la finestra stretta dei vicini: molte letture riscrivono solo una parte dei lease (la discovery
  // passa gli IP online, il recupero DHCP una rete sola) e una finestra di minuti nasconderebbe il resto.
  const lease = d.prepare(
    `SELECT ip_address, mac_address, hostname, dynamic_lease, description, last_seen FROM dhcp_leases dl
     WHERE dl.source_device_id = ?
       AND datetime(dl.last_synced) >= (SELECT datetime(MAX(l2.last_synced), '-1 day') FROM dhcp_leases l2 WHERE l2.source_device_id = dl.source_device_id)`,
  ).all(deviceId) as IngressoDispositivi["lease"];
  const vicini = d.prepare(
    `SELECT dn.remote_ip, dn.remote_mac, dn.remote_device_name, dn.local_port, dn.timestamp
     FROM device_neighbors dn WHERE dn.device_id = ? AND ${NEIGHBORS_LATEST_ROUND_SQL}`,
  ).all(deviceId) as IngressoDispositivi["vicini"];
  const ips = [...new Set([...arp.map((a) => a.ip), ...lease.map((l) => l.ip_address), ...vicini.map((v) => v.remote_ip)].filter((x): x is string => !!x))];
  const servite = reteServiteDa(d, deviceId);
  const candidati: (IngressoDispositivi["host"][number] & { network_id: number | null })[] = [];
  // 500 per volta: sotto il limite delle variabili di SQLite anche con router da migliaia di righe.
  for (let k = 0; k < ips.length; k += 500) {
    const pezzo = ips.slice(k, k + 500);
    candidati.push(...(d.prepare(
      `SELECT id, ip, COALESCE(custom_name, hostname, dns_reverse) AS nome_dns, status, network_id FROM hosts WHERE ip IN (${pezzo.map(() => "?").join(",")})`,
    ).all(...pezzo) as (IngressoDispositivi["host"][number] & { network_id: number | null })[]));
  }
  const host: IngressoDispositivi["host"] = hostDelRouter(candidati, servite, (h) => h.ip)
    .map(({ id, ip, nome_dns, status }) => ({ id, ip, nome_dns, status }));
  return { arp, lease, vicini, host };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAC PORT ENTRIES
// ═══════════════════════════════════════════════════════════════════════════

export type MacPortInput = { mac: string; port_name: string; vlan: number | null; port_status: "up" | "down" | null; speed: string | null };

/**
 * Le righe invecchiano (spec §10.5, come i vicini nell'ADR 0008): una lettura
 * aggiorna o crea, non cancella. `timestamp` uguale per tutto il giro = «ultimo
 * giro» riconoscibile. La pulizia a 30 giorni la fa il job cleanup.
 * ON CONFLICT sull'indice UNIQUE (device_id, mac, port_name) del Task 1: lo
 * stesso (MAC, porta) ripetuto nel giro (es. su due VLAN) aggiorna la riga
 * invece di far fallire la transazione dell'intero apparato.
 */
export function upsertMacPortEntries(deviceId: number, entries: MacPortInput[], source: "device" | "unifi"): void {
  const d = db();
  const now = (d.prepare("SELECT datetime('now') AS t").get() as { t: string }).t;
  const stmt = d.prepare(
    `INSERT INTO mac_port_entries (device_id, mac, port_name, vlan, port_status, speed, timestamp, first_seen, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(device_id, mac, port_name) DO UPDATE SET
       vlan = COALESCE(excluded.vlan, mac_port_entries.vlan),
       port_status = COALESCE(excluded.port_status, mac_port_entries.port_status),
       speed = COALESCE(excluded.speed, mac_port_entries.speed),
       timestamp = excluded.timestamp, source = excluded.source`,
  );
  d.transaction((items: MacPortInput[]) => {
    for (const e of items) stmt.run(deviceId, e.mac, e.port_name, e.vlan, e.port_status, e.speed, now, now, source);
  })(entries);
}

/**
 * Retention mac_port_entries in giorni (prima v0.2.651: 24 ore, perché ogni
 * giro riscriveva l'intera MAC table). Ora c'è una riga per (apparato, MAC,
 * porta) aggiornata a ogni giro: il volume non cresce col numero dei giri, e
 * una riga vecchia vuol dire «visto l'ultima volta» — si tiene 30 giorni.
 */
export function cleanupOldMacPortEntries(retentionDays: number = MAC_PORT_RETENTION_DAYS): number {
  return (db().prepare("DELETE FROM mac_port_entries WHERE timestamp < datetime('now', '-' || ? || ' days')").run(retentionDays) as { changes: number }).changes;
}

/**
 * Apparati del tenant col MAC del controller (UniFi) e nomi delle loro porte:
 * l'ingresso di `mapClientsToPorts` (lettura dei client collegati). Due query,
 * niente N+1.
 */
export function getControllerDevicePortNames(): {
  devices: Array<{ id: number; controller_mac: string }>;
  ports: Array<{ device_id: number; port_index: number; port_name: string }>;
} {
  const d = db();
  return {
    devices: d
      .prepare("SELECT id, controller_mac FROM network_devices WHERE controller_mac IS NOT NULL AND controller_mac != '' ORDER BY id")
      .all() as Array<{ id: number; controller_mac: string }>,
    ports: d
      .prepare(
        `SELECT sp.device_id, sp.port_index, sp.port_name
           FROM switch_ports sp
           JOIN network_devices nd ON nd.id = sp.device_id
          WHERE nd.controller_mac IS NOT NULL AND nd.controller_mac != ''`,
      )
      .all() as Array<{ device_id: number; port_index: number; port_name: string }>,
  };
}

export function getMacPortEntriesByDevice(deviceId: number): (MacPortEntry & { host_ip?: string; host_name?: string })[] {
  return db().prepare(`
    SELECT mpe.*,
      COALESCE(h.ip, (SELECT ae.ip FROM arp_entries ae WHERE ${MAC_HEX("ae.mac")} = ${MAC_HEX("mpe.mac")} AND ae.ip IS NOT NULL ORDER BY ae.timestamp DESC LIMIT 1)) as host_ip,
      COALESCE(h.custom_name, h.hostname) as host_name
    FROM mac_port_entries mpe
    LEFT JOIN hosts h ON ${MAC_HEX("h.mac")} = ${MAC_HEX("mpe.mac")}
    WHERE mpe.device_id = ?
      -- Solo l'ultimo giro di ogni fonte: le righe non viste restano (invecchiano)
      -- ma non si mostrano come attuali. Stessa idea di NEIGHBORS_LATEST_ROUND_SQL.
      AND mpe.timestamp = (SELECT MAX(m2.timestamp) FROM mac_port_entries m2 WHERE m2.device_id = mpe.device_id AND m2.source = mpe.source)
    ORDER BY mpe.port_name
  `).all(deviceId) as (MacPortEntry & { host_ip?: string; host_name?: string })[];
}

// ═══════════════════════════════════════════════════════════════════════════
// SWITCH PORTS
// ═══════════════════════════════════════════════════════════════════════════

export function upsertSwitchPorts(deviceId: number, ports: Omit<import("@/types").SwitchPort, "id" | "device_id" | "timestamp">[]): void {
  const d = db();

  // v0.2.645 audit perf DB4:
  //  - DELETE spostato DENTRO la transazione (prima era 1 fsync separato).
  //  - hostExists/deviceExists query individuali sostituite da Set pre-caricati
  //    (1 SELECT × 2 contro N × 2 SELECT per ogni port). Su switch 48-port:
  //    96 SELECT FK probes → 2. Combinato con DELETE in-tx: 40-60ms → ~8ms.
  const candidateHostIds = new Set<number>();
  const candidateDeviceIds = new Set<number>();
  for (const p of ports) {
    if (p.host_id != null) candidateHostIds.add(p.host_id);
    if (p.trunk_primary_device_id != null) candidateDeviceIds.add(p.trunk_primary_device_id);
  }
  const validHosts = new Set<number>();
  if (candidateHostIds.size > 0) {
    const placeholders = Array.from(candidateHostIds).map(() => "?").join(",");
    for (const row of d.prepare(`SELECT id FROM hosts WHERE id IN (${placeholders})`).all(...candidateHostIds) as Array<{ id: number }>) {
      validHosts.add(row.id);
    }
  }
  const validDevices = new Set<number>();
  if (candidateDeviceIds.size > 0) {
    const placeholders = Array.from(candidateDeviceIds).map(() => "?").join(",");
    for (const row of d.prepare(`SELECT id FROM network_devices WHERE id IN (${placeholders})`).all(...candidateDeviceIds) as Array<{ id: number }>) {
      validDevices.add(row.id);
    }
  }

  const stmt = d.prepare(
    `INSERT INTO switch_ports (device_id, port_index, port_name, status, speed, duplex, vlan, poe_status, poe_power_mw, mac_count, is_trunk, single_mac, single_mac_vendor, single_mac_ip, single_mac_hostname, host_id, trunk_neighbor_name, trunk_neighbor_port, trunk_primary_device_id, trunk_primary_name, stp_state, is_uplink)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const replaceAll = d.transaction((items: typeof ports) => {
    d.prepare("DELETE FROM switch_ports WHERE device_id = ?").run(deviceId);
    for (const p of items) {
      const hostId = p.host_id != null && validHosts.has(p.host_id) ? p.host_id : null;
      const trunkDeviceId = p.trunk_primary_device_id != null && validDevices.has(p.trunk_primary_device_id) ? p.trunk_primary_device_id : null;
      stmt.run(deviceId, p.port_index, p.port_name, p.status, p.speed, p.duplex, p.vlan, p.poe_status, p.poe_power_mw, p.mac_count, p.is_trunk, p.single_mac, p.single_mac_vendor, p.single_mac_ip, p.single_mac_hostname, hostId, p.trunk_neighbor_name ?? null, p.trunk_neighbor_port ?? null, trunkDeviceId, trunkDeviceId ? (p.trunk_primary_name ?? null) : null, p.stp_state ?? null, p.is_uplink ?? 0);
    }
  });

  replaceAll(ports);
}

export function getSwitchPortsByDevice(deviceId: number): import("@/types").SwitchPort[] {
  return db().prepare(
    "SELECT * FROM switch_ports WHERE device_id = ? ORDER BY port_index"
  ).all(deviceId) as import("@/types").SwitchPort[];
}

// ═══════════════════════════════════════════════════════════════════════════
// DEVICE NEIGHBORS (LLDP/CDP/MNDP)
// ═══════════════════════════════════════════════════════════════════════════

export interface DbNeighborEntry {
  id: number;
  device_id: number;
  local_port: string;
  remote_device_name: string;
  remote_port: string;
  protocol: string;
  remote_ip: string | null;
  remote_mac: string | null;
  remote_platform: string | null;
  /** Scheda MikroTik: `version=` annunciata dal vicino; null = non la annuncia o schema senza colonna. */
  remote_version?: string | null;
  timestamp: string;
}

/**
 * Chi ha scritto una riga dei vicini. `device` e `unifi` sono quelle che leggono il modello di oggi e l'attribuzione
 * (NEIGHBORS_MODEL_SOURCES_SQL); `ssh` (switch MikroTik nel giro), `snmp` (switch non del controller) e `host` (`lldpcli`
 * sugli hypervisor) sono le fonti nuove di T2 (spec §13.5.7): le legge solo il modello per cavo. `collector` (acquisizione
 * modulare, piano 2026-10-21 C2, decisione D4) è il vicino letto da un collector JSON 1.0: anche lui solo per il modello
 * per cavo. La colonna non ha vincoli (db-tenant-schema.ts): non serve schema.
 */
export type NeighborSource = "device" | "unifi" | "ssh" | "snmp" | "host" | "collector";

/**
 * Le colonne nuove dei vicini (spec §13.5.7): l'elenco letto di `discovered-by`, gli indici delle due porte quando il
 * lettore li sa, le capacità annunciate attive. Si scrivono con un'istruzione a parte, solo se lo schema le ha.
 */
export interface CampiViciniCavi {
  discoveredBy?: string | null;
  localPortIndex?: number | null;
  remotePortIndex?: number | null;
  remoteCaps?: string | null;
}

/**
 * Condizione SQL «solo l'ultimo giro di questo apparato per questa fonte», da
 * mettere in AND nel WHERE di un lettore che usa l'alias `dn` per
 * device_neighbors.
 *
 * Perché: fino alla topologia fase 1 upsertNeighbors cancellava i vicini
 * dell'apparato a ogni giro, quindi la tabella conteneva solo l'ultimo poll.
 * Ora le righe restano (timestamp = ultima volta visto, pulizia a 90 giorni,
 * ADR 0008) e il modello nuovo le usa tutte per dire «non visto». I lettori
 * scritti prima (scheda «Neighbors» dell'apparato, vecchia mappa /topology,
 * attribuzione) mostrerebbero come attuali anche vicini spariti: con questa
 * condizione rivedono la semantica di prima. Un giro scrive tutte le righe
 * nella stessa transazione con lo stesso datetime('now'); i 5 minuti di
 * margine coprono un giro che scavalca il secondo, mai due giri distinti.
 * Una copia identica sta in attribution/recompute.ts (vedi lì il perché),
 * presidiata da src/lib/__tests__/neighbors-old-readers.test.ts.
 */
export const NEIGHBORS_LATEST_ROUND_SQL =
  "dn.timestamp >= (SELECT datetime(MAX(d2.timestamp), '-5 minutes') FROM device_neighbors d2 WHERE d2.device_id = dn.device_id AND d2.source = dn.source)";

/**
 * Le fonti dei vicini che leggono il modello della mappa di oggi e l'attribuzione degli host (spec topologia §13.5.7,
 * «Chi legge che cosa»; R7). Oggi le fonti sono solo queste due e il filtro non cambia niente; da T2 le letture in più
 * scrivono fonti nuove (snmp, host, ssh), che legge solo il modello per cavo: accenderle non cambia la mappa né le
 * classificazioni degli host, che sono dati di produzione. Una copia identica sta in attribution/recompute.ts
 * (ciclo db-tenant ↔ attribution), presidiata da neighbors-old-readers.test.ts.
 */
export const NEIGHBORS_MODEL_SOURCES_SQL = "dn.source IN ('device', 'unifi')";

/** Un vicino non visto da più di tanti giorni si toglie alla scrittura successiva del suo apparato. */
const NEIGHBOR_RETENTION_DAYS = 90;

export function upsertNeighbors(
  deviceId: number,
  neighbors: Array<{
    localPort: string;
    remoteDevice: string;
    remotePort: string;
    protocol: string;
    remoteIp?: string;
    remoteMac?: string;
    remotePlatform?: string;
    /** Scheda MikroTik: `version=` del vicino. Non è un dato della topologia: `senzaCampiCavi` non lo toglie. */
    remoteVersion?: string;
  } & CampiViciniCavi>,
  source: NeighborSource = "device",
): void {
  const d = db();
  // Topologia fase 1: niente DELETE del giro. Chi c'è si aggiorna (timestamp =
  // adesso, first_seen resta), chi non c'è invecchia e diventa «non visto».
  // Due fonti sullo stesso apparato (poll SNMP/SSH e UniFi) non si cancellano
  // più a vicenda. ON CONFLICT copre anche due voci uguali nello stesso giro.
  // T2 (spec §13.5.7, R7; revisione del Task 1): la chiave unica non contiene la fonte, quindi una fonte nuova (ssh, snmp,
  // host) sulla chiave di un vicino `device`/`unifi` gli cambierebbe fonte e lo toglierebbe alla mappa di T1. La WHERE la
  // lascia stare (le colonne nuove dei vicini si aggiornano a parte, qui sotto); una fonte di oggi sopra una nuova sì.
  const ins = d.prepare(`
    INSERT INTO device_neighbors (device_id, local_port, remote_device_name, remote_port, protocol, remote_ip, remote_mac, remote_platform, source, first_seen, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(device_id, local_port, remote_device_name, remote_port) DO UPDATE SET
      protocol = excluded.protocol,
      remote_ip = excluded.remote_ip,
      remote_mac = excluded.remote_mac,
      remote_platform = excluded.remote_platform,
      source = excluded.source,
      timestamp = excluded.timestamp
    WHERE NOT (device_neighbors.source IN ('device', 'unifi') AND excluded.source NOT IN ('device', 'unifi'))
  `);
  // Potatura (revisione dei Task 4 e 6 di T2; R7 vince su §13.5.1, piano «Scelte» punto 9): le fonti di oggi potano tutte le
  // righe vecchie dell'apparato, come prima; una fonte nuova (ssh, snmp, host) solo le proprie. Prima di questa regola la
  // prima scrittura di una lettura accesa cancellava un vicino `device` di 91 giorni che T1 mostra «non visto».
  const fonteDiOggi = source === "device" || source === "unifi";
  const prune = fonteDiOggi
    ? d.prepare("DELETE FROM device_neighbors WHERE device_id = ? AND timestamp < datetime('now', ?)")
    : d.prepare("DELETE FROM device_neighbors WHERE device_id = ? AND source = ? AND timestamp < datetime('now', ?)");
  d.transaction(() => {
    for (const n of neighbors) {
      ins.run(deviceId, n.localPort, n.remoteDevice, n.remotePort, n.protocol, n.remoteIp ?? null, n.remoteMac ?? null, n.remotePlatform ?? null, source);
    }
    if (fonteDiOggi) prune.run(deviceId, `-${NEIGHBOR_RETENTION_DAYS} days`);
    else prune.run(deviceId, source, `-${NEIGHBOR_RETENTION_DAYS} days`);
  })();

  // T2 (spec §13.5.7): le colonne nuove con un'istruzione a parte, dopo quella di oggi e solo se lo schema le ha. Un
  // errore qui non tocca i vicini già scritti (I34): si scrive nel log col solo messaggio di SQLite, senza dati.
  const conCavi = neighbors.filter((n) => n.discoveredBy !== undefined || n.localPortIndex !== undefined
    || n.remotePortIndex !== undefined || n.remoteCaps !== undefined);
  if (conCavi.length > 0 && schemaCaviPresente()) {
    try {
      const up = d.prepare(`UPDATE device_neighbors SET
          discovered_by = COALESCE(?, discovered_by), local_port_index = COALESCE(?, local_port_index),
          remote_port_index = COALESCE(?, remote_port_index), remote_caps = COALESCE(?, remote_caps)
        WHERE device_id = ? AND local_port = ? AND remote_device_name = ? AND remote_port = ?`);
      d.transaction(() => {
        for (const n of conCavi) {
          up.run(n.discoveredBy ?? null, n.localPortIndex ?? null, n.remotePortIndex ?? null, n.remoteCaps ?? null,
            deviceId, n.localPort, n.remoteDevice, n.remotePort);
        }
      })();
    } catch (e) {
      console.error(`[db-tenant] apparato #${deviceId}: colonne nuove dei vicini non scritte (${e instanceof Error ? e.message : "errore"})`);
    }
  }

  // Scheda MikroTik: la versione annunciata dal vicino, con un'istruzione a parte (come le colonne dei cavi) e solo se lo schema
  // ha la colonna. COALESCE: un giro che non la legge non cancella quella di prima.
  const conVersione = neighbors.filter((n) => n.remoteVersion);
  if (conVersione.length > 0 && livelloSchemaSchedaMk(d) >= 1) {
    try {
      const up = d.prepare(`UPDATE device_neighbors SET remote_version = ?
        WHERE device_id = ? AND local_port = ? AND remote_device_name = ? AND remote_port = ?`);
      d.transaction(() => {
        for (const n of conVersione) up.run(n.remoteVersion, deviceId, n.localPort, n.remoteDevice, n.remotePort);
      })();
    } catch (e) {
      console.error(`[db-tenant] apparato #${deviceId}: versione dei vicini non scritta (${e instanceof Error ? e.message : "errore"})`);
    }
  }

  // Attribution v2: i vicini LLDP/CDP appena scritti sono evidenza per gli host remoti. Solo per le fonti di oggi: le
  // nuove non entrano nell'attribuzione (NEIGHBORS_MODEL_SOURCES_SQL), e il ricalcolo scriverebbe lo stesso sulle evidenze
  // (observed_at, expires_at) a ogni lettura accesa (spec §13.5.7, «Come si scrive»; revisione del Task 1 di T2).
  if (source !== "device" && source !== "unifi") return;
  try {
    const { recomputeAttributionSafe } = require("@/lib/attribution/recompute") as typeof import("@/lib/attribution/recompute");
    const touched = d.prepare(
      `SELECT DISTINCT h.id FROM hosts h
       JOIN device_neighbors dn ON dn.device_id = ?
        AND ((dn.remote_mac IS NOT NULL AND dn.remote_mac = h.mac)
          OR (dn.remote_ip IS NOT NULL AND dn.remote_ip = h.ip))`
    ).all(deviceId) as Array<{ id: number }>;
    for (const t of touched) recomputeAttributionSafe(t.id, "scan");
  } catch (e) {
    console.error("[attribution] recompute da neighbors fallito:", e);
  }
}

export function getNeighborsByDevice(deviceId: number): DbNeighborEntry[] {
  // Solo l'ultimo giro per fonte: la scheda «Neighbors» mostra i vicini di adesso.
  return db().prepare(
    `SELECT dn.* FROM device_neighbors dn
      WHERE dn.device_id = ? AND ${NEIGHBORS_LATEST_ROUND_SQL}
      ORDER BY dn.local_port, dn.protocol`
  ).all(deviceId) as DbNeighborEntry[];
}

// ═══════════════════════════════════════════════════════════════════════════
// TOPOLOGIA T2 — fatti delle letture in più (spec 2026-10-14 §13.5.7)
// ═══════════════════════════════════════════════════════════════════════════

/** Lo schema delle letture in più c'è in questo tenant (annotato all'apertura, `getTenantDb`). */
export function schemaCaviPresente(): boolean {
  const d = db();
  const v = SCHEMA_CAVI.get(d);
  if (v !== undefined) return v;
  const ok = verificaSchemaCavi(d);
  SCHEMA_CAVI.set(d, ok);
  return ok;
}

/** Riguarda lo schema e aggiorna l'annotazione (per le prove, e per chi ha appena riparato un tenant a mano). */
export function rileggiSchemaCavi(): boolean {
  const d = db();
  const ok = verificaSchemaCavi(d);
  SCHEMA_CAVI.set(d, ok);
  return ok;
}

/** Connessioni su cui il rifiuto per schema sotto il livello 2 è già stato detto (una riga sola, non una per apparato e giro). */
const AVVISATO_SCHEMA_MK = new WeakSet<Database.Database>();

/** Bridge, porte e bond di un MikroTik per la scheda (Task 8, ADR 0027). Una parte null = non letta: la sua tabella non si tocca. */
export interface SchedaMkTopologia { bridge: RigaBridgeMk[] | null; porte: RigaPortaBridgeMk[] | null; bond: RigaBondMk[] | null }

const COLONNE_MK_BRIDGE = ["name", "mac_address", "mtu", "actual_mtu", "l2mtu", "arp", "arp_timeout", "protocol_mode", "priority",
  "fast_forward", "igmp_snooping", "dhcp_snooping", "vlan_filtering", "pvid", "frame_types", "ingress_filtering", "ether_type",
  "ageing_time", "forward_delay", "max_message_age", "comment", "running", "disabled"] as const satisfies ReadonlyArray<keyof RigaBridgeMk>;
const COLONNE_MK_PORTA = ["interface", "bridge", "pvid", "priority", "path_cost", "internal_path_cost", "edge", "point_to_point", "horizon",
  "hw", "hw_offload", "frame_types", "ingress_filtering", "bpdu_guard", "trusted", "inactive", "disabled", "dynamic", "comment",
] as const satisfies ReadonlyArray<keyof RigaPortaBridgeMk>;
const COLONNE_MK_BOND = ["name", "mode", "slaves", "transmit_hash_policy", "mlag_id", "link_monitoring", "mii_interval", "lacp_rate",
  "mtu", "comment", "running", "disabled"] as const satisfies ReadonlyArray<keyof RigaBondMk>;

/** Un valore di una riga della scheda per SQLite: boolean → 0/1, lista (slaves) → testo con le virgole. */
function valoreMk(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (Array.isArray(v)) return v.join(",");
  return v as string | number;
}

/**
 * Bridge, porte e bond di un MikroTik nelle tabelle della scheda: una fotografia per apparato, non la storia. Per ogni parte
 * letta (anche vuota) si cancellano le righe dell'apparato e si scrivono quelle lette con lo stesso `seen_at`; una parte null
 * (comando non riuscito, «non so») non tocca la sua tabella e le righe dell'ultima lettura buona restano con la loro età. Una
 * transazione per le tre tabelle: o tutto o niente. null = schema sotto il livello 2 (migrazione non fatta o fallita).
 */
export function scriviSchedaMikrotikTopologia(deviceId: number, s: SchedaMkTopologia, adesso: Date = new Date()):
  { bridge: number; porte: number; bond: number } | null {
  const d = db();
  const livello = livelloSchemaSchedaMk(d);
  if (livello < 2) {
    // Rifiuto muto no (revisione del Task 9): si dice una volta per connessione, senza nomi.
    if (!AVVISATO_SCHEMA_MK.has(d)) {
      AVVISATO_SCHEMA_MK.add(d);
      console.warn(`[db-tenant] scheda mikrotik: schema al livello ${livello}, sotto il 2: bridge, porte e bond non si scrivono`);
    }
    return null;
  }
  const ora = adesso.toISOString().slice(0, 19).replace("T", " ");
  const out = { bridge: 0, porte: 0, bond: 0 };
  const sostituisci = <R extends object>(tabella: string, colonne: ReadonlyArray<keyof R & string>, righe: R[]): number => {
    d.prepare(`DELETE FROM ${tabella} WHERE device_id = ?`).run(deviceId);
    const ins = d.prepare(`INSERT OR REPLACE INTO ${tabella} (device_id, ${colonne.join(", ")}, seen_at) VALUES (?, ${colonne.map(() => "?, ").join("")}?)`);
    for (const r of righe) ins.run(deviceId, ...colonne.map((c) => valoreMk(r[c])), ora);
    // Due righe con la stessa chiave nella stessa uscita: vince l'ultima, ma si dice (solo i numeri: niente nomi nel log).
    const scritte = (d.prepare(`SELECT COUNT(*) AS n FROM ${tabella} WHERE device_id = ?`).get(deviceId) as { n: number }).n;
    if (scritte < righe.length) {
      console.warn(`[db-tenant] scheda mikrotik: ${tabella} apparato ${deviceId}, righe lette ${righe.length}, scritte ${scritte} (chiavi doppie)`);
    }
    return scritte;
  };
  d.transaction(() => {
    if (s.bridge) out.bridge = sostituisci("mikrotik_bridge", COLONNE_MK_BRIDGE, s.bridge);
    if (s.porte) out.porte = sostituisci("mikrotik_bridge_port", COLONNE_MK_PORTA, s.porte);
    if (s.bond) out.bond = sostituisci("mikrotik_bond", COLONNE_MK_BOND, s.bond);
  })();
  return out;
}

/** Le colonne 0/1 delle tre tabelle della scheda, rilette come boolean (le altre restano come sono; `slaves` torna lista). */
const BOOL_MK = new Set(["fast_forward", "igmp_snooping", "dhcp_snooping", "vlan_filtering", "ingress_filtering", "running", "disabled", "hw",
  "hw_offload", "bpdu_guard", "trusted", "inactive", "dynamic"]);
const BOOL_MK_SEMPRE = new Set(["running", "disabled", "hw_offload", "inactive", "dynamic"]); // dai segni: mai null

function rigaMk<R>(r: Record<string, unknown>): R {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === "device_id" || k === "seen_at") continue;
    if (BOOL_MK.has(k)) o[k] = v === null || v === undefined ? (BOOL_MK_SEMPRE.has(k) ? false : null) : v === 1;
    else if (k === "slaves") o[k] = typeof v === "string" && v !== "" ? v.split(",") : [];
    else o[k] = v;
  }
  return o as R;
}

const SCHEDA_MK_VUOTA = { bridge: [], porte: [], bond: [], letto_il: null, vlanBridge: null, vlan: null, dns: null };

// ── Livello 3 (Task 10): VLAN dei bridge, interfacce VLAN, DNS, utenti ───────

const COLONNE_MK_VLAN_BRIDGE = ["bridge", "vlan_ids", "tagged", "untagged", "current_tagged", "current_untagged", "dynamic", "disabled",
  "comment"] as const satisfies ReadonlyArray<keyof RigaVlanBridgeMk>;
const COLONNE_MK_VLAN = ["name", "vlan_id", "interface", "mtu", "mac_address", "running", "disabled", "comment"] as const satisfies ReadonlyArray<keyof RigaVlanMk>;
const COLONNE_MK_DNS = ["servers", "dynamic_servers", "allow_remote_requests", "cache_size", "cache_used", "max_concurrent_queries",
  "use_doh_server"] as const satisfies ReadonlyArray<keyof RigaDnsMk>;
/** La colonna `grp` è `group` della riga (parola riservata in SQL). */
const COLONNE_MK_UTENTE = [["name", "name"], ["grp", "group"], ["address", "address"], ["last_logged_in", "last_logged_in"], ["disabled", "disabled"],
  ["comment", "comment"]] as const satisfies ReadonlyArray<readonly [string, keyof RigaUtenteMk]>;
/** Liste e 0/1 delle tabelle del livello 3, rilette come le dà il lettore. `dynamic`, `running`, `disabled` vengono dai segni: mai null. */
const LISTE_MK_V3 = new Set(["tagged", "untagged", "current_tagged", "current_untagged", "servers", "dynamic_servers"]);
const SEGNI_MK_V3 = new Set(["dynamic", "running", "disabled"]);

function rigaMkV3<R>(r: Record<string, unknown>, togli: ReadonlyArray<string> = []): R {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === "device_id" || k === "seen_at" || togli.includes(k)) continue;
    if (LISTE_MK_V3.has(k)) o[k] = typeof v === "string" && v !== "" ? v.split(",") : [];
    else if (SEGNI_MK_V3.has(k)) o[k] = v === 1;
    else if (k === "allow_remote_requests") o[k] = v === null || v === undefined ? null : v === 1;
    else o[k] = v;
  }
  return o as R;
}

/** Connessioni su cui il rifiuto per schema sotto il livello 3 è già stato detto. */
const AVVISATO_SCHEMA_MK_V3 = new WeakSet<Database.Database>();

/**
 * VLAN dei bridge, interfacce VLAN, DNS e utenti di un MikroTik (lettura `mikrotik_scheda`, Task 10): una fotografia per
 * tabella come `scriviSchedaMikrotikTopologia`. Parte null (non letta, «non so») → la tabella resta com'era; letta (anche
 * vuota) → DELETE dell'apparato e righe nuove con lo stesso `seen_at`. Una transazione per le quattro tabelle. false =
 * schema sotto il livello 3 (niente scritto, un avviso per connessione). Niente nomi nel log: gli utenti sono dati riservati.
 */
export function scriviSchedaMikrotikLettura(deviceId: number, r: RisultatoMkScheda, adesso: Date = new Date()): boolean {
  const d = db();
  const livello = livelloSchemaSchedaMk(d);
  if (livello < 3) {
    if (!AVVISATO_SCHEMA_MK_V3.has(d)) {
      AVVISATO_SCHEMA_MK_V3.add(d);
      console.warn(`[db-tenant] scheda mikrotik: schema al livello ${livello}, sotto il 3: VLAN, DNS e utenti non si scrivono`);
    }
    return false;
  }
  const ora = adesso.toISOString().slice(0, 19).replace("T", " ");
  const sostituisci = (tabella: string, colonne: ReadonlyArray<string>, righe: ReadonlyArray<ReadonlyArray<unknown>>): void => {
    d.prepare(`DELETE FROM ${tabella} WHERE device_id = ?`).run(deviceId);
    const ins = d.prepare(`INSERT OR REPLACE INTO ${tabella} (device_id, ${colonne.join(", ")}, seen_at) VALUES (?, ${colonne.map(() => "?, ").join("")}?)`);
    for (const valori of righe) ins.run(deviceId, ...valori.map(valoreMk), ora);
    const scritte = (d.prepare(`SELECT COUNT(*) AS n FROM ${tabella} WHERE device_id = ?`).get(deviceId) as { n: number }).n;
    if (scritte < righe.length) {
      console.warn(`[db-tenant] scheda mikrotik: ${tabella} apparato ${deviceId}, righe lette ${righe.length}, scritte ${scritte} (chiavi doppie)`);
    }
  };
  d.transaction(() => {
    if (r.vlanBridge) {
      sostituisci("mikrotik_bridge_vlan", ["pos", ...COLONNE_MK_VLAN_BRIDGE], r.vlanBridge.map((v, i) => [i, ...COLONNE_MK_VLAN_BRIDGE.map((c) => v[c])]));
    }
    if (r.vlan) sostituisci("mikrotik_vlan", COLONNE_MK_VLAN, r.vlan.map((v) => COLONNE_MK_VLAN.map((c) => v[c])));
    if (r.dns) sostituisci("mikrotik_dns", COLONNE_MK_DNS, [COLONNE_MK_DNS.map((c) => r.dns![c])]);
    if (r.utenti) sostituisci("mikrotik_user", COLONNE_MK_UTENTE.map(([c]) => c), r.utenti.map((u) => COLONNE_MK_UTENTE.map(([, k]) => u[k])));
  })();
  return true;
}

/**
 * Gli utenti di un MikroTik dall'ultima lettura buona: SOLO per GET /api/devices/[id]/mikrotik-utenti (admin). La scheda per
 * tutti (`leggiSchedaMikrotik`) non li porta. null = schema sotto il livello 3.
 */
export function leggiUtentiMikrotik(deviceId: number): { utenti: RigaUtenteMk[]; letto_il: string | null } | null {
  const d = db();
  if (livelloSchemaSchedaMk(d) < 3) return null;
  const righe = d.prepare("SELECT * FROM mikrotik_user WHERE device_id = ? ORDER BY name").all(deviceId) as Record<string, unknown>[];
  const date = righe.map((r) => r.seen_at).filter((s): s is string => typeof s === "string");
  return {
    utenti: righe.map((r) => {
      const u = rigaMkV3<Record<string, unknown>>(r);
      return Object.fromEntries(COLONNE_MK_UTENTE.map(([c, k]) => [k, u[c] ?? (k === "disabled" ? false : null)])) as RigaUtenteMk;
    }),
    letto_il: date.length > 0 ? date.reduce((a, b) => (b > a ? b : a)) : null,
  };
}

/**
 * Bridge, porte e bond dell'ultima fotografia di un MikroTik per la scheda (Task 9). Le porte portano ruolo e stato STP
 * dell'ultima lettura della topologia (`topology_port_facts`, fonte `device`, stessa porta), nella stessa query.
 * `vlanBridge`, `vlan`, `dns` (Task 10): le righe dell'ultima lettura buona, null se non ce n'è nessuna (mai letti, o schema
 * sotto il livello 3); gli utenti no (solo `leggiUtentiMikrotik`, per l'admin). Schema sotto il livello 2 → tutto vuoto.
 */
export function leggiSchedaMikrotik(deviceId: number): {
  bridge: RigaBridgeMk[]; porte: RigaPortaSchedaMk[]; bond: RigaBondMk[]; letto_il: string | null;
  vlanBridge: RigaVlanBridgeMk[] | null; vlan: RigaVlanMk[] | null; dns: RigaDnsMk | null;
} {
  const d = db();
  if (livelloSchemaSchedaMk(d) < 2) return { ...SCHEDA_MK_VUOTA };
  const bridge = (d.prepare("SELECT * FROM mikrotik_bridge WHERE device_id = ? ORDER BY name").all(deviceId) as Record<string, unknown>[]);
  const bond = (d.prepare("SELECT * FROM mikrotik_bond WHERE device_id = ? ORDER BY name").all(deviceId) as Record<string, unknown>[]);
  // Senza lo schema delle letture in più la tabella dei fatti non c'è: il ruolo STP resta null.
  const porte = (schemaCaviPresente()
    ? d.prepare(`SELECT p.*, f.stp_role AS stp_ruolo, f.stp_state AS stp_stato FROM mikrotik_bridge_port p
        LEFT JOIN topology_port_facts f ON f.device_id = p.device_id AND f.source = 'device' AND f.port_name = p.interface
          AND f.seen_at = (SELECT MAX(seen_at) FROM topology_port_facts WHERE device_id = p.device_id AND source = 'device')
        WHERE p.device_id = ? ORDER BY p.rowid`).all(deviceId)
    : d.prepare("SELECT *, NULL AS stp_ruolo, NULL AS stp_stato FROM mikrotik_bridge_port WHERE device_id = ? ORDER BY rowid").all(deviceId)) as Record<string, unknown>[];
  const date = [...bridge, ...porte, ...bond].map((r) => r.seen_at).filter((s): s is string => typeof s === "string");
  const v3 = livelloSchemaSchedaMk(d) >= 3;
  const vlanBridge = v3 ? d.prepare("SELECT * FROM mikrotik_bridge_vlan WHERE device_id = ? ORDER BY pos").all(deviceId) as Record<string, unknown>[] : [];
  const vlan = v3 ? d.prepare("SELECT * FROM mikrotik_vlan WHERE device_id = ? ORDER BY vlan_id, name").all(deviceId) as Record<string, unknown>[] : [];
  const dns = v3 ? d.prepare("SELECT * FROM mikrotik_dns WHERE device_id = ?").get(deviceId) as Record<string, unknown> | undefined : undefined;
  return {
    bridge: bridge.map((r) => rigaMk<RigaBridgeMk>(r)),
    porte: porte.map((r) => rigaMk<RigaPortaSchedaMk>(r)),
    bond: bond.map((r) => rigaMk<RigaBondMk>(r)),
    letto_il: date.length > 0 ? date.reduce((a, b) => (b > a ? b : a)) : null,
    vlanBridge: vlanBridge.length > 0 ? vlanBridge.map((r) => rigaMkV3<RigaVlanBridgeMk>(r, ["pos"])) : null,
    vlan: vlan.length > 0 ? vlan.map((r) => rigaMkV3<RigaVlanMk>(r)) : null,
    dns: dns ? rigaMkV3<RigaDnsMk>(dns) : null,
  };
}

/**
 * Data dei DATI della lettura «VLAN, DNS e utenti», una per sezione (revisione dei Task 10 e 11): VLAN = il `seen_at` più
 * recente di `mikrotik_bridge_vlan` e `mikrotik_vlan`; DNS = quello di `mikrotik_dns`. Mai l'ora dell'ultimo tentativo (può
 * essere fallito e non aver scritto niente) e mai la data di `mikrotik_user` (dato del solo admin: ha la sua, nella sua rotta).
 * null = schema sotto il livello 3.
 */
export function dateSchedaMikrotikV3(deviceId: number): { vlan_il: string | null; dns_il: string | null } | null {
  const d = db();
  if (livelloSchemaSchedaMk(d) < 3) return null;
  const r = d.prepare(`SELECT
      (SELECT MAX(il) FROM (SELECT MAX(seen_at) AS il FROM mikrotik_bridge_vlan WHERE device_id = ?
        UNION ALL SELECT MAX(seen_at) FROM mikrotik_vlan WHERE device_id = ?)) AS vlan_il,
      (SELECT MAX(seen_at) FROM mikrotik_dns WHERE device_id = ?) AS dns_il`).get(deviceId, deviceId, deviceId) as { vlan_il: string | null; dns_il: string | null };
  return { vlan_il: r.vlan_il ?? null, dns_il: r.dns_il ?? null };
}

// ── VLAN degli switch via SNMP (piano 2026-10-22 accorpamento, Task 8, ADR 0029) ──

export interface VlanSwitchDb {
  /** Task 13: VLAN native dal controller UniFi (vuota se mai lette o schema assente) e quando sono state lette. */
  nativa?: Array<{ if_index: number; vlan_id: number }>;
  nativa_letta_il?: string | null;
  vlan: Array<{ vlan_id: number; nome: string | null }>;
  porte: Array<{ vlan_id: number; if_index: number; egress: boolean; untagged: boolean | null }>;
  pvid: Array<{ if_index: number; pvid: number }>;
  lettura: {
    letto_il: string; tabella: LetturaVlanSwitch["tabella"]; mappa_porte: LetturaVlanSwitch["mappa_porte"]; n_vlan: number;
    ordine_bit: LetturaVlanSwitch["ordine_bit"]; porte_senza_mappa: number;
  } | null;
}

/** Connessioni su cui il rifiuto per schema assente è già stato detto. */
const AVVISATO_SCHEMA_SWITCH_VLAN = new WeakSet<Database.Database>();

/**
 * Le VLAN di uno switch nelle quattro tabelle: una fotografia per apparato, l'ultima lettura buona. DELETE delle righe
 * dell'apparato e INSERT di quelle lette, in UNA transazione (o tutto o niente). Solo con esito «letto» (anche vuoto): un
 * «non riuscito» o un «non so» LANCIA, così la regola «non so non scrive» non dipende da chi chiama e le righe di prima
 * restano con la loro data. false = schema assente (migrazione fallita): niente scritto, un avviso per connessione.
 */
export function scriviVlanSwitch(deviceId: number, l: LetturaVlanSwitch, adesso: Date = new Date()): boolean {
  if (l.esito !== "letto") {
    throw new Error(`scriviVlanSwitch: esito «${l.esito}», si scrive solo una lettura riuscita`);
  }
  const d = db();
  if (!schemaSwitchVlanPresente(d)) {
    if (!AVVISATO_SCHEMA_SWITCH_VLAN.has(d)) {
      AVVISATO_SCHEMA_SWITCH_VLAN.add(d);
      console.warn("[db-tenant] switch vlan: schema assente, le VLAN degli switch non si scrivono");
    }
    return false;
  }
  const ora = adesso.toISOString().slice(0, 19).replace("T", " ");
  const bool = (v: boolean | null): number | null => (v === null ? null : v ? 1 : 0);
  d.transaction(() => {
    for (const t of ["switch_vlan", "switch_vlan_porte", "switch_porta_pvid", "switch_vlan_lettura"]) {
      d.prepare(`DELETE FROM ${t} WHERE device_id = ?`).run(deviceId);
    }
    // OR REPLACE: due righe con la stessa chiave nella stessa lettura non devono costare tutta la fotografia (vince l'ultima),
    // ma si dice, come in `sostituisci` della scheda MikroTik (solo i numeri: niente nomi nel log).
    const scrivi = <R>(tabella: string, sql: string, righeLette: ReadonlyArray<R>, valori: (r: R) => Array<string | number | null>): number => {
      const ins = d.prepare(sql);
      for (const r of righeLette) ins.run(deviceId, ...valori(r));
      const scritte = (d.prepare(`SELECT COUNT(*) AS n FROM ${tabella} WHERE device_id = ?`).get(deviceId) as { n: number }).n;
      if (scritte < righeLette.length) {
        console.warn(`[db-tenant] switch vlan: ${tabella} apparato ${deviceId}, righe lette ${righeLette.length}, scritte ${scritte} (chiavi doppie)`);
      }
      return scritte;
    };
    const nVlan = scrivi("switch_vlan", "INSERT OR REPLACE INTO switch_vlan (device_id, vlan_id, nome) VALUES (?, ?, ?)", l.vlan,
      (v) => [v.vlan_id, v.nome]);
    scrivi("switch_vlan_porte", "INSERT OR REPLACE INTO switch_vlan_porte (device_id, vlan_id, if_index, egress, untagged) VALUES (?, ?, ?, ?, ?)", l.porte,
      (p) => [p.vlan_id, p.if_index, p.egress ? 1 : 0, bool(p.untagged)]);
    scrivi("switch_porta_pvid", "INSERT OR REPLACE INTO switch_porta_pvid (device_id, if_index, pvid) VALUES (?, ?, ?)", l.pvid,
      (p) => [p.if_index, p.pvid]);
    d.prepare(`INSERT INTO switch_vlan_lettura (device_id, letto_il, tabella, mappa_porte, n_vlan, ordine_bit, porte_senza_mappa)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(deviceId, ora, l.tabella, l.mappa_porte, nVlan, l.ordine_bit, l.porte_senza_mappa);
  })();
  return true;
}

/** L'ultima fotografia delle VLAN di uno switch (ordinata per VLAN e porta). Mai letta o schema assente → liste vuote, lettura null. */
export function leggiVlanSwitchDb(deviceId: number): VlanSwitchDb {
  const d = db();
  let nativa: VlanSwitchDb["nativa"] = [];
  let nativa_letta_il: string | null = null;
  if (schemaSwitchVlanNativaPresente(d)) {
    const righe = d.prepare("SELECT if_index, vlan_id, letto_il FROM switch_vlan_nativa WHERE device_id = ? ORDER BY if_index")
      .all(deviceId) as Array<{ if_index: number; vlan_id: number; letto_il: string }>;
    nativa = righe.map((r) => ({ if_index: r.if_index, vlan_id: r.vlan_id }));
    nativa_letta_il = righe.reduce<string | null>((m, r) => (m === null || r.letto_il > m ? r.letto_il : m), null);
  }
  if (!schemaSwitchVlanPresente(d)) return { nativa, nativa_letta_il, vlan: [], porte: [], pvid: [], lettura: null };
  const vlan = d.prepare("SELECT vlan_id, nome FROM switch_vlan WHERE device_id = ? ORDER BY vlan_id").all(deviceId) as VlanSwitchDb["vlan"];
  const porte = (d.prepare("SELECT vlan_id, if_index, egress, untagged FROM switch_vlan_porte WHERE device_id = ? ORDER BY vlan_id, if_index")
    .all(deviceId) as Array<{ vlan_id: number; if_index: number; egress: number; untagged: number | null }>)
    .map((r) => ({ vlan_id: r.vlan_id, if_index: r.if_index, egress: r.egress === 1, untagged: r.untagged === null ? null : r.untagged === 1 }));
  const pvid = d.prepare("SELECT if_index, pvid FROM switch_porta_pvid WHERE device_id = ? ORDER BY if_index").all(deviceId) as VlanSwitchDb["pvid"];
  const lettura = d.prepare(`SELECT letto_il, tabella, mappa_porte, n_vlan, ordine_bit, porte_senza_mappa
    FROM switch_vlan_lettura WHERE device_id = ?`).get(deviceId) as VlanSwitchDb["lettura"] | undefined;
  return { nativa, nativa_letta_il, vlan, porte, pvid, lettura: lettura ?? null };
}

/**
 * Le VLAN native di uno switch dal controller UniFi (Task 13): fotografia per apparato, DELETE + INSERT in UNA transazione.
 * La chiama la sync UniFi solo con le reti lette e lo switch connesso (un «non so» non arriva qui). false = schema assente.
 */
export function scriviVlanNativaSwitch(deviceId: number, righe: ReadonlyArray<{ if_index: number; vlan_id: number }>, adesso: Date = new Date()): boolean {
  const d = db();
  if (!schemaSwitchVlanNativaPresente(d)) return false;
  const ora = adesso.toISOString().slice(0, 19).replace("T", " ");
  d.transaction(() => {
    d.prepare("DELETE FROM switch_vlan_nativa WHERE device_id = ?").run(deviceId);
    const ins = d.prepare("INSERT OR REPLACE INTO switch_vlan_nativa (device_id, if_index, vlan_id, letto_il) VALUES (?, ?, ?, ?)");
    for (const r of righe) ins.run(deviceId, r.if_index, r.vlan_id, ora);
  })();
  return true;
}

/**
 * Quante colonne ha la matrice VLAN dello switch (numero della tab VLAN): la stessa unione di `matriceVlanSwitch` — VLAN lette,
 * VLAN delle porte, PVID — in una query. 0 = nessuna o schema assente.
 */
export function contaVlanSwitch(deviceId: number): number {
  const d = db();
  if (!schemaSwitchVlanPresente(d)) return 0;
  return (d.prepare(`SELECT COUNT(*) AS n FROM (
      SELECT vlan_id AS v FROM switch_vlan WHERE device_id = ?
      UNION SELECT vlan_id FROM switch_vlan_porte WHERE device_id = ?
      UNION SELECT pvid FROM switch_porta_pvid WHERE device_id = ?)`).get(deviceId, deviceId, deviceId) as { n: number }).n;
}

/** Quanti bridge ha l'ultima fotografia (una COUNT, per le tab di `GET /api/devices/[id]`); null = schema sotto il livello 2. */
export function contaBridgeMikrotik(deviceId: number): { bridge: number; letto_il: string | null } | null {
  const d = db();
  if (livelloSchemaSchedaMk(d) < 2) return null;
  const r = d.prepare("SELECT COUNT(*) AS n, MAX(seen_at) AS il FROM mikrotik_bridge WHERE device_id = ?").get(deviceId) as { n: number; il: string | null };
  return { bridge: r.n, letto_il: r.il };
}

/** Chi ha letto i fatti (spec §13.5.7): il lettore, mai la marca. */
/** `collector`: fatti di porta letti da un collector JSON 1.0 (acquisizione modulare, decisione D4), solo istanza 0/CIST. */
export type FonteFatti = "device" | "controller" | "snmp" | "host" | "collector";

/**
 * Un fatto di porta come lo scrive un lettore. `port_key`: «i:<indice>» se l'indice è noto, altrimenti «n:<nome
 * normalizzato>» (minuscole, senza spazi). Un campo ASSENTE (undefined) da tutte le righe di una scrittura = «questo
 * lettore non lo sa»: resta com'era. Un campo `null` = letto e vuoto: si scrive null. Contratto dei lettori (piano di T2,
 * «Scelte» punto 8): ogni riga porta tutte le colonne che il lettore conosce, null dove il valore è vuoto o non noto per
 * quella riga; un campo assente solo da ALCUNE righe vale null in quelle righe, non «resta». Così una riga dell'ultimo
 * giro non tiene mai un valore di un giro vecchio (vale anche per `FattoBridgeIn`: `root_port` null = è la radice).
 */
export interface FattoPortaIn {
  port_key: string;
  port_name: string;
  port_index?: number | null;
  /** 'physical' | 'lag' | 'vlan' | 'vrrp' | 'bridge' | 'tunnel' | 'wireless' | 'other' */
  if_kind?: string | null;
  running?: number | null;
  in_bridge?: number | null;
  bridge?: string | null;
  lag_group?: string | null;
  lag_partner?: string | null;
  /** 'attivo' | 'riserva' (membro di un bond letto dall'host). */
  lag_state?: string | null;
  /** 'root' | 'designated' | 'alternate' | 'backup' | 'disabled' */
  stp_role?: string | null;
  /** 'forwarding' | 'discarding' | 'learning' | 'disabled' */
  stp_state?: string | null;
  designated_bridge?: string | null;
  designated_port?: string | null;
  path_cost?: number | null;
  edge?: number | null;
  point_to_point?: number | null;
  sending_rstp?: number | null;
  bpdu_rx?: number | null;
}

/** Un bridge per istanza (0 = albero comune). `root_port` null con `root_id` uguale a `bridge_id` = la radice. */
export interface FattoBridgeIn {
  bridge_name: string;
  instance: number;
  protocol?: string | null;
  priority?: number | null;
  bridge_id?: string | null;
  root_id?: string | null;
  regional_root_id?: string | null;
  region_name?: string | null;
  region_revision?: number | null;
  config_digest?: string | null;
  vlans?: string | null;
  root_port?: string | null;
  root_path_cost?: number | null;
}

export interface MacApparatoIn { mac: string; port_key: string | null }

export interface FattiLettura {
  porte: readonly FattoPortaIn[];
  bridge: readonly FattoBridgeIn[];
  macs: readonly MacApparatoIn[];
}

const COLONNE_PORTA = ["port_index", "if_kind", "running", "in_bridge", "bridge", "lag_group", "lag_partner", "lag_state", "stp_role",
  "stp_state", "designated_bridge", "designated_port", "path_cost", "edge", "point_to_point", "sending_rstp", "bpdu_rx"] as const;
const COLONNE_BRIDGE = ["protocol", "priority", "bridge_id", "root_id", "regional_root_id", "region_name", "region_revision",
  "config_digest", "vlans", "root_port", "root_path_cost"] as const;
/** I fatti non visti da tanti giorni si tolgono alla scrittura successiva dello stesso apparato (come i vicini). */
const FATTI_RETENTION_DAYS = 90;

/** Le colonne che un lettore conosce: presenti (anche null) in almeno una riga della scrittura. Elenco chiuso: niente SQL dal dato. */
function colonneNote<C extends string>(righe: readonly object[], tutte: readonly C[]): C[] {
  return tutte.filter((c) => righe.some((r) => (r as Record<string, unknown>)[c] !== undefined));
}

/**
 * Scrive i fatti di un giro di un lettore su un apparato (spec §13.5.7): una transazione, INSERT … ON CONFLICT DO UPDATE,
 * niente DELETE del giro, e la potatura delle righe dell'apparato non viste da 90 giorni. `adesso` è l'ora del giro, una
 * per tutte le righe (così «ultimo giro» = `seen_at` più recente meno 5 minuti). null = schema assente: non si scrive.
 */
export function scriviFattiTopologia(deviceId: number, fonte: FonteFatti, fatti: FattiLettura, adesso: Date = new Date()):
  { porte: number; bridge: number; macs: number } | null {
  if (!schemaCaviPresente()) return null;
  const d = db();
  const ora = adesso.toISOString().slice(0, 19).replace("T", " ");
  const cp = colonneNote(fatti.porte, COLONNE_PORTA);
  const cb = colonneNote(fatti.bridge, COLONNE_BRIDGE);
  const insP = d.prepare(`INSERT INTO topology_port_facts (device_id, source, port_key, port_name, ${cp.map((c) => `${c}, `).join("")}first_seen, seen_at)
    VALUES (?, ?, ?, ?, ${cp.map(() => "?, ").join("")}?, ?)
    ON CONFLICT(device_id, source, port_key) DO UPDATE SET port_name = excluded.port_name, ${cp.map((c) => `${c} = excluded.${c}, `).join("")}seen_at = excluded.seen_at`);
  const insB = d.prepare(`INSERT INTO topology_bridge_facts (device_id, source, bridge_name, instance, ${cb.map((c) => `${c}, `).join("")}first_seen, seen_at)
    VALUES (?, ?, ?, ?, ${cb.map(() => "?, ").join("")}?, ?)
    ON CONFLICT(device_id, source, bridge_name, instance) DO UPDATE SET ${cb.map((c) => `${c} = excluded.${c}, `).join("")}seen_at = excluded.seen_at`);
  const insM = d.prepare(`INSERT INTO topology_device_macs (device_id, mac, source, port_key, seen_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(device_id, mac) DO UPDATE SET source = excluded.source, port_key = COALESCE(excluded.port_key, port_key), seen_at = excluded.seen_at`);
  const limite = `datetime(?, '-${FATTI_RETENTION_DAYS} days')`;
  const out = { porte: 0, bridge: 0, macs: 0 };
  d.transaction(() => {
    for (const p of fatti.porte) {
      const r = p as unknown as Record<string, unknown>;
      insP.run(deviceId, fonte, p.port_key, p.port_name, ...cp.map((c) => r[c] ?? null), ora, ora);
      out.porte++;
    }
    for (const b of fatti.bridge) {
      const r = b as unknown as Record<string, unknown>;
      insB.run(deviceId, fonte, b.bridge_name, b.instance, ...cb.map((c) => r[c] ?? null), ora, ora);
      out.bridge++;
    }
    const visti = new Set<string>();
    for (const m of fatti.macs) {
      const mac = normalizeMacForStorage(m.mac);
      if (!mac || visti.has(mac)) continue;
      visti.add(mac);
      insM.run(deviceId, mac, fonte, m.port_key, ora);
      out.macs++;
    }
    d.prepare(`DELETE FROM topology_port_facts WHERE device_id = ? AND seen_at < ${limite}`).run(deviceId, ora);
    d.prepare(`DELETE FROM topology_bridge_facts WHERE device_id = ? AND seen_at < ${limite}`).run(deviceId, ora);
    d.prepare(`DELETE FROM topology_device_macs WHERE device_id = ? AND seen_at < ${limite}`).run(deviceId, ora);
  })();
  return out;
}

/** Porta di uscita secondo il controller, per indice, e da dove la ricava (`uplink.port_idx`, `uplink_source`). */
export function setUplinkCavi(deviceId: number, porta: number | null, origine: string | null): boolean {
  if (!schemaCaviPresente()) return false;
  db().prepare("UPDATE network_devices SET uplink_local_port_idx = ?, uplink_source = ? WHERE id = ?").run(porta, origine, deviceId);
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// TOPOLOGIA — unioni e separazioni a mano (piano 2026-10-16, ADR 0021)
// Righe attive = `tolto_il IS NULL`; togliere = `tolto_da`/`tolto_il`, mai DELETE: la riga è la storia (chi e quando).
// ═══════════════════════════════════════════════════════════════════════════

/** Le tabelle delle unioni ci sono in questo tenant, con i loro indici (annotato all'apertura, `getTenantDb`). */
export function schemaUnioniPresente(): boolean {
  const d = db();
  const v = SCHEMA_UNIONI.get(d);
  if (v !== undefined) return v;
  const ok = verificaSchemaUnioni(d);
  SCHEMA_UNIONI.set(d, ok);
  return ok;
}

/** Riguarda lo schema e aggiorna l'annotazione (per le prove, e per chi ha appena riparato un tenant a mano). */
export function rileggiSchemaUnioni(): boolean {
  const d = db();
  const ok = verificaSchemaUnioni(d);
  SCHEMA_UNIONI.set(d, ok);
  return ok;
}

/** Le righe attive, in ordine (gruppo e membro; membro e altro). Schema assente → vuote: la mappa di oggi. */
export function getRigheScelte(): { unioni: RigaUnione[]; separazioni: RigaSeparazione[] } {
  if (!schemaUnioniPresente()) return { unioni: [], separazioni: [] };
  const d = db();
  return {
    unioni: d.prepare(`SELECT id, gruppo, membro, creato_da, creato_il FROM topology_unioni
      WHERE tolto_il IS NULL ORDER BY gruppo, membro`).all() as RigaUnione[],
    separazioni: d.prepare(`SELECT id, membro, altro, creato_da, creato_il FROM topology_separazioni
      WHERE tolto_il IS NULL ORDER BY membro, altro`).all() as RigaSeparazione[],
  };
}

/** Una riga da togliere non è più attiva (un altro l'ha tolta nel frattempo, o non c'è): il piano non si scrive (409). */
export class UnioniCambiate extends Error {
  constructor(message: string = TESTI_UNIONI.cambiato) {
    super(message);
    this.name = "UnioniCambiate";
  }
}

/** I membri come li scrivono le rotte (piano, «Dato»): id della mappa; in una separazione `membro` è sempre un host. */
const MEMBRO_UNIONE = /^(host|dev):[1-9]\d{0,9}$/;
const MEMBRO_SEPARAZIONE = /^host:[1-9]\d{0,9}$/;

/**
 * Scrive un piano delle rotte in UNA transazione: prima toglie (`tolto_da`/`tolto_il`, solo righe ancora attive: altrimenti
 * `UnioniCambiate` e niente è scritto), poi aggiunge. Le righe «nuovo» prendono tutte lo stesso gruppo, `MAX(gruppo) + 1` su
 * tutte le righe, tolte comprese: un numero di gruppo non torna. `adesso` (forma di datetime('now')) per le prove; senza, l'ora
 * UTC del DB. Un membro scritto male è un errore di chi ha fatto il piano, e non si scrive.
 */
export function scriviPianoUnioni(piano: PianoUnioni, da: string, adesso?: string): void {
  for (const m of [...piano.aggiungiUnioni.map((u) => u.membro), ...piano.aggiungiSeparazioni.map((s) => s.altro)]) {
    if (!MEMBRO_UNIONE.test(m)) throw new Error(`Membro non valido: ${JSON.stringify(m)}`);
  }
  for (const s of piano.aggiungiSeparazioni) {
    if (!MEMBRO_SEPARAZIONE.test(s.membro)) throw new Error(`Membro della separazione non valido: ${JSON.stringify(s.membro)}`);
  }
  // I gruppi negativi sono solo in memoria (la misura sulle copie): nel DB un gruppo è un intero positivo.
  for (const u of piano.aggiungiUnioni) {
    if (u.gruppo !== "nuovo" && !(Number.isInteger(u.gruppo) && u.gruppo > 0)) throw new Error(`Gruppo non valido: ${JSON.stringify(u.gruppo)}`);
  }
  const d = db();
  d.transaction(() => {
    const il = adesso ?? (d.prepare("SELECT datetime('now') AS ora").get() as { ora: string }).ora;
    const togli = (tabella: "topology_unioni" | "topology_separazioni", ids: readonly number[]): void => {
      const upd = d.prepare(`UPDATE ${tabella} SET tolto_da = ?, tolto_il = ? WHERE id = ? AND tolto_il IS NULL`);
      for (const id of ids) {
        if (upd.run(da, il, id).changes !== 1) throw new UnioniCambiate();
      }
    };
    togli("topology_unioni", piano.togliUnioni);
    togli("topology_separazioni", piano.togliSeparazioni);
    const nuovo = piano.aggiungiUnioni.some((u) => u.gruppo === "nuovo")
      ? (d.prepare("SELECT COALESCE(MAX(gruppo), 0) + 1 AS g FROM topology_unioni").get() as { g: number }).g
      : null;
    const insU = d.prepare("INSERT INTO topology_unioni (gruppo, membro, creato_da, creato_il) VALUES (?, ?, ?, ?)");
    for (const u of piano.aggiungiUnioni) insU.run(u.gruppo === "nuovo" ? nuovo : u.gruppo, u.membro, da, il);
    const insS = d.prepare("INSERT INTO topology_separazioni (membro, altro, creato_da, creato_il) VALUES (?, ?, ?, ?)");
    for (const s of piano.aggiungiSeparazioni) insS.run(s.membro, s.altro, da, il);
  })();
}

// ═══════════════════════════════════════════════════════════════════════════
// SYNC DA CONTROLLER (UniFi) — letture in blocco, collegamento, transazione
// ═══════════════════════════════════════════════════════════════════════════
// Una query per tutto il giro invece di una per apparato (no N+1). Qui e non
// in `devices/physical-device-db.ts`: quel modulo passa da `getDb()` del
// facade, che risolve il tenant con un `require` di db-tenant.

/**
 * MAC noti di ogni network_device: dell'host collegato (`host_id`, o stesso
 * IP in qualunque rete) e dell'identità fisica. I MAC escono come sono
 * scritti: li normalizza chi li confronta.
 */
export function getNetworkDeviceKnownMacs(): Array<{ device_id: number; mac: string }> {
  return db().prepare(`
    SELECT nd.id AS device_id, h.mac AS mac
      FROM network_devices nd JOIN hosts h ON h.id = nd.host_id
     WHERE h.mac IS NOT NULL AND h.mac <> ''
    UNION
    SELECT nd.id, h.mac
      FROM network_devices nd JOIN hosts h ON h.ip = nd.host
     WHERE h.mac IS NOT NULL AND h.mac <> ''
    UNION
    SELECT nd.id, p.primary_mac
      FROM network_devices nd JOIN physical_devices p ON p.id = nd.physical_device_id
     WHERE p.primary_mac IS NOT NULL AND p.primary_mac <> ''
  `).all() as Array<{ device_id: number; mac: string }>;
}

/** Ancore d'identità delle `physical_devices` esistenti: solo lettura, per collegare senza creare. */
export function getPhysicalDeviceAnchors(): Array<{ id: number; serial_number: string | null; primary_mac: string | null }> {
  return db().prepare(
    "SELECT id, serial_number, primary_mac FROM physical_devices WHERE serial_number IS NOT NULL OR primary_mac IS NOT NULL"
  ).all() as Array<{ id: number; serial_number: string | null; primary_mac: string | null }>;
}

/** Quante porte e quanti vicini ha oggi ogni apparato (due query, per la guardia «zero sospetto»). */
export function getPortAndNeighborCountsByDevice(): Map<number, { ports: number; neighbors: number }> {
  const d = db();
  const out = new Map<number, { ports: number; neighbors: number }>();
  const entry = (id: number) => {
    let e = out.get(id);
    if (!e) {
      e = { ports: 0, neighbors: 0 };
      out.set(id, e);
    }
    return e;
  };
  for (const r of d.prepare("SELECT device_id, COUNT(*) AS n FROM switch_ports GROUP BY device_id").all() as Array<{ device_id: number; n: number }>) {
    entry(r.device_id).ports = r.n;
  }
  // Solo le fonti del modello di oggi (revisione finale di T2, M3): le righe delle letture in più (ssh, snmp, controller, host)
  // non le scrive il controller, e contarle farebbe dire «nel DB ce ne sono N» per righe che non sono sue (R7).
  for (const r of d.prepare("SELECT device_id, COUNT(*) AS n FROM device_neighbors WHERE source IN ('device', 'unifi') GROUP BY device_id").all() as Array<{ device_id: number; n: number }>) {
    entry(r.device_id).neighbors = r.n;
  }
  return out;
}

/** Collega un network_device a un'identità fisica GIÀ esistente. */
export function linkNetworkDeviceToPhysicalDevice(deviceId: number, physicalDeviceId: number): void {
  db().prepare(
    "UPDATE network_devices SET physical_device_id = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(physicalDeviceId, deviceId);
}

/**
 * MAC del controller e uplink di un apparato (topologia fase 1). L'uplink si
 * scrive solo quando il controller lo riporta: se sparisce, quello di prima
 * resta con la sua data e invecchia («non visto»), come i vicini.
 */
export function setNetworkDeviceControllerFacts(
  deviceId: number,
  f: {
    controllerMac: string | null;
    uplinkMac: string | null;
    uplinkRemotePort: number | null;
    /** Cavo o wireless (topologia fase 2b): si scrive insieme all'uplink, mai da solo. */
    uplinkType: "wire" | "wireless" | null;
  },
): void {
  const d = db();
  if (f.controllerMac) {
    d.prepare("UPDATE network_devices SET controller_mac = ? WHERE id = ?").run(f.controllerMac, deviceId);
  }
  // Senza uplink nella lettura (offline, o il controller non lo riporta) restano
  // MAC, porta, tipo e data di prima: la lettura non sa niente di nuovo.
  if (f.uplinkMac) {
    d.prepare(
      "UPDATE network_devices SET uplink_mac = ?, uplink_remote_port = ?, uplink_type = ?, uplink_seen_at = datetime('now') WHERE id = ?",
    ).run(f.uplinkMac, f.uplinkRemotePort, f.uplinkType, deviceId);
  }
}

/**
 * Esegue `fn` in una transazione del DB del tenant corrente: o tutto o niente.
 * Le upsert che hanno già una loro transazione (`upsertSwitchPorts`,
 * `upsertNeighbors`) dentro diventano savepoint.
 */
export function runInTenantTransaction<T>(fn: () => T): T {
  return db().transaction(fn)();
}

// ═══════════════════════════════════════════════════════════════════════════
// DEVICE ROUTES (Routing Table)
// ═══════════════════════════════════════════════════════════════════════════

export interface DbRouteEntry {
  id: number;
  device_id: number;
  destination: string;
  gateway: string | null;
  interface_name: string | null;
  protocol: string;
  metric: number | null;
  distance: number | null;
  active: number;
  timestamp: string;
}

export function upsertRoutes(
  deviceId: number,
  routes: Array<{
    destination: string;
    gateway: string | null;
    interface_name: string | null;
    protocol: string;
    metric?: number;
    distance?: number;
    active: boolean;
  }>
): void {
  const d = db();
  const del = d.prepare("DELETE FROM routing_table WHERE device_id = ?");
  const ins = d.prepare(`
    INSERT INTO routing_table (device_id, destination, gateway, interface_name, protocol, metric, distance, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  d.transaction(() => {
    del.run(deviceId);
    for (const r of routes) {
      ins.run(deviceId, r.destination, r.gateway ?? null, r.interface_name ?? null, r.protocol, r.metric ?? null, r.distance ?? null, r.active ? 1 : 0);
    }
  })();
}

export function getRoutesByDevice(deviceId: number, activeOnly = false): DbRouteEntry[] {
  const sql = activeOnly
    ? "SELECT * FROM routing_table WHERE device_id = ? AND active = 1 ORDER BY protocol, destination"
    : "SELECT * FROM routing_table WHERE device_id = ? ORDER BY active DESC, protocol, destination";
  return db().prepare(sql).all(deviceId) as DbRouteEntry[];
}

// ═══════════════════════════════════════════════════════════════════════════
// DEVICE CREDENTIAL BINDINGS
// ═══════════════════════════════════════════════════════════════════════════

export interface DeviceCredentialBinding {
  id: number;
  device_id: number;
  credential_id: number | null;
  protocol_type: "ssh" | "snmp" | "winrm" | "api" | "redfish" | "onvif";
  port: number;
  sort_order: number;
  inline_username: string | null;
  inline_encrypted_password: string | null;
  test_status: "success" | "failed" | "untested";
  test_message: string | null;
  tested_at: string | null;
  auto_detected: number;
  created_at: string;
  credential_name?: string | null;
  credential_type?: string | null;
}

export function getDeviceCredentialBindings(deviceId: number): DeviceCredentialBinding[] {
  return db().prepare(`
    SELECT dcb.*, c.name AS credential_name, c.credential_type
    FROM device_credential_bindings dcb
    LEFT JOIN credentials c ON c.id = dcb.credential_id
    WHERE dcb.device_id = ?
    ORDER BY dcb.sort_order, dcb.id
  `).all(deviceId) as DeviceCredentialBinding[];
}

/** Protocolli credenziali con test_status='success' per tutti i device (batch, no N+1) */
export function getDeviceCredentialProtocolsSummary(): Map<number, string[]> {
  const rows = db().prepare(
    `SELECT device_id, protocol_type
     FROM device_credential_bindings
     WHERE test_status = 'success'
     GROUP BY device_id, protocol_type
     ORDER BY device_id`
  ).all() as Array<{ device_id: number; protocol_type: string }>;
  const map = new Map<number, string[]>();
  for (const r of rows) {
    const arr = map.get(r.device_id) || [];
    arr.push(r.protocol_type);
    map.set(r.device_id, arr);
  }
  return map;
}

export function addDeviceCredentialBinding(input: {
  device_id: number;
  credential_id?: number | null;
  protocol_type: string;
  port: number;
  sort_order?: number;
  inline_username?: string | null;
  inline_encrypted_password?: string | null;
  auto_detected?: boolean;
}): DeviceCredentialBinding {
  const d = db();
  const maxOrder = (d.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) as m FROM device_credential_bindings WHERE device_id = ?"
  ).get(input.device_id) as { m: number }).m;
  const sortOrder = input.sort_order ?? maxOrder + 1;

  const result = d.prepare(`
    INSERT INTO device_credential_bindings
      (device_id, credential_id, protocol_type, port, sort_order, inline_username, inline_encrypted_password, auto_detected)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.device_id,
    input.credential_id ?? null,
    input.protocol_type,
    input.port,
    sortOrder,
    input.inline_username ?? null,
    input.inline_encrypted_password ?? null,
    input.auto_detected ? 1 : 0
  );

  return d.prepare(`
    SELECT dcb.*, c.name AS credential_name, c.credential_type
    FROM device_credential_bindings dcb
    LEFT JOIN credentials c ON c.id = dcb.credential_id
    WHERE dcb.id = ?
  `).get(result.lastInsertRowid) as DeviceCredentialBinding;
}

export function updateDeviceCredentialBinding(bindingId: number, updates: {
  credential_id?: number | null;
  protocol_type?: string;
  port?: number;
  inline_username?: string | null;
  inline_encrypted_password?: string | null;
}): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (updates.credential_id !== undefined) { sets.push("credential_id = ?"); params.push(updates.credential_id); }
  if (updates.protocol_type !== undefined) { sets.push("protocol_type = ?"); params.push(updates.protocol_type); }
  if (updates.port !== undefined) { sets.push("port = ?"); params.push(updates.port); }
  if (updates.inline_username !== undefined) { sets.push("inline_username = ?"); params.push(updates.inline_username); }
  if (updates.inline_encrypted_password !== undefined) { sets.push("inline_encrypted_password = ?"); params.push(updates.inline_encrypted_password); }
  if (sets.length === 0) return;
  if (updates.credential_id != null) {
    sets.push("inline_username = NULL", "inline_encrypted_password = NULL");
  } else if (updates.inline_username !== undefined || updates.inline_encrypted_password !== undefined) {
    sets.push("credential_id = NULL");
  }
  params.push(bindingId);
  db().prepare(`UPDATE device_credential_bindings SET ${sets.join(", ")} WHERE id = ?`).run(...params);
}

export function deleteDeviceCredentialBinding(bindingId: number): void {
  db().prepare("DELETE FROM device_credential_bindings WHERE id = ?").run(bindingId);
}

export function reorderDeviceCredentialBindings(deviceId: number, orderedIds: number[]): void {
  const d = db();
  const stmt = d.prepare("UPDATE device_credential_bindings SET sort_order = ? WHERE id = ? AND device_id = ?");
  d.transaction(() => {
    for (let i = 0; i < orderedIds.length; i++) {
      stmt.run(i, orderedIds[i], deviceId);
    }
  })();
}

export function updateBindingTestStatus(bindingId: number, status: "success" | "failed", message: string): void {
  db().prepare(`
    UPDATE device_credential_bindings SET test_status = ?, test_message = ?, tested_at = datetime('now') WHERE id = ?
  `).run(status, message, bindingId);
}

export function findExistingBinding(deviceId: number, credentialId: number, protocolType: string, port: number): DeviceCredentialBinding | null {
  return db().prepare(`
    SELECT dcb.*, c.name AS credential_name, c.credential_type
    FROM device_credential_bindings dcb
    LEFT JOIN credentials c ON c.id = dcb.credential_id
    WHERE dcb.device_id = ? AND dcb.credential_id = ? AND dcb.protocol_type = ? AND dcb.port = ?
  `).get(deviceId, credentialId, protocolType, port) as DeviceCredentialBinding | null;
}

export function getPrimaryBindingForProtocol(deviceId: number, protocolType: string): DeviceCredentialBinding | null {
  return db().prepare(`
    SELECT dcb.*, c.name AS credential_name, c.credential_type
    FROM device_credential_bindings dcb
    LEFT JOIN credentials c ON c.id = dcb.credential_id
    WHERE dcb.device_id = ? AND dcb.protocol_type = ? AND dcb.test_status = 'success'
    ORDER BY dcb.sort_order LIMIT 1
  `).get(deviceId, protocolType) as DeviceCredentialBinding | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHEDULED JOBS
// ═══════════════════════════════════════════════════════════════════════════

export function getScheduledJobs(): ScheduledJob[] {
  // v0.2.648 audit perf MC2: prep cached.
  return prep("SELECT * FROM scheduled_jobs ORDER BY id").all() as ScheduledJob[];
}

/**
 * v0.2.642 audit perf MC3: fetch mirato per cron tick (`runJob`). Prima ogni
 * tick faceva `getScheduledJobs()` (full table scan + .find() lato JS); su 10
 * tenant × 8 job × 1 tick/min = 80 query/min inutili. Ora una sola SELECT con WHERE id.
 * v0.2.648 audit perf MC2: prep cached (lo stesso statement riusato ogni tick).
 */
export function getScheduledJobById(id: number): ScheduledJob | undefined {
  return prep("SELECT * FROM scheduled_jobs WHERE id = ?").get(id) as ScheduledJob | undefined;
}

export function getEnabledJobs(): ScheduledJob[] {
  return prep("SELECT * FROM scheduled_jobs WHERE enabled = 1").all() as ScheduledJob[];
}

export function createScheduledJob(input: ScheduledJobInput): ScheduledJob {
  const stmt = db().prepare(
    `INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, config, next_run)
     VALUES (?, ?, ?, ?, datetime('now', '+' || ? || ' minutes'))`
  );
  const result = stmt.run(
    input.network_id || null,
    input.job_type,
    input.interval_minutes,
    JSON.stringify(input.config || {}),
    input.interval_minutes
  );
  return db().prepare("SELECT * FROM scheduled_jobs WHERE id = ?").get(result.lastInsertRowid) as ScheduledJob;
}

export function updateJobLastRun(id: number): void {
  const job = db().prepare("SELECT interval_minutes FROM scheduled_jobs WHERE id = ?").get(id) as { interval_minutes: number } | undefined;
  if (!job) return;
  db().prepare(
    `UPDATE scheduled_jobs SET last_run = datetime('now'), next_run = datetime('now', '+' || ? || ' minutes'), updated_at = datetime('now') WHERE id = ?`
  ).run(job.interval_minutes, id);
}

export function toggleJob(id: number, enabled: boolean): void {
  db().prepare("UPDATE scheduled_jobs SET enabled = ?, updated_at = datetime('now') WHERE id = ?").run(enabled ? 1 : 0, id);
}

export function updateScheduledJobInterval(id: number, intervalMinutes: number): void {
  db().prepare(
    `UPDATE scheduled_jobs SET interval_minutes = ?, next_run = datetime('now', '+' || ? || ' minutes'), updated_at = datetime('now') WHERE id = ?`
  ).run(intervalMinutes, intervalMinutes, id);
}

/**
 * Un job nato dal seme dei job di serie (`opzioni/job-di-serie.ts`): acceso, con il primo giro fra `offsetMinuti`
 * (spalmato come known_host_check, così le reti non partono tutte insieme).
 */
export function insertSeededJob(jobType: ScheduledJob["job_type"], networkId: number | null, intervalMinutes: number, offsetMinuti: number): number {
  const res = db()
    .prepare(
      `INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled, config, next_run)
       VALUES (?, ?, ?, 1, '{}', datetime('now', '+' || ? || ' minutes'))`,
    )
    .run(networkId, jobType, intervalMinutes, offsetMinuti);
  return Number(res.lastInsertRowid);
}

/**
 * Accende o spegne lo Scanner-Edge del cliente (pagina Opzioni). Riaccendere azzera gli errori, come la PATCH della sua
 * scheda: altrimenti resterebbe «spento da solo». false = nessuno scanner configurato.
 */
export function setVulnScannerEnabled(on: boolean): boolean {
  const r = db()
    .prepare(
      on
        ? `UPDATE vuln_scanners SET enabled = 1, consecutive_errors = 0, last_error = NULL, auto_disabled_at = NULL, updated_at = datetime('now')
            WHERE id = (SELECT id FROM vuln_scanners ORDER BY id LIMIT 1)`
        : `UPDATE vuln_scanners SET enabled = 0, updated_at = datetime('now') WHERE id = (SELECT id FROM vuln_scanners ORDER BY id LIMIT 1)`,
    )
    .run();
  return r.changes > 0;
}

/** Lo Scanner-Edge del cliente in breve, o null se non c'è. */
export function getVulnScannerStato(): { enabled: boolean; autoDisabledAt: string | null; lastSyncAt: string | null; lastError: string | null } | null {
  const r = db()
    .prepare("SELECT enabled, auto_disabled_at, last_sync_at, last_error FROM vuln_scanners ORDER BY id LIMIT 1")
    .get() as { enabled: number; auto_disabled_at: string | null; last_sync_at: string | null; last_error: string | null } | undefined;
  if (!r) return null;
  return { enabled: r.enabled === 1, autoDisabledAt: r.auto_disabled_at, lastSyncAt: r.last_sync_at, lastError: r.last_error };
}

/** Le reti del cliente, solo id, nome e CIDR: senza le statistiche di `getNetworks`. */
export function listNetworksLite(): Array<{ id: number; name: string; cidr: string }> {
  return db().prepare("SELECT id, name, cidr FROM networks ORDER BY id").all() as Array<{ id: number; name: string; cidr: string }>;
}

/** Toglie il job e, nella stessa transazione, gli esiti per apparato (`job_apparati_esiti` non ha FK: la v11 ricostruisce la tabella). */
export function deleteScheduledJob(id: number): boolean {
  const d = db();
  return d.transaction(() => {
    d.prepare("DELETE FROM job_apparati_esiti WHERE job_id = ?").run(id);
    return d.prepare("DELETE FROM scheduled_jobs WHERE id = ?").run(id).changes > 0;
  })();
}

// ─────────────────────────────────────────────────────────────────────────
// Default provisioning (post-incident 2026-05-25 cliente A)
//
// `known_host_check` è il default safe: pinga SOLO host già registrati,
// scope deterministico, costo CPU proporzionale a |host noti|, non a |IP nel subnet|.
// `fast_scan`/`ping_sweep` schedulati sono distruttivi su subnet larghi e
// devono essere on-demand dalla UI.
// ─────────────────────────────────────────────────────────────────────────

/** Interval (min) sicuro per N host. Modello sequenziale 3 s/host × safety 2. Floor 15, cap 1440. */
export function computeMinIntervalMinutes(hostCount: number): number {
  if (hostCount <= 0) return 15;
  const minIntervalMin = Math.ceil((hostCount * 3 * 2) / 60);
  return Math.max(15, Math.min(minIntervalMin, 1440));
}

/** Offset (min) per spalmare N next_run su 60 min. Min 1 per evitare burst al boot. */
export function staggerOffsetMinutes(idx: number, total: number): number {
  if (total <= 1) return 1;
  return Math.max(1, idx * Math.floor(60 / total));
}

/**
 * Seed `known_host_check` per `networkId` se assente. Idempotente.
 * Interval calcolato sui known host correnti; next_run spalmato via stagger.
 */
export function seedDefaultJobsForNetwork(
  networkId: number,
  staggerIdx = 0,
  staggerTotal = 1,
): { created: boolean; jobId: number | null } {
  const existing = db()
    .prepare(
      "SELECT id FROM scheduled_jobs WHERE network_id = ? AND job_type = 'known_host_check' LIMIT 1",
    )
    .get(networkId) as { id: number } | undefined;
  if (existing) return { created: false, jobId: existing.id };

  const { n: hostCount } = db()
    .prepare("SELECT COUNT(*) AS n FROM hosts WHERE network_id = ? AND known_host = 1")
    .get(networkId) as { n: number };
  const interval = computeMinIntervalMinutes(hostCount);
  const offset = staggerOffsetMinutes(staggerIdx, staggerTotal);

  const res = db()
    .prepare(
      `INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled, next_run)
       VALUES (?, 'known_host_check', ?, 1, datetime('now', '+' || ? || ' minutes'))`,
    )
    .run(networkId, interval, offset);
  return { created: true, jobId: Number(res.lastInsertRowid) };
}

/** CIDR → numero IP (tolleranza /0../32). */
export function cidrIpCount(cidr: string): number {
  const m = /\/(\d+)$/.exec(cidr);
  if (!m) return 0;
  const bits = Number(m[1]);
  if (!Number.isFinite(bits) || bits < 0 || bits > 32) return 0;
  return 2 ** (32 - bits);
}

/**
 * Boot migration tenant-scope. Esegue:
 *  1. Disabilita fast_scan/ping_sweep enabled con interval < 720 min su network ≥ /22
 *     (= scan distruttivo schedulato "ragionevolmente" frequente su subnet grande).
 *  2. Seed known_host_check sui network privi (spalmati su 60 min).
 *
 * Idempotente: rilancio non duplica. Ritorna conteggi per logging.
 */
export function applyTenantSchedulerDefaults(): { jobsDisabled: number; jobsSeeded: number } {
  const out = { jobsDisabled: 0, jobsSeeded: 0 };

  // (1) Disabilita fast_scan/ping_sweep rischiosi
  const candidates = db()
    .prepare(
      `SELECT sj.id, sj.job_type, sj.interval_minutes, n.cidr
       FROM scheduled_jobs sj
       JOIN networks n ON n.id = sj.network_id
       WHERE sj.enabled = 1
         AND sj.job_type IN ('fast_scan', 'ping_sweep')
         AND sj.interval_minutes < 720`,
    )
    .all() as Array<{ id: number; job_type: string; interval_minutes: number; cidr: string }>;
  for (const row of candidates) {
    if (cidrIpCount(row.cidr) >= 1024) {
      db().prepare(
        "UPDATE scheduled_jobs SET enabled = 0, updated_at = datetime('now') WHERE id = ?",
      ).run(row.id);
      console.warn(
        `[scheduler-defaults] disabled ${row.job_type} #${row.id} su ${row.cidr} ` +
          `(interval ${row.interval_minutes} min) — usa known_host_check + discovery on-demand`,
      );
      out.jobsDisabled++;
    }
  }

  // (2) Seed known_host_check
  const missing = db()
    .prepare(
      `SELECT n.id FROM networks n
       WHERE NOT EXISTS (
         SELECT 1 FROM scheduled_jobs sj
         WHERE sj.network_id = n.id AND sj.job_type = 'known_host_check'
       )
       ORDER BY n.id`,
    )
    .all() as Array<{ id: number }>;
  missing.forEach((row, idx) => {
    const { created } = seedDefaultJobsForNetwork(row.id, idx, missing.length);
    if (created) out.jobsSeeded++;
  });

  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// STATUS HISTORY
// ═══════════════════════════════════════════════════════════════════════════

export function addStatusHistory(hostId: number, status: "online" | "offline", responseTimeMs?: number | null): void {
  // v0.2.648 audit perf MC2: prep cached.
  prep("INSERT INTO status_history (host_id, status, response_time_ms) VALUES (?, ?, ?)")
    .run(hostId, status, responseTimeMs ?? null);
}

/**
 * v0.2.645 audit perf DB8: helper combinato per known-host-check.
 * Prima il loop faceva 3 fsync separati per host (addStatusHistory +
 * updateHost + UPDATE last_response_time_ms). Su 360 host = 1080 fsync per
 * ciclo (~15-20s solo I/O). Ora 1 transazione → ~7s.
 *
 * Combina: INSERT status_history + UPDATE hosts.status + last_seen + last_response_time_ms.
 */
export function recordHostHeartbeat(
  hostId: number,
  status: "online" | "offline",
  responseTimeMs: number | null,
): void {
  const d = db();
  const tx = d.transaction(() => {
    d.prepare(
      "INSERT INTO status_history (host_id, status, response_time_ms) VALUES (?, ?, ?)"
    ).run(hostId, status, responseTimeMs);
    // status + last_seen (solo online) + last_response_time_ms in un solo UPDATE
    if (status === "online") {
      d.prepare(
        "UPDATE hosts SET status = ?, last_seen = datetime('now'), last_response_time_ms = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(status, responseTimeMs, hostId);
    } else {
      d.prepare(
        "UPDATE hosts SET status = ?, last_response_time_ms = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(status, responseTimeMs, hostId);
    }
  });
  tx();
}

/**
 * Stato host nel tempo, bucket dinamico in base al periodo richiesto:
 * - ≤ 48h → bucket orari
 * - ≤ 14gg → bucket giornalieri
 * - > 14gg → bucket giornalieri (limite di leggibilità asse X)
 *
 * Ogni host conta col suo ultimo stato noto, valido 24 h (status-over-time.ts).
 * "unknown" = `total_hosts_corrente - online - offline` clampato a ≥0: host mai
 * controllati o con l'ultimo controllo più vecchio di 24 h. È un'approssimazione
 * (il totale storico cambia nel tempo).
 *
 * `health_pct` = online / (online + offline) × 100, arrotondato; null quando
 * nessuno stato è noto. Serie vuota se nella finestra non c'è nessun controllo.
 */
export function getStatusOverTime(
  hours: number = 24
): StatusPoint[] {
  // Ultimo stato noto di ogni host portato avanti per 24 h (status-over-time.ts):
  // prima un host contava solo nell'ora in cui era stato controllato, e con il
  // controllo ogni 3 ore il grafico andava su e giù (cliente A, ottobre 2026).
  const STALE_HOURS = 24;
  if (!Number.isFinite(hours)) hours = 24;
  hours = Math.min(Math.max(Math.round(hours), 1), 720);
  const nowMs = Date.now();
  const startMs = statusWindowStartMs(hours, nowMs);
  const toSql = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);
  const bucketFmt = hours <= 48 ? "%Y-%m-%dT%H:00:00" : "%Y-%m-%dT00:00:00";
  // Gli host assenti (offline, non visti da oltre 7 giorni) restano fuori dal grafico,
  // come dalla salute in alto (Riccardo, 20/10).
  const totalRow = db().prepare(`SELECT COUNT(*) as c FROM hosts WHERE NOT ${condizioneAssente()}`).get() as { c: number };
  const fuori = `host_id NOT IN (SELECT id FROM hosts WHERE ${condizioneAssente()})`;
  // Per ogni host: l'ultimo controllo di ciascun periodo della finestra, più
  // l'ultimo prima della finestra (entro STALE_HOURS) come stato di partenza.
  const observations = db().prepare(`
    WITH dentro AS (
      SELECT host_id, status, checked_at,
        ROW_NUMBER() OVER (PARTITION BY strftime(?, checked_at), host_id ORDER BY checked_at DESC, id DESC) AS rn
      FROM status_history
      WHERE checked_at >= ? AND ${fuori}
    ),
    prima AS (
      SELECT host_id, status, checked_at,
        ROW_NUMBER() OVER (PARTITION BY host_id ORDER BY checked_at DESC, id DESC) AS rn
      FROM status_history
      WHERE checked_at >= ? AND checked_at < ? AND ${fuori}
    )
    SELECT host_id, status, checked_at FROM dentro WHERE rn = 1
    UNION ALL
    SELECT host_id, status, checked_at FROM prima WHERE rn = 1
  `).all(
    bucketFmt,
    toSql(startMs),
    toSql(startMs - STALE_HOURS * 3_600_000),
    toSql(startMs),
  ) as StatusObservation[];
  return buildStatusSeries({ hours, nowMs, totalHosts: totalRow.c, observations, staleAfterHours: STALE_HOURS });
}

/**
 * Recenti transizioni di stato dei known-hosts (host registrati / con MAC noto).
 * Una "transizione" è una riga di `status_history` il cui status differisce
 * dalla riga precedente per lo stesso host.
 * Ritorna gli ultimi `limit` cambi entro le ultime `hoursWindow` ore.
 *
 * Per ogni cambio: { host_id, ip, hostname, from_status, to_status, changed_at }.
 */
export function getRecentStatusChanges(
  limit: number = 10,
  hoursWindow: number = 24
): { host_id: number; ip: string; hostname: string | null; from_status: string | null; to_status: string; changed_at: string }[] {
  // CTE: per ogni riga di status_history, recupera il PREV status dello stesso host
  // (window LAG). Filtra dove status != prev_status → vere transizioni.
  return db().prepare(`
    WITH ordered AS (
      SELECT
        sh.host_id, sh.status, sh.checked_at,
        LAG(sh.status) OVER (PARTITION BY sh.host_id ORDER BY sh.checked_at) AS prev_status
      FROM status_history sh
      WHERE sh.checked_at >= datetime('now', '-' || ? || ' hours')
    )
    SELECT
      o.host_id,
      h.ip,
      COALESCE(h.custom_name, h.hostname) AS hostname,
      o.prev_status AS from_status,
      o.status AS to_status,
      o.checked_at AS changed_at
    FROM ordered o
    JOIN hosts h ON h.id = o.host_id
    WHERE o.prev_status IS NOT NULL AND o.prev_status != o.status
    ORDER BY o.checked_at DESC
    LIMIT ?
  `).all(hoursWindow, limit) as { host_id: number; ip: string; hostname: string | null; from_status: string | null; to_status: string; changed_at: string }[];
}

export function getStatusHistory(hostId: number, limit: number = 100): StatusHistory[] {
  return db().prepare(
    "SELECT * FROM status_history WHERE host_id = ? ORDER BY checked_at DESC LIMIT ?"
  ).all(hostId, limit) as StatusHistory[];
}

export function getHostLatencyHistory(hostId: number, hours: number = 24): { time: string; response_time_ms: number | null; status: string }[] {
  return db().prepare(`
    SELECT strftime('%Y-%m-%dT%H:%M:00', checked_at) as time, response_time_ms, status
    FROM status_history
    WHERE host_id = ? AND checked_at >= datetime('now', '-' || ? || ' hours')
    ORDER BY checked_at ASC
  `).all(hostId, hours) as { time: string; response_time_ms: number | null; status: string }[];
}

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD / STATS
// ═══════════════════════════════════════════════════════════════════════════

export function getKnownHostStats(): { total: number; online: number; offline: number; avg_latency: number | null } {
  return db().prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) as online,
      SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END) as offline,
      AVG(last_response_time_ms) as avg_latency
    FROM hosts WHERE known_host = 1
  `).get() as { total: number; online: number; offline: number; avg_latency: number | null };
}

export function getOfflineKnownHosts(): { id: number; ip: string; hostname: string | null; custom_name: string | null; last_seen: string | null }[] {
  return db().prepare(`
    SELECT id, ip, hostname, custom_name, last_seen
    FROM hosts WHERE known_host = 1 AND status = 'offline'
    ORDER BY last_seen DESC LIMIT 20
  `).all() as { id: number; ip: string; hostname: string | null; custom_name: string | null; last_seen: string | null }[];
}

export function getDashboardStats(): {
  total_networks: number;
  total_hosts: number;
  online_hosts: number;
  offline_hosts: number;
  unknown_hosts: number;
} {
  const row = db().prepare(`
    SELECT
      (SELECT COUNT(*) FROM networks) as total_networks,
      (SELECT COUNT(*) FROM hosts) as total_hosts,
      (SELECT COUNT(*) FROM hosts WHERE status = 'online') as online_hosts,
      (SELECT COUNT(*) FROM hosts WHERE status = 'offline') as offline_hosts,
      (SELECT COUNT(*) FROM hosts WHERE status = 'unknown') as unknown_hosts
  `).get() as {
    total_networks: number;
    total_hosts: number;
    online_hosts: number;
    offline_hosts: number;
    unknown_hosts: number;
  };
  return row;
}

export function getRecentActivity(limit: number = 10): ScanHistory[] {
  return db().prepare(
    "SELECT * FROM scan_history ORDER BY timestamp DESC LIMIT ?"
  ).all(limit) as ScanHistory[];
}

export function globalSearch(query: string, limit: number = 20): {
  hosts: Host[];
  networks: Network[];
} {
  const like = `%${query}%`;
  const hosts = db().prepare(`
    SELECT * FROM hosts
    WHERE ip LIKE ? OR mac LIKE ? OR hostname LIKE ? OR custom_name LIKE ?
      OR dns_forward LIKE ? OR dns_reverse LIKE ? OR notes LIKE ? OR vendor LIKE ?
    LIMIT ?
  `).all(like, like, like, like, like, like, like, like, limit) as Host[];
  hosts.sort((a, b) => ipToNum(a.ip) - ipToNum(b.ip));

  const networks = db().prepare(`
    SELECT * FROM networks
    WHERE cidr LIKE ? OR name LIKE ? OR description LIKE ? OR location LIKE ?
    ORDER BY name ASC
    LIMIT ?
  `).all(like, like, like, like, limit) as Network[];

  return { hosts, networks };
}

export function getOnlineCountsOverTime(
  hours: number = 24
): { time: string; online: number; offline: number }[] {
  return db().prepare(`
    SELECT
      strftime('%Y-%m-%dT%H:00:00', checked_at) as time,
      SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) as online,
      SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END) as offline
    FROM status_history
    WHERE checked_at >= datetime('now', '-' || ? || ' hours')
    GROUP BY strftime('%Y-%m-%dT%H:00:00', checked_at)
    ORDER BY time ASC
  `).all(hours) as { time: string; online: number; offline: number }[];
}

// ═══════════════════════════════════════════════════════════════════════════
// INVENTORY ASSETS
// ═══════════════════════════════════════════════════════════════════════════

const INVENTORY_COLUMNS = [
  "asset_id", "asset_tag", "serial_number", "network_device_id", "host_id", "hostname", "nome_prodotto",
  "categoria", "marca", "modello", "part_number", "sede", "reparto", "utente_assegnatario_id", "asset_assignee_id", "location_id", "posizione_fisica",
  "data_assegnazione", "data_acquisto", "data_installazione", "data_dismissione", "stato", "fine_garanzia",
  "fine_supporto", "vita_utile_prevista", "sistema_operativo", "versione_os", "cpu", "ram_gb", "storage_gb",
  "storage_tipo", "mac_address", "ip_address", "vlan", "firmware_version", "prezzo_acquisto", "fornitore",
  "numero_ordine", "numero_fattura", "valore_attuale", "metodo_ammortamento", "centro_di_costo",
  "crittografia_disco", "antivirus", "gestito_da_mdr", "classificazione_dati", "in_scope_gdpr", "categoria_nis2", "business_owner_id", "technical_owner_id", "criticita_nis2", "dati_trattati", "supporto_rimovibile", "data_review_nis2", "auto_sync_discovery", "last_sync_at", "last_sync_source", "backup_configurato", "backup_ultimo_test", "patching_automatico", "mfa_admin", "log_centralizzati", "hardening_baseline", "dr_plan_documentato", "incident_response_documentata", "in_scope_nis2",
  "ultimo_audit", "contratto_supporto", "tipo_garanzia", "contatto_supporto", "ultimo_intervento",
  "prossima_manutenzione", "note_tecniche", "technical_data",
];

export function getInventoryAssetById(id: number): import("@/types").InventoryAsset | undefined {
  return db().prepare("SELECT * FROM inventory_assets WHERE id = ?").get(id) as import("@/types").InventoryAsset | undefined;
}

export function getInventoryAssetByNetworkDevice(deviceId: number): import("@/types").InventoryAsset | undefined {
  return db().prepare("SELECT * FROM inventory_assets WHERE network_device_id = ?").get(deviceId) as import("@/types").InventoryAsset | undefined;
}

export function getDeviceIdsWithInventoryAsset(): Set<number> {
  const rows = db().prepare("SELECT network_device_id FROM inventory_assets WHERE network_device_id IS NOT NULL").all() as { network_device_id: number }[];
  return new Set(rows.map((r) => r.network_device_id));
}

function mapClassificationToInventoryCategoria(classification: string | null, deviceType: string, vendor?: string | null): import("@/types").InventoryAssetCategoria | null {
  const cGrezzo = (classification ?? "").toLowerCase().trim();
  const c = cGrezzo ? canonicalizza(cGrezzo).classificazione : ""; // catalogo canonico (21/10)
  const dt = (deviceType ?? "").toLowerCase().trim();
  const v = (vendor ?? "").toLowerCase().trim();

  // 1) Classification (fonte primaria, esplicita dall'utente o dal classifier)
  if (c === "firewall") return "Firewall";
  if (c === "access_point") return "Access Point";
  if (["router", "load_balancer", "vpn_gateway"].includes(c)) return "Router";
  if (c === "switch") return "Switch";
  if (["server", "linux_server", "windows_server"].includes(c)) return "Server";
  if (c === "hypervisor") return "Server";
  if (["workstation", "desktop", "pc"].includes(c)) return "Desktop";
  if (["notebook", "laptop"].includes(c)) return "Laptop";
  if (c === "vm") return "VM";
  if (["nas"].includes(c)) return "NAS";
  if (["stampante", "scanner", "multifunzione"].includes(c)) return "Stampante";
  if (["telecamera", "voip", "iot"].includes(c)) return "Other";

  // 2) device_type fallback — ma attenzione: device_type='switch' è un WORKAROUND
  //    di schema per host non-router (firewall, server Linux, ecc.). Usarlo da
  //    solo per assegnare "Switch" produce errori (vedi Linux server).
  if (dt === "router") return "Router";
  if (dt === "firewall") return "Firewall";
  if (dt === "hypervisor") return "Server";
  if (dt === "switch") {
    // device_type=switch può nascondere un server/NAS: usa vendor come hint
    if (["linux", "windows"].includes(v)) return "Server";
    if (["proxmox", "vmware"].includes(v)) return "Server";
    if (["synology", "qnap"].includes(v)) return "NAS";
    if (v === "stormshield") return "Firewall";
    // Solo qui è un vero switch (vendor di rete: cisco, hp, ubiquiti, ecc.)
    return "Switch";
  }

  // 3) vendor come ultimo indizio se manca tutto il resto
  if (["linux", "windows"].includes(v)) return "Server";
  if (["proxmox", "vmware"].includes(v)) return "Server";
  if (["synology", "qnap"].includes(v)) return "NAS";

  // 4) Fallback safe: NON inventare "Switch". Lascia che l'utente classifichi.
  return "Other";
}

function mapVendorToMarca(vendor: string): string | null {
  const v = vendor?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    mikrotik: "MikroTik", ubiquiti: "Ubiquiti", hp: "HP", cisco: "Cisco",
    omada: "TP-Link", stormshield: "Stormshield", proxmox: "Proxmox",
    vmware: "VMware", linux: "Linux", windows: "Windows",
  };
  return map[v] ?? null;
}

export function mapHostClassificationToInventoryCategoria(classification: string | null): import("@/types").InventoryAssetCategoria | null {
  const c = canonicalizza((classification ?? "").toLowerCase()).classificazione;
  if (["workstation", "desktop", "pc"].includes(c)) return "Desktop";
  if (["notebook", "laptop"].includes(c)) return "Laptop";
  if (["vm"].includes(c)) return "VM";
  if (["server", "hypervisor"].includes(c)) return "Server";
  if (["switch"].includes(c)) return "Switch";
  if (["router", "load_balancer", "vpn_gateway"].includes(c)) return "Router";
  if (["firewall"].includes(c)) return "Firewall";
  if (["access_point"].includes(c)) return "Access Point";
  if (["nas"].includes(c)) return "NAS";
  if (["stampante", "scanner", "multifunzione"].includes(c)) return "Stampante";
  if (["iot", "smart_tv", "telecamera", "voip", "phone"].includes(c)) return "Other";
  return null;
}

function extractProxmoxTechData(
  lastResult: string | null
): Partial<import("@/types").InventoryAssetInput> & { technical_data?: string } {
  const out: Partial<import("@/types").InventoryAssetInput> & { technical_data?: string } = {};
  if (!lastResult?.trim()) return out;
  try {
    const parsed = JSON.parse(lastResult) as {
      hosts?: Array<{
        hostname?: string; cpu_model?: string; cpu_mhz?: number; cpu_sockets?: number; cpu_cores?: number;
        memory_total_gb?: number; proxmox_version?: string; kernel_version?: string; rootfs_total_gb?: number;
        hardware_serial?: string; hardware_model?: string; hardware_manufacturer?: string;
        storage?: Array<{ total_gb?: number; used_gb?: number; type?: string }>;
      }>;
    };
    out.technical_data = lastResult;
    const host = parsed?.hosts?.[0];
    if (!host) return out;
    if (host.cpu_model) {
      const parts = [host.cpu_model];
      if (host.cpu_mhz) parts.push(`${host.cpu_mhz} MHz`);
      if (host.cpu_sockets != null) parts.push(`${host.cpu_sockets} socket`);
      if (host.cpu_cores != null) parts.push(`${host.cpu_cores} core`);
      out.cpu = parts.join(", ");
    }
    if (host.memory_total_gb != null) out.ram_gb = Math.round(host.memory_total_gb);
    if (host.proxmox_version) out.firmware_version = host.proxmox_version;
    if (host.kernel_version) out.versione_os = host.kernel_version;
    if (host.hardware_serial) out.serial_number = host.hardware_serial;
    if (host.hardware_model) out.modello = host.hardware_model;
    if (host.hardware_manufacturer) out.marca = host.hardware_manufacturer;
    if (host.rootfs_total_gb != null) {
      const storageTotal = host.storage?.reduce((s, st) => s + (st.total_gb ?? 0), 0) ?? 0;
      out.storage_gb = Math.round(Math.max(host.rootfs_total_gb, storageTotal));
    }
    out.sistema_operativo = "Proxmox VE";
  } catch { /* ignore */ }
  return out;
}

export function ensureInventoryAssetForNetworkDevice(device: NetworkDevice): import("@/types").InventoryAsset {
  const existing = getInventoryAssetByNetworkDevice(device.id);
  if (existing) return existing;
  const categoria = mapClassificationToInventoryCategoria(device.classification, device.device_type, device.vendor);
  const marca = mapVendorToMarca(device.vendor);
  return createInventoryAsset({
    network_device_id: device.id, hostname: device.name, nome_prodotto: device.name,
    categoria, marca, modello: device.model ?? null, serial_number: device.serial_number ?? null,
    ip_address: device.host, firmware_version: device.firmware ?? null, stato: "Attivo",
  });
}

export function syncInventoryFromDevice(device: NetworkDevice): import("@/types").InventoryAsset | null {
  const asset = getInventoryAssetByNetworkDevice(device.id);
  if (!asset) return null;
  const marca = mapVendorToMarca(device.vendor);
  const categoria = mapClassificationToInventoryCategoria(device.classification, device.device_type, device.vendor);
  const base: Partial<import("@/types").InventoryAssetInput> = {
    hostname: device.name, nome_prodotto: device.name,
    categoria: categoria ?? asset.categoria, marca: marca ?? asset.marca,
    modello: device.model ?? asset.modello, serial_number: device.serial_number ?? asset.serial_number,
    part_number: device.part_number ?? asset.part_number, ip_address: device.host,
    firmware_version: device.firmware ?? asset.firmware_version,
  };
  const dev = device as { last_proxmox_scan_result?: string | null };
  const proxmox = extractProxmoxTechData(dev.last_proxmox_scan_result ?? null);
  let technicalData = proxmox.technical_data;
  if (!technicalData && (device.sysname || device.sysdescr || device.model || device.firmware)) {
    technicalData = JSON.stringify({
      source: "device", sysname: device.sysname, sysdescr: device.sysdescr,
      model: device.model, firmware: device.firmware, serial_number: device.serial_number,
      part_number: device.part_number, last_info_update: (device as { last_info_update?: string | null }).last_info_update,
    });
  }
  const merged: import("@/types").InventoryAssetInput = { ...base, ...proxmox, technical_data: technicalData ?? undefined };
  return updateInventoryAsset(asset.id, merged) ?? null;
}

export function getInventoryAssetByHost(hostId: number): import("@/types").InventoryAsset | undefined {
  return db().prepare("SELECT * FROM inventory_assets WHERE host_id = ?").get(hostId) as import("@/types").InventoryAsset | undefined;
}

export function getHostIdsWithInventoryAsset(): Set<number> {
  const rows = db().prepare("SELECT host_id FROM inventory_assets WHERE host_id IS NOT NULL").all() as { host_id: number }[];
  return new Set(rows.map((r) => r.host_id));
}

export function ensureInventoryAssetForHost(host: Host): import("@/types").InventoryAsset {
  const existing = getInventoryAssetByHost(host.id);
  if (existing) return existing;
  const categoria = mapHostClassificationToInventoryCategoria(host.classification ?? null);
  return createInventoryAsset({
    host_id: host.id, hostname: host.custom_name ?? host.hostname ?? host.ip,
    nome_prodotto: host.model ?? host.hostname ?? host.ip, categoria: categoria ?? "Other",
    marca: host.vendor ?? null, modello: host.model ?? null, serial_number: host.serial_number ?? null,
    ip_address: host.ip, mac_address: host.mac ?? null, sistema_operativo: host.os_info ?? null, stato: "Attivo",
  });
}

export function syncInventoryFromHost(host: Host): import("@/types").InventoryAsset | null {
  const asset = getInventoryAssetByHost(host.id);
  if (!asset) return null;
  const categoria = mapHostClassificationToInventoryCategoria(host.classification ?? null) ?? asset.categoria;
  const merged: import("@/types").InventoryAssetInput = {
    hostname: host.custom_name ?? host.hostname ?? host.ip,
    nome_prodotto: host.model ?? host.hostname ?? asset.nome_prodotto,
    categoria, marca: host.vendor ?? asset.marca, modello: host.model ?? asset.modello,
    serial_number: host.serial_number ?? asset.serial_number, ip_address: host.ip,
    mac_address: host.mac ?? asset.mac_address, sistema_operativo: host.os_info ?? asset.sistema_operativo,
  };
  return updateInventoryAsset(asset.id, merged) ?? null;
}

/**
 * NIS2 Fase 3 — Sync inventory da discovery (host + network_device collegati).
 *
 * Aggiorna i campi tecnici dell'asset a partire dai dati raccolti dagli scanner.
 * Per default sovrascrive SOLO i campi vuoti nell'asset (`force=false`).
 * Se `auto_sync_discovery=0` l'asset viene saltato (valori curati manualmente).
 *
 * Aggiorna `last_sync_at` e `last_sync_source` per audit.
 */
export function syncInventoryAssetFromDiscovery(
  assetId: number,
  opts?: { force?: boolean },
): import("./inventory/discovery-sync").SyncResult {
  const asset = getInventoryAssetById(assetId);
  if (!asset) {
    return { asset_id: assetId, updated: false, fields_updated: [], skipped_reason: "no_source", source: null };
  }
  const force = opts?.force === true;
  // auto_sync_discovery=0 → asset bloccato (a meno di force)
  if (!force && asset.auto_sync_discovery === 0) {
    return { asset_id: assetId, updated: false, fields_updated: [], skipped_reason: "auto_sync_disabled", source: null };
  }
  // Carica le sorgenti
  // helpers importati staticamente in cima al modulo
  const patches: Array<Partial<import("@/types").InventoryAssetInput>> = [];
  let hostId: number | null = null;
  let deviceId: number | null = null;
  if (asset.network_device_id != null) {
    const dev = getNetworkDeviceById(asset.network_device_id);
    if (dev) { patches.push(buildPatchFromDevice(dev)); deviceId = dev.id; }
  }
  if (asset.host_id != null) {
    const host = getHostById(asset.host_id);
    if (host) { patches.push(buildPatchFromHost(host)); hostId = host.id; }
  }
  if (patches.length === 0) {
    return { asset_id: assetId, updated: false, fields_updated: [], skipped_reason: "no_source", source: null };
  }
  const source = buildSourceLabel(hostId, deviceId);
  const { merge, updated } = buildSyncMerge(asset, patches, force);
  if (updated.length === 0) {
    // niente da aggiornare: aggiorno solo il timestamp di check
    updateInventoryAsset(assetId, { last_sync_at: new Date().toISOString(), last_sync_source: source });
    return { asset_id: assetId, updated: false, fields_updated: [], source };
  }
  updateInventoryAsset(assetId, { ...merge, last_sync_at: new Date().toISOString(), last_sync_source: source });
  return { asset_id: assetId, updated: true, fields_updated: updated, source };
}

/** Versione bulk: applica syncInventoryAssetFromDiscovery a una lista di asset_id. */
export function syncInventoryAssetsBulk(
  assetIds: number[],
  opts?: { force?: boolean },
): { results: import("./inventory/discovery-sync").SyncResult[]; total_updated: number } {
  const results = assetIds.map((id) => syncInventoryAssetFromDiscovery(id, opts));
  return { results, total_updated: results.filter((r) => r.updated).length };
}

// ═══════════════════════════════════════════════════════════════════════════
// NIS2 Fase 4 — SERVICES + DIPENDENZE
// ═══════════════════════════════════════════════════════════════════════════

const SERVICE_FIELDS = [
  "name", "description", "stato", "criticita_servizio", "in_scope_nis2",
  "rto_minutes", "rpo_minutes", "business_owner_id", "technical_owner_id",
  "sla_url", "note",
] as const;

export function getServices(opts?: { in_scope_nis2?: number; stato?: string; q?: string; limit?: number }): import("@/types").ServiceWithDeps[] {
  let sql = `
    SELECT s.*,
      bo.name AS business_owner_name,
      to_.name AS technical_owner_name,
      COUNT(d.id) AS n_assets,
      SUM(CASE WHEN d.dependency_type = 'primario' THEN 1 ELSE 0 END) AS n_assets_primario
    FROM services s
    LEFT JOIN asset_assignees bo ON bo.id = s.business_owner_id
    LEFT JOIN asset_assignees to_ ON to_.id = s.technical_owner_id
    LEFT JOIN service_asset_dependencies d ON d.service_id = s.id
    WHERE 1=1
  `;
  const params: unknown[] = [];
  if (opts?.in_scope_nis2 != null) { sql += " AND s.in_scope_nis2 = ?"; params.push(opts.in_scope_nis2); }
  if (opts?.stato) { sql += " AND s.stato = ?"; params.push(opts.stato); }
  if (opts?.q?.trim()) {
    sql += " AND (s.name LIKE ? OR s.description LIKE ?)";
    const q = `%${opts.q.trim()}%`;
    params.push(q, q);
  }
  sql += " GROUP BY s.id ORDER BY s.name";
  if (opts?.limit) { sql += " LIMIT ?"; params.push(opts.limit); }
  return db().prepare(sql).all(...params) as import("@/types").ServiceWithDeps[];
}

export function getServiceById(id: number): import("@/types").ServiceWithDeps | undefined {
  return db().prepare(`
    SELECT s.*,
      bo.name AS business_owner_name,
      to_.name AS technical_owner_name
    FROM services s
    LEFT JOIN asset_assignees bo ON bo.id = s.business_owner_id
    LEFT JOIN asset_assignees to_ ON to_.id = s.technical_owner_id
    WHERE s.id = ?
  `).get(id) as import("@/types").ServiceWithDeps | undefined;
}

export function createService(input: import("@/types").ServiceInput): import("@/types").Service {
  const cols = SERVICE_FIELDS.filter((k) => input[k as keyof import("@/types").ServiceInput] !== undefined);
  const sql = `INSERT INTO services (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
  const values = cols.map((k) => {
    const v = input[k as keyof import("@/types").ServiceInput];
    if (k === "in_scope_nis2") return v ? 1 : 0;
    return v ?? null;
  });
  const result = db().prepare(sql).run(...values);
  return db().prepare("SELECT * FROM services WHERE id = ?").get(result.lastInsertRowid as number) as import("@/types").Service;
}

export function updateService(id: number, input: Partial<import("@/types").ServiceInput>): import("@/types").Service | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const k of SERVICE_FIELDS) {
    const v = input[k as keyof import("@/types").ServiceInput];
    if (v !== undefined) {
      fields.push(`${k} = ?`);
      values.push(k === "in_scope_nis2" ? (v ? 1 : 0) : v);
    }
  }
  if (fields.length === 0) return db().prepare("SELECT * FROM services WHERE id = ?").get(id) as import("@/types").Service | undefined;
  fields.push("updated_at = datetime('now')");
  values.push(id);
  db().prepare(`UPDATE services SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return db().prepare("SELECT * FROM services WHERE id = ?").get(id) as import("@/types").Service | undefined;
}

export function deleteService(id: number): boolean {
  return db().prepare("DELETE FROM services WHERE id = ?").run(id).changes > 0;
}

export function getServiceAssetDependencies(serviceId: number): Array<import("@/types").ServiceAssetDependency & { asset_tag: string | null; hostname: string | null; nome_prodotto: string | null; criticita_nis2: string | null }> {
  return db().prepare(`
    SELECT d.*, a.asset_tag, a.hostname, a.nome_prodotto, a.criticita_nis2
    FROM service_asset_dependencies d
    JOIN inventory_assets a ON a.id = d.asset_id
    WHERE d.service_id = ?
    ORDER BY d.dependency_type, COALESCE(a.hostname, a.asset_tag, a.nome_prodotto)
  `).all(serviceId) as Array<import("@/types").ServiceAssetDependency & { asset_tag: string | null; hostname: string | null; nome_prodotto: string | null; criticita_nis2: string | null }>;
}

export function getServicesByAsset(assetId: number): Array<import("@/types").Service & { dependency_type: string }> {
  return db().prepare(`
    SELECT s.*, d.dependency_type
    FROM service_asset_dependencies d
    JOIN services s ON s.id = d.service_id
    WHERE d.asset_id = ?
    ORDER BY s.name
  `).all(assetId) as Array<import("@/types").Service & { dependency_type: string }>;
}

export function attachAssetToService(serviceId: number, input: { asset_id: number; dependency_type?: string; note?: string | null }): import("@/types").ServiceAssetDependency {
  db().prepare(`
    INSERT INTO service_asset_dependencies (service_id, asset_id, dependency_type, note)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(service_id, asset_id) DO UPDATE SET
      dependency_type = excluded.dependency_type,
      note = excluded.note
  `).run(serviceId, input.asset_id, input.dependency_type ?? "primario", input.note ?? null);
  return db().prepare("SELECT * FROM service_asset_dependencies WHERE service_id = ? AND asset_id = ?").get(serviceId, input.asset_id) as import("@/types").ServiceAssetDependency;
}

export function detachAssetFromService(serviceId: number, assetId: number): boolean {
  return db().prepare("DELETE FROM service_asset_dependencies WHERE service_id = ? AND asset_id = ?").run(serviceId, assetId).changes > 0;
}

export function getInventoryAssets(opts?: {
  network_device_id?: number; host_id?: number; stato?: string; categoria?: string;
  in_scope_nis2?: number; q?: string; limit?: number;
}): (import("@/types").InventoryAsset & { network_device_name?: string; host_ip?: string; assignee_name?: string })[] {
  let sql = `
    SELECT a.*, nd.name as network_device_name, h.ip as host_ip, aa.name as assignee_name
    FROM inventory_assets a
    LEFT JOIN network_devices nd ON nd.id = a.network_device_id
    LEFT JOIN hosts h ON h.id = a.host_id
    LEFT JOIN asset_assignees aa ON aa.id = a.asset_assignee_id
    WHERE 1=1
  `;
  const params: unknown[] = [];
  if (opts?.network_device_id) { sql += " AND a.network_device_id = ?"; params.push(opts.network_device_id); }
  if (opts?.host_id) { sql += " AND a.host_id = ?"; params.push(opts.host_id); }
  if (opts?.stato) { sql += " AND a.stato = ?"; params.push(opts.stato); }
  if (opts?.categoria) { sql += " AND a.categoria = ?"; params.push(opts.categoria); }
  if (opts?.in_scope_nis2 != null) { sql += " AND a.in_scope_nis2 = ?"; params.push(opts.in_scope_nis2); }
  if (opts?.q?.trim()) {
    const q = `%${opts.q.trim()}%`;
    sql += " AND (a.asset_tag LIKE ? OR a.serial_number LIKE ? OR a.hostname LIKE ? OR a.nome_prodotto LIKE ? OR a.marca LIKE ? OR a.modello LIKE ?)";
    params.push(q, q, q, q, q, q);
  }
  sql += " ORDER BY a.updated_at DESC";
  if (opts?.limit) { sql += " LIMIT ?"; params.push(opts.limit); }
  return db().prepare(sql).all(...params) as (import("@/types").InventoryAsset & { network_device_name?: string; host_ip?: string; assignee_name?: string })[];
}

export function createInventoryAsset(input: import("@/types").InventoryAssetInput): import("@/types").InventoryAsset {
  const assetId = randomUUID();
  const cols = ["asset_id", ...INVENTORY_COLUMNS.slice(1)];
  const placeholders = cols.map(() => "?").join(", ");
  const values = [
    assetId, input.asset_tag ?? null, input.serial_number ?? null,
    input.network_device_id ?? null, input.host_id ?? null, input.hostname ?? null,
    input.nome_prodotto ?? null, input.categoria ?? null, input.marca ?? null,
    input.modello ?? null, input.part_number ?? null, input.sede ?? null, input.reparto ?? null,
    input.utente_assegnatario_id ?? null, input.asset_assignee_id ?? null, input.location_id ?? null,
    input.posizione_fisica ?? null, input.data_assegnazione ?? null, input.data_acquisto ?? null,
    input.data_installazione ?? null, input.data_dismissione ?? null, input.stato ?? null,
    input.fine_garanzia ?? null, input.fine_supporto ?? null, input.vita_utile_prevista ?? null,
    input.sistema_operativo ?? null, input.versione_os ?? null, input.cpu ?? null, input.ram_gb ?? null,
    input.storage_gb ?? null, input.storage_tipo ?? null, input.mac_address ?? null, input.ip_address ?? null,
    input.vlan ?? null, input.firmware_version ?? null, input.prezzo_acquisto ?? null, input.fornitore ?? null,
    input.numero_ordine ?? null, input.numero_fattura ?? null, input.valore_attuale ?? null,
    input.metodo_ammortamento ?? null, input.centro_di_costo ?? null, input.crittografia_disco ?? 0,
    input.antivirus ?? null, input.gestito_da_mdr ?? 0, input.classificazione_dati ?? null,
    input.in_scope_gdpr ?? 0,
    input.categoria_nis2 ?? null, input.business_owner_id ?? null, input.technical_owner_id ?? null,
    input.criticita_nis2 ?? null, input.dati_trattati ?? null,
    input.supporto_rimovibile ? 1 : 0,
    input.data_review_nis2 ?? null,
    input.auto_sync_discovery !== undefined ? (input.auto_sync_discovery ? 1 : 0) : 1,
    input.last_sync_at ?? null, input.last_sync_source ?? null,
    input.backup_configurato ? 1 : 0, input.backup_ultimo_test ?? null,
    input.patching_automatico ? 1 : 0, input.mfa_admin ? 1 : 0,
    input.log_centralizzati ? 1 : 0, input.hardening_baseline ? 1 : 0,
    input.dr_plan_documentato ? 1 : 0, input.incident_response_documentata ? 1 : 0,
    input.in_scope_nis2 ?? 0, input.ultimo_audit ?? null,
    input.contratto_supporto ?? null, input.tipo_garanzia ?? null, input.contatto_supporto ?? null,
    input.ultimo_intervento ?? null, input.prossima_manutenzione ?? null, input.note_tecniche ?? null,
    input.technical_data ?? null,
  ];
  const result = db().prepare(`INSERT INTO inventory_assets (${cols.join(", ")}) VALUES (${placeholders})`).run(...values);
  return db().prepare("SELECT * FROM inventory_assets WHERE id = ?").get(result.lastInsertRowid as number) as import("@/types").InventoryAsset;
}

export function updateInventoryAsset(id: number, input: import("@/types").InventoryAssetInput, auditUserId?: number | null): import("@/types").InventoryAsset | undefined {
  const oldAsset = getInventoryAssetById(id);
  if (!oldAsset) return undefined;
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const col of INVENTORY_COLUMNS) {
    const key = col as keyof import("@/types").InventoryAssetInput;
    if (input[key] !== undefined) {
      fields.push(`${col} = ?`);
      values.push(key === "crittografia_disco" || key === "gestito_da_mdr" || key === "in_scope_gdpr" || key === "in_scope_nis2" || key === "supporto_rimovibile" || key === "backup_configurato" || key === "patching_automatico" || key === "mfa_admin" || key === "log_centralizzati" || key === "hardening_baseline" || key === "dr_plan_documentato" || key === "incident_response_documentata" || key === "auto_sync_discovery"
        ? (input[key] ? 1 : 0) : input[key]);
    }
  }
  if (fields.length === 0) return oldAsset;
  fields.push("updated_at = datetime('now')");
  values.push(id);
  db().prepare(`UPDATE inventory_assets SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  if (auditUserId != null) {
    for (const col of INVENTORY_COLUMNS) {
      const key = col as keyof import("@/types").InventoryAssetInput;
      if (input[key] !== undefined) {
        const oldVal = (oldAsset as unknown as Record<string, unknown>)[key];
        const newVal = input[key];
        const oldStr = oldVal != null ? String(oldVal) : null;
        const newStr = newVal != null ? String(newVal) : null;
        if (oldStr !== newStr) {
          db().prepare(
            "INSERT INTO inventory_audit_log (asset_id, user_id, action, field_name, old_value, new_value) VALUES (?, ?, 'update', ?, ?, ?)"
          ).run(id, auditUserId, col, oldStr, newStr);
        }
      }
    }
  }
  return getInventoryAssetById(id);
}

export function deleteInventoryAsset(id: number, auditUserId?: number | null): boolean {
  if (auditUserId != null) {
    db().prepare(
      "INSERT INTO inventory_audit_log (asset_id, user_id, action) VALUES (?, ?, 'delete')"
    ).run(id, auditUserId);
  }
  return db().prepare("DELETE FROM inventory_assets WHERE id = ?").run(id).changes > 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// ASSET ASSIGNEES
// ═══════════════════════════════════════════════════════════════════════════

export function getAssetAssignees(): import("@/types").AssetAssignee[] {
  return db().prepare("SELECT * FROM asset_assignees ORDER BY name").all() as import("@/types").AssetAssignee[];
}

export function getAssetAssigneeById(id: number): import("@/types").AssetAssignee | undefined {
  return db().prepare("SELECT * FROM asset_assignees WHERE id = ?").get(id) as import("@/types").AssetAssignee | undefined;
}

export function createAssetAssignee(input: { name: string; email?: string | null; phone?: string | null; note?: string | null }): import("@/types").AssetAssignee {
  const result = db().prepare(
    "INSERT INTO asset_assignees (name, email, phone, note) VALUES (?, ?, ?, ?)"
  ).run(input.name, input.email ?? null, input.phone ?? null, input.note ?? null);
  return db().prepare("SELECT * FROM asset_assignees WHERE id = ?").get(result.lastInsertRowid) as import("@/types").AssetAssignee;
}

export function updateAssetAssignee(id: number, input: { name?: string; email?: string | null; phone?: string | null; note?: string | null }): import("@/types").AssetAssignee | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (input.name !== undefined) { fields.push("name = ?"); values.push(input.name); }
  if (input.email !== undefined) { fields.push("email = ?"); values.push(input.email); }
  if (input.phone !== undefined) { fields.push("phone = ?"); values.push(input.phone); }
  if (input.note !== undefined) { fields.push("note = ?"); values.push(input.note); }
  if (fields.length === 0) return getAssetAssigneeById(id);
  fields.push("updated_at = datetime('now')");
  values.push(id);
  db().prepare(`UPDATE asset_assignees SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getAssetAssigneeById(id);
}

export function deleteAssetAssignee(id: number): boolean {
  return db().prepare("DELETE FROM asset_assignees WHERE id = ?").run(id).changes > 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// LOCATIONS
// ═══════════════════════════════════════════════════════════════════════════

export function getLocations(): import("@/types").Location[] {
  return db().prepare("SELECT * FROM locations ORDER BY name").all() as import("@/types").Location[];
}

export function getLocationById(id: number): import("@/types").Location | undefined {
  return db().prepare("SELECT * FROM locations WHERE id = ?").get(id) as import("@/types").Location | undefined;
}

export function createLocation(input: { name: string; parent_id?: number | null; address?: string | null }): import("@/types").Location {
  const result = db().prepare(
    "INSERT INTO locations (name, parent_id, address) VALUES (?, ?, ?)"
  ).run(input.name, input.parent_id ?? null, input.address ?? null);
  return db().prepare("SELECT * FROM locations WHERE id = ?").get(result.lastInsertRowid) as import("@/types").Location;
}

export function updateLocation(id: number, input: { name?: string; parent_id?: number | null; address?: string | null }): import("@/types").Location | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (input.name !== undefined) { fields.push("name = ?"); values.push(input.name); }
  if (input.parent_id !== undefined) { fields.push("parent_id = ?"); values.push(input.parent_id); }
  if (input.address !== undefined) { fields.push("address = ?"); values.push(input.address); }
  if (fields.length === 0) return getLocationById(id);
  fields.push("updated_at = datetime('now')");
  values.push(id);
  db().prepare(`UPDATE locations SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getLocationById(id);
}

export function deleteLocation(id: number): boolean {
  return db().prepare("DELETE FROM locations WHERE id = ?").run(id).changes > 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// LICENSES
// ═══════════════════════════════════════════════════════════════════════════

export function getLicenses(): (import("@/types").License & { used_seats?: number; free_seats?: number })[] {
  const rows = db().prepare(`
    SELECT l.*, COALESCE(ls.cnt, 0) as used_seats
    FROM licenses l
    LEFT JOIN (SELECT license_id, COUNT(*) as cnt FROM license_seats GROUP BY license_id) ls
      ON ls.license_id = l.id
    ORDER BY l.name
  `).all() as (import("@/types").License & { used_seats: number })[];
  return rows.map((row) => ({ ...row, used_seats: row.used_seats || 0, free_seats: Math.max(0, row.seats - (row.used_seats || 0)) }));
}

export function getLicenseById(id: number): (import("@/types").License & { used_seats?: number; free_seats?: number }) | undefined {
  const row = db().prepare(`
    SELECT l.*, COALESCE(ls.cnt, 0) as used_seats
    FROM licenses l
    LEFT JOIN (SELECT license_id, COUNT(*) as cnt FROM license_seats WHERE license_id = ? GROUP BY license_id) ls
      ON ls.license_id = l.id
    WHERE l.id = ?
  `).get(id, id) as (import("@/types").License & { used_seats: number }) | undefined;
  if (!row) return undefined;
  return { ...row, used_seats: row.used_seats || 0, free_seats: Math.max(0, row.seats - (row.used_seats || 0)) };
}

export function createLicense(input: {
  name: string; serial?: string | null; seats?: number; category?: string | null;
  expiration_date?: string | null; purchase_cost?: number | null; min_amt?: number;
  fornitore?: string | null; note?: string | null;
}): import("@/types").License {
  const result = db().prepare(
    "INSERT INTO licenses (name, serial, seats, category, expiration_date, purchase_cost, min_amt, fornitore, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(input.name, input.serial ?? null, input.seats ?? 1, input.category ?? null, input.expiration_date ?? null, input.purchase_cost ?? null, input.min_amt ?? 0, input.fornitore ?? null, input.note ?? null);
  return db().prepare("SELECT * FROM licenses WHERE id = ?").get(result.lastInsertRowid) as import("@/types").License;
}

export function updateLicense(id: number, input: Partial<Omit<import("@/types").License, "id" | "created_at" | "updated_at">>): import("@/types").License | undefined {
  const keys = ["name", "serial", "seats", "category", "expiration_date", "purchase_cost", "min_amt", "fornitore", "note"] as const;
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const k of keys) {
    if (input[k] !== undefined) { fields.push(`${k} = ?`); values.push(input[k]); }
  }
  if (fields.length === 0) return getLicenseById(id) as import("@/types").License | undefined;
  fields.push("updated_at = datetime('now')");
  values.push(id);
  db().prepare(`UPDATE licenses SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return db().prepare("SELECT * FROM licenses WHERE id = ?").get(id) as import("@/types").License;
}

export function deleteLicense(id: number): boolean {
  const del = db().transaction(() => {
    db().prepare("DELETE FROM license_seats WHERE license_id = ?").run(id);
    return db().prepare("DELETE FROM licenses WHERE id = ?").run(id).changes > 0;
  });
  return del();
}

export function getLicenseSeatsByLicense(licenseId: number): import("@/types").LicenseSeat[] {
  return db().prepare("SELECT * FROM license_seats WHERE license_id = ? ORDER BY assigned_at DESC").all(licenseId) as import("@/types").LicenseSeat[];
}

export function getLicenseSeatsByAsset(assetType: "inventory_asset" | "host", assetId: number): (import("@/types").LicenseSeat & { license_name?: string })[] {
  return db().prepare(`
    SELECT ls.*, l.name as license_name FROM license_seats ls
    JOIN licenses l ON l.id = ls.license_id
    WHERE ls.asset_type = ? AND ls.asset_id = ?
  `).all(assetType, assetId) as (import("@/types").LicenseSeat & { license_name?: string })[];
}

export function assignLicenseSeat(licenseId: number, assetType: "inventory_asset" | "host", assetId: number, note?: string | null): import("@/types").LicenseSeat | undefined {
  const lic = getLicenseById(licenseId);
  if (!lic || (lic.free_seats ?? 0) < 1) return undefined;
  const result = db().prepare(
    "INSERT INTO license_seats (license_id, asset_type, asset_id, note) VALUES (?, ?, ?, ?)"
  ).run(licenseId, assetType, assetId, note ?? null);
  return db().prepare("SELECT * FROM license_seats WHERE id = ?").get(result.lastInsertRowid) as import("@/types").LicenseSeat;
}

export function assignLicenseSeatToAssignee(licenseId: number, assetAssigneeId: number, note?: string | null): import("@/types").LicenseSeat | undefined {
  const lic = getLicenseById(licenseId);
  if (!lic || (lic.free_seats ?? 0) < 1) return undefined;
  const result = db().prepare(
    "INSERT INTO license_seats (license_id, asset_assignee_id, note) VALUES (?, ?, ?)"
  ).run(licenseId, assetAssigneeId, note ?? null);
  return db().prepare("SELECT * FROM license_seats WHERE id = ?").get(result.lastInsertRowid) as import("@/types").LicenseSeat;
}

export function unassignLicenseSeat(seatId: number): boolean {
  return db().prepare("DELETE FROM license_seats WHERE id = ?").run(seatId).changes > 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT LOG
// ═══════════════════════════════════════════════════════════════════════════

export function getInventoryAuditLog(assetId: number, limit = 50): import("@/types").InventoryAuditLog[] {
  return db().prepare(
    "SELECT * FROM inventory_audit_log WHERE asset_id = ? ORDER BY created_at DESC LIMIT ?"
  ).all(assetId, limit) as import("@/types").InventoryAuditLog[];
}

// ═══════════════════════════════════════════════════════════════════════════
// PROXMOX HOSTS
// ═══════════════════════════════════════════════════════════════════════════

export function getProxmoxHosts(): import("@/types").ProxmoxHost[] {
  return db().prepare("SELECT * FROM proxmox_hosts ORDER BY name").all() as import("@/types").ProxmoxHost[];
}

export function getProxmoxHostById(id: number): import("@/types").ProxmoxHost | undefined {
  return db().prepare("SELECT * FROM proxmox_hosts WHERE id = ?").get(id) as import("@/types").ProxmoxHost | undefined;
}

export function createProxmoxHost(input: { name: string; host: string; port?: number; credential_id?: number | null }): import("@/types").ProxmoxHost {
  const result = db().prepare(
    "INSERT INTO proxmox_hosts (name, host, port, credential_id) VALUES (?, ?, ?, ?)"
  ).run(input.name, input.host, input.port ?? 8006, input.credential_id ?? null);
  return db().prepare("SELECT * FROM proxmox_hosts WHERE id = ?").get(result.lastInsertRowid) as import("@/types").ProxmoxHost;
}

export function updateProxmoxHost(id: number, input: { name?: string; host?: string; port?: number; credential_id?: number | null; enabled?: number }): import("@/types").ProxmoxHost | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (input.name !== undefined) { fields.push("name = ?"); values.push(input.name); }
  if (input.host !== undefined) { fields.push("host = ?"); values.push(input.host); }
  if (input.port !== undefined) { fields.push("port = ?"); values.push(input.port); }
  if (input.credential_id !== undefined) { fields.push("credential_id = ?"); values.push(input.credential_id); }
  if (input.enabled !== undefined) { fields.push("enabled = ?"); values.push(input.enabled); }
  if (fields.length === 0) return getProxmoxHostById(id);
  fields.push("updated_at = datetime('now')");
  values.push(id);
  db().prepare(`UPDATE proxmox_hosts SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getProxmoxHostById(id);
}

export function updateProxmoxHostScanResult(id: number, resultJson: string): void {
  db().prepare(
    "UPDATE proxmox_hosts SET last_scan_at = datetime('now'), last_scan_result = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(resultJson, id);
}

export function deleteProxmoxHost(id: number): boolean {
  return db().prepare("DELETE FROM proxmox_hosts WHERE id = ?").run(id).changes > 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTIVE DIRECTORY
// ═══════════════════════════════════════════════════════════════════════════

export interface AdIntegration { id: number; name: string; dc_host: string; domain: string; base_dn: string; encrypted_username: string; encrypted_password: string; use_ssl: number; port: number; enabled: number; winrm_credential_id: number | null; /** Account LDAP: voce «Active Directory» dell'archivio (tappa 2f, T24). */ credential_id: number | null; dhcp_leases_count: number; last_sync_at: string | null; last_sync_status: string | null; computers_count: number; users_count: number; groups_count: number; created_at: string; updated_at: string; }
export interface AdComputer { id: number; integration_id: number; object_guid: string; sam_account_name: string; dns_host_name: string | null; display_name: string | null; distinguished_name: string; operating_system: string | null; operating_system_version: string | null; last_logon_at: string | null; enabled: number; host_id: number | null; ip_address: string | null; ou: string | null; raw_data: string | null; synced_at: string; }
export interface AdUser { id: number; integration_id: number; object_guid: string; sam_account_name: string; user_principal_name: string | null; display_name: string | null; email: string | null; department: string | null; title: string | null; phone: string | null; ou: string | null; enabled: number; last_logon_at: string | null; password_last_set_at: string | null; raw_data: string | null; synced_at: string; }
export interface AdDhcpLease { id: number; integration_id: number; scope_id: string; scope_name: string | null; ip_address: string; mac_address: string; hostname: string | null; lease_expires: string | null; address_state: string | null; description: string | null; last_synced: string; }
export interface AdGroup { id: number; integration_id: number; object_guid: string; sam_account_name: string; display_name: string | null; description: string | null; distinguished_name: string; group_type: number | null; member_guids: string | null; synced_at: string; }

export function getAdIntegrations(): AdIntegration[] {
  return db().prepare("SELECT * FROM ad_integrations ORDER BY name").all() as AdIntegration[];
}

export function getAdRealm(): { realm: string; dcHost: string } | null {
  const row = db().prepare("SELECT domain, dc_host FROM ad_integrations WHERE enabled = 1 ORDER BY id LIMIT 1").get() as { domain: string; dc_host: string } | undefined;
  if (!row) return null;
  return { realm: row.domain, dcHost: row.dc_host };
}

export function getAdIntegrationById(id: number): AdIntegration | undefined {
  return db().prepare("SELECT * FROM ad_integrations WHERE id = ?").get(id) as AdIntegration | undefined;
}

export function createAdIntegration(input: { name: string; dc_host: string; domain: string; base_dn: string; encrypted_username: string; encrypted_password: string; use_ssl?: number; port?: number; enabled?: number; winrm_credential_id?: number | null; credential_id?: number | null }): AdIntegration {
  const r = db().prepare(`INSERT INTO ad_integrations (name, dc_host, domain, base_dn, encrypted_username, encrypted_password, use_ssl, port, enabled, winrm_credential_id, credential_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.name, input.dc_host, input.domain, input.base_dn, input.encrypted_username, input.encrypted_password, input.use_ssl ?? 1, input.port ?? 636, input.enabled ?? 1, input.winrm_credential_id ?? null, input.credential_id ?? null);
  return getAdIntegrationById(Number(r.lastInsertRowid))!;
}

export function updateAdIntegration(id: number, input: Partial<{ name: string; dc_host: string; domain: string; base_dn: string; encrypted_username: string; encrypted_password: string; use_ssl: number; port: number; enabled: number; winrm_credential_id: number | null; credential_id: number | null; dhcp_leases_count: number; last_sync_at: string | null; last_sync_status: string | null; computers_count: number; users_count: number; groups_count: number }>): AdIntegration | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined) { fields.push(`${k} = ?`); values.push(v); }
  }
  if (fields.length === 0) return getAdIntegrationById(id);
  fields.push("updated_at = datetime('now')");
  values.push(id);
  db().prepare(`UPDATE ad_integrations SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getAdIntegrationById(id);
}

export function deleteAdIntegration(id: number): boolean {
  return db().prepare("DELETE FROM ad_integrations WHERE id = ?").run(id).changes > 0;
}

export function getAdComputers(integrationId: number): AdComputer[] {
  return db().prepare("SELECT * FROM ad_computers WHERE integration_id = ? ORDER BY sam_account_name").all(integrationId) as AdComputer[];
}

export function getAdComputersPaginated(integrationId: number, page: number, pageSize: number, search?: string, activeDays?: number): { rows: AdComputer[]; total: number } {
  const offset = (page - 1) * pageSize;
  let whereClause = "WHERE integration_id = ?";
  const params: unknown[] = [integrationId];
  if (search?.trim()) { whereClause += " AND (sam_account_name LIKE ? OR dns_host_name LIKE ? OR display_name LIKE ? OR operating_system LIKE ?)"; const s = `%${search.trim()}%`; params.push(s, s, s, s); }
  if (activeDays && activeDays > 0) { whereClause += ` AND last_logon_at IS NOT NULL AND substr(replace(replace(last_logon_at,'T',' '),'Z',''),1,19) >= datetime('now', '-${activeDays} days')`; }
  const total = (db().prepare(`SELECT COUNT(*) as c FROM ad_computers ${whereClause}`).get(...params) as { c: number }).c;
  const rows = db().prepare(`SELECT * FROM ad_computers ${whereClause} ORDER BY sam_account_name LIMIT ? OFFSET ?`).all(...params, pageSize, offset) as AdComputer[];
  return { rows, total };
}

export function upsertAdComputer(integrationId: number, input: { object_guid: string; sam_account_name: string; dns_host_name?: string | null; display_name?: string | null; distinguished_name: string; operating_system?: string | null; operating_system_version?: string | null; last_logon_at?: string | null; enabled?: number; host_id?: number | null; ip_address?: string | null; ou?: string | null; raw_data?: string | null }): void {
  db().prepare(`INSERT INTO ad_computers (integration_id, object_guid, sam_account_name, dns_host_name, display_name, distinguished_name, operating_system, operating_system_version, last_logon_at, enabled, host_id, ip_address, ou, raw_data, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(integration_id, object_guid) DO UPDATE SET sam_account_name = excluded.sam_account_name, dns_host_name = excluded.dns_host_name, display_name = excluded.display_name, distinguished_name = excluded.distinguished_name, operating_system = excluded.operating_system, operating_system_version = excluded.operating_system_version, last_logon_at = excluded.last_logon_at, enabled = excluded.enabled, host_id = excluded.host_id, ip_address = excluded.ip_address, ou = excluded.ou, raw_data = excluded.raw_data, synced_at = datetime('now')`).run(integrationId, input.object_guid, input.sam_account_name, input.dns_host_name ?? null, input.display_name ?? null, input.distinguished_name, input.operating_system ?? null, input.operating_system_version ?? null, input.last_logon_at ?? null, input.enabled ?? 1, input.host_id ?? null, input.ip_address ?? null, input.ou ?? null, input.raw_data ?? null);
}

export function linkAdComputerToHost(integrationId: number, objectGuid: string, hostId: number): void {
  db().prepare("UPDATE ad_computers SET host_id = ? WHERE integration_id = ? AND object_guid = ?").run(hostId, integrationId, objectGuid);
}

export function relinkAdComputersForNetwork(networkId: number): { linked: number; enriched: number } {
  const d = db();
  let linked = 0;
  let enriched = 0;
  const hosts = d.prepare(`SELECT id, ip, mac, hostname, dns_forward, dns_reverse, os_info FROM hosts WHERE network_id = ?`).all(networkId) as Array<{ id: number; ip: string; mac: string | null; hostname: string | null; dns_forward: string | null; dns_reverse: string | null; os_info: string | null }>;
  if (hosts.length === 0) return { linked: 0, enriched: 0 };
  const unlinked = d.prepare(`SELECT ac.id, ac.integration_id, ac.object_guid, ac.dns_host_name, ac.sam_account_name, ac.ip_address, ac.operating_system, ac.host_id FROM ad_computers ac WHERE ac.host_id IS NULL OR ac.host_id IN (SELECT id FROM hosts WHERE network_id = ?)`).all(networkId) as Array<{ id: number; integration_id: number; object_guid: string; dns_host_name: string | null; sam_account_name: string; ip_address: string | null; operating_system: string | null; host_id: number | null }>;
  const hostByIp = new Map(hosts.map((h) => [h.ip, h]));
  const hostByHostname = new Map<string, typeof hosts[0]>();
  for (const h of hosts) {
    if (h.hostname) hostByHostname.set(h.hostname.toLowerCase(), h);
    if (h.dns_reverse) hostByHostname.set(h.dns_reverse.toLowerCase(), h);
    if (h.dns_forward) hostByHostname.set(h.dns_forward.toLowerCase(), h);
  }
  const linkStmt = d.prepare(`UPDATE ad_computers SET host_id = ? WHERE integration_id = ? AND object_guid = ?`);
  // Fase 4: l'euristica server_windows/workstation (da os_info) è stata
  // rimossa — l'evidenza "ad" già emessa in emitters.ts (dimension category,
  // claim compute.server/compute.workstation) la sostituisce nella fusione
  // v2. os_info/hostname restano: sono anagrafica, non attribuzione.
  function enrichHost(hostId: number, comp: typeof unlinked[0], currentHost: typeof hosts[0]) {
    const adHostname = comp.dns_host_name || comp.sam_account_name.replace(/\$$/, "");
    const osRaw = comp.operating_system ?? "";
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (adHostname) { sets.push("hostname = ?", "hostname_source = 'ad'"); vals.push(adHostname); }
    if (adHostname && !currentHost.hostname) { sets.push("custom_name = CASE WHEN custom_name IS NULL OR custom_name = '' THEN ? ELSE custom_name END"); vals.push(adHostname); }
    if (osRaw && (!currentHost.os_info || currentHost.os_info === "unknown")) { sets.push("os_info = ?"); vals.push(osRaw); }
    if (sets.length > 0) { sets.push("updated_at = datetime('now')"); d.prepare(`UPDATE hosts SET ${sets.join(", ")} WHERE id = ?`).run(...vals, hostId); enriched++; }
  }
  const touchedHostIds: number[] = [];
  d.transaction(() => {
    for (const comp of unlinked) {
      const dnsHostName = comp.dns_host_name?.toLowerCase() ?? "";
      const samName = comp.sam_account_name.replace(/\$$/, "").toLowerCase();
      const shortDns = dnsHostName.split(".")[0];
      let host = hostByHostname.get(dnsHostName) ?? hostByHostname.get(samName) ?? hostByHostname.get(shortDns);
      if (!host && comp.ip_address) { host = hostByIp.get(comp.ip_address); }
      if (!host) continue;
      if (comp.host_id !== host.id) { linkStmt.run(host.id, comp.integration_id, comp.object_guid); linked++; }
      enrichHost(host.id, comp, host);
      touchedHostIds.push(host.id);
    }
  })();

  // Attribution v2 (fase 1, parallel-run): rifusione evidenze sugli host toccati
  try {
    const { recomputeAttributionSafe } = require("@/lib/attribution/recompute") as typeof import("@/lib/attribution/recompute");
    for (const id of touchedHostIds) recomputeAttributionSafe(id, "scan");
  } catch (e) {
    console.error("[attribution] recompute da relinkAdComputersForNetwork fallito:", e);
  }

  return { linked, enriched };
}

const MH_HOSTNAME_BLACKLIST = new Set(["localhost", "router", "switch", "firewall", "gateway", "server", "ap", "nas", "printer", "unknown", "default", "test"]);

/**
 * IP v4 string → numeric value per ordinamento deterministico.
 * Per IP non IPv4 (es. IPv6 o stringa malformata) ritorna Infinity così finiscono
 * in coda all'ordinamento del primary-pick.
 */
function ipv4ToInt(ip: string): number {
  const parts = ip.split(".");
  if (parts.length !== 4) return Number.POSITIVE_INFINITY;
  let n = 0;
  for (const p of parts) {
    const x = Number(p);
    if (!Number.isInteger(x) || x < 0 || x > 255) return Number.POSITIVE_INFINITY;
    n = n * 256 + x;
  }
  return n;
}

/**
 * Parametro `targetDb` opzionale: se passato (uso interno dalla migration getTenantDb),
 * usa quel handle invece di `db()` (che richiede context tenant attivo, non ancora
 * disponibile durante l'apertura).
 */
// v0.2.639 audit B8: detect cached se lo schema multihomed_links ammette
// 'physical_device' nel CHECK constraint. Cache per Database handle (tenant).
const multihomedSchemaSupports = new WeakMap<Database.Database, boolean>();
function multihomedSupportsPhysicalDevice(targetDb?: Database.Database): boolean {
  const d = targetDb ?? db();
  const cached = multihomedSchemaSupports.get(d);
  if (cached !== undefined) return cached;
  try {
    const row = d.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='multihomed_links'").get() as { sql?: string } | undefined;
    const ok = !!row?.sql && row.sql.includes("'physical_device'");
    multihomedSchemaSupports.set(d, ok);
    return ok;
  } catch {
    multihomedSchemaSupports.set(d, false);
    return false;
  }
}

export function recomputeMultihomedLinks(targetDb?: Database.Database): { groups: number; hosts_linked: number } {
  const d = targetDb ?? db();
  // Includo `has_device` (1 se l'host ha un network_device associato via IP) per
  // l'auto-pick primary: i managed hanno priorità perché concentrano credenziali,
  // SNMP context e storia di scan.
  // F4 v0.2.596: leggo anche hosts.physical_device_id come anchor di aggregazione.
  // Un physical_device_id condiviso è la firma più forte possibile (utente l'ha
  // dichiarato esplicitamente o l'identity-resolver l'ha trovato): prevale su tutto.
  const hosts = d.prepare(`SELECT h.id, h.network_id, h.ip, h.hostname, h.serial_number, h.snmp_data, h.custom_name, h.physical_device_id, nd.sysname AS dev_sysname, nd.serial_number AS dev_serial, ac.dns_host_name AS ad_dns, CASE WHEN nd.id IS NOT NULL THEN 1 ELSE 0 END AS has_device FROM hosts h LEFT JOIN network_devices nd ON nd.host = h.ip LEFT JOIN (SELECT host_id, MAX(dns_host_name) as dns_host_name FROM ad_computers WHERE host_id IS NOT NULL GROUP BY host_id) ac ON ac.host_id = h.id`).all() as Array<{ id: number; network_id: number; ip: string; hostname: string | null; serial_number: string | null; snmp_data: string | null; custom_name: string | null; physical_device_id: number | null; dev_sysname: string | null; dev_serial: string | null; ad_dns: string | null; has_device: number }>;
  const hostMeta = new Map<number, { ip: string; has_device: number }>();
  for (const h of hosts) hostMeta.set(h.id, { ip: h.ip, has_device: h.has_device });
  const buckets = new Map<string, Set<number>>();
  const hostNet = new Map<number, number>();
  // F4 v0.2.596: priorità 5 a physical_device (anchor user-marked / resolver-validated).
  const PRIORITY: Record<string, number> = { physical_device: 5, serial_number: 4, sysname: 3, hostname: 2, ad_dns: 1 };
  const hostBest = new Map<number, { type: string; value: string; priority: number }>();
  function addToBucket(key: string, hostId: number, type: string, value: string) {
    if (!buckets.has(key)) buckets.set(key, new Set());
    buckets.get(key)!.add(hostId);
    const p = PRIORITY[type] ?? 0;
    const cur = hostBest.get(hostId);
    if (!cur || p > cur.priority) hostBest.set(hostId, { type, value, priority: p });
  }
  for (const h of hosts) {
    hostNet.set(h.id, h.network_id);
    // F4 v0.2.596: anchor #1 — physical_device_id condiviso (dichiarazione esplicita
    // o aggregazione automatica). Sufficiente da solo per formare un gruppo.
    // v0.2.639 audit B8: schema nuovo (CHECK include 'physical_device') vale per
    // tenant nuovi; tenant esistenti hanno CHECK vecchio (la migration ha fallito
    // per il bug os_family GENERATED, rollback). Detect runtime: se il CHECK
    // ammette 'physical_device' usa quello, altrimenti workaround serial_number.
    if (h.physical_device_id) {
      if (multihomedSupportsPhysicalDevice(d)) {
        addToBucket(`physical:${h.physical_device_id}`, h.id, "physical_device", String(h.physical_device_id));
      } else {
        addToBucket(`physical:${h.physical_device_id}`, h.id, "serial_number", `physical_device:${h.physical_device_id}`);
      }
    }
    const serial = (h.serial_number || h.dev_serial || "").trim().toUpperCase();
    if (serial && serial.length >= 4) addToBucket(`serial:${serial}`, h.id, "serial_number", serial);
    let sysName = h.dev_sysname ?? null;
    if (!sysName && h.snmp_data) { try { sysName = (JSON.parse(h.snmp_data) as { sysName?: string }).sysName ?? null; } catch { /* skip */ } }
    if (sysName?.trim() && !MH_HOSTNAME_BLACKLIST.has(sysName.trim().toLowerCase())) addToBucket(`sysname:${sysName.trim().toLowerCase()}`, h.id, "sysname", sysName.trim());
    const hn = (h.hostname ?? "").trim().toLowerCase();
    if (hn && hn.length >= 3 && !MH_HOSTNAME_BLACKLIST.has(hn)) { const shortHn = hn.split(".")[0]; if (shortHn.length >= 3) addToBucket(`hostname:${shortHn}`, h.id, "hostname", h.hostname!.trim()); }
    const adDns = (h.ad_dns ?? "").trim().toLowerCase();
    if (adDns && adDns.length >= 3) { const shortAd = adDns.split(".")[0]; if (shortAd.length >= 3 && !MH_HOSTNAME_BLACKLIST.has(shortAd)) addToBucket(`ad_dns:${shortAd}`, h.id, "ad_dns", h.ad_dns!.trim()); }
  }
  const parent = new Map<number, number>();
  // F4 v0.2.596: traccio quali host appartengono ad almeno un bucket "physical"
  // (aggregazione manuale o resolver-validated). Quei gruppi devono persistere
  // anche se gli host sono nella stessa rete — il check classico "reti diverse"
  // è troppo restrittivo quando l'utente ha già dichiarato la relazione.
  const physicalLinkedHosts = new Set<number>();
  function find(x: number): number { if (!parent.has(x)) parent.set(x, x); if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!)); return parent.get(x)!; }
  function union(a: number, b: number) { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); }
  for (const [key, hostIds] of buckets) {
    if (hostIds.size < 2) continue;
    const isPhysical = key.startsWith("physical:");
    if (isPhysical) {
      for (const hid of hostIds) physicalLinkedHosts.add(hid);
    } else {
      // Per anchor non-physical conserva la regola "reti diverse" (evita falsi
      // positivi su hostname/sysname brevi che capitano nella stessa subnet).
      const nets = new Set<number>();
      for (const hid of hostIds) nets.add(hostNet.get(hid)!);
      if (nets.size < 2) continue;
    }
    const arr = [...hostIds];
    for (let i = 1; i < arr.length; i++) union(arr[0], arr[i]);
  }
  const finalGroups = new Map<number, Set<number>>();
  for (const [hid] of parent) { const root = find(hid); if (!finalGroups.has(root)) finalGroups.set(root, new Set()); finalGroups.get(root)!.add(hid); }
  let groupCount = 0;
  let totalLinked = 0;
  d.transaction(() => {
    d.prepare("DELETE FROM multihomed_links").run();
    const ins = d.prepare("INSERT OR IGNORE INTO multihomed_links (group_id, host_id, match_type, match_value, is_primary) VALUES (?, ?, ?, ?, ?)");
    for (const [, members] of finalGroups) {
      if (members.size < 2) continue;
      // Skip "diverse reti" check per gruppi che includono link physical (manuale).
      const hasPhysicalAnchor = [...members].some((hid) => physicalLinkedHosts.has(hid));
      if (!hasPhysicalAnchor) {
        const nets = new Set<number>();
        for (const hid of members) nets.add(hostNet.get(hid)!);
        if (nets.size < 2) continue;
      }
      const groupId = randomUUID();
      groupCount++;
      // Auto-pick primary: priorità (1) host con network_device associato (managed),
      // (2) a parità, IP numericamente più basso. Deterministico → idempotente sui recompute.
      const ranked = [...members]
        .map((hid) => ({ hid, meta: hostMeta.get(hid)! }))
        .filter((m) => m.meta)
        .sort((a, b) => {
          if (a.meta.has_device !== b.meta.has_device) return b.meta.has_device - a.meta.has_device;
          return ipv4ToInt(a.meta.ip) - ipv4ToInt(b.meta.ip);
        });
      const primaryHid = ranked.length > 0 ? ranked[0].hid : null;
      for (const hid of members) {
        const best = hostBest.get(hid);
        if (best) {
          // v0.2.617: type 'physical_device' non passa il CHECK constraint (vedi
          // commento sopra). Lo mappiamo a 'serial_number' col marker nel value.
          const dbType = best.type === "physical_device" ? "serial_number" : best.type;
          ins.run(groupId, hid, dbType, best.value, hid === primaryHid ? 1 : 0);
          totalLinked++;
        }
      }
    }
  })();
  return { groups: groupCount, hosts_linked: totalLinked };
}

/**
 * Stato multihomed di un host: serve a runner di scan/query per decidere se
 * deduplicare le chiamate costose (SNMP/test cred/software inventory).
 *
 * - `null` se l'host NON appartiene ad alcun gruppo multihomed → eseguire normalmente
 * - `{ is_primary: true, ... }` → eseguire (è l'host designato per il device fisico)
 * - `{ is_primary: false, primary_* }` → SKIP, l'utente può comunque forzare lato UI
 *
 * Idempotente: nessun side-effect.
 */
export function getMultihomedStatus(hostId: number): {
  group_id: string;
  is_primary: boolean;
  primary_host_id: number;
  primary_ip: string;
  primary_network_name: string | null;
  peers_count: number;
} | null {
  const d = db();
  const link = d.prepare("SELECT group_id, is_primary FROM multihomed_links WHERE host_id = ?").get(hostId) as { group_id: string; is_primary: number } | undefined;
  if (!link) return null;
  const primary = d.prepare(`SELECT ml.host_id, h.ip, n.name AS network_name FROM multihomed_links ml JOIN hosts h ON h.id = ml.host_id LEFT JOIN networks n ON n.id = h.network_id WHERE ml.group_id = ? AND ml.is_primary = 1 LIMIT 1`).get(link.group_id) as { host_id: number; ip: string; network_name: string | null } | undefined;
  const peersCount = (d.prepare("SELECT COUNT(*) AS c FROM multihomed_links WHERE group_id = ?").get(link.group_id) as { c: number }).c;
  // Edge case: se per qualche motivo nessuno è marked primary (es. recompute non
  // ancora rieseguito dopo l'aggiunta della colonna), trattiamo come primary
  // l'host stesso così le scan non vengono bloccate ingiustamente.
  if (!primary) return { group_id: link.group_id, is_primary: true, primary_host_id: hostId, primary_ip: "", primary_network_name: null, peers_count: peersCount };
  return {
    group_id: link.group_id,
    is_primary: link.is_primary === 1,
    primary_host_id: primary.host_id,
    primary_ip: primary.ip,
    primary_network_name: primary.network_name,
    peers_count: peersCount,
  };
}

/**
 * Variante che parte da un `network_devices.id`: risolve l'host_id via match
 * `network_devices.host = hosts.ip` (vincolato alla rete del device se possibile).
 * Usata dai runner di scan device (query, test, software-scan) per applicare
 * la policy di dedup multihomed.
 */
export function getMultihomedStatusByDeviceId(deviceId: number): ReturnType<typeof getMultihomedStatus> {
  const d = db();
  const dev = d.prepare("SELECT host FROM network_devices WHERE id = ?").get(deviceId) as { host: string } | undefined;
  if (!dev) return null;
  // L'IP può comparire in più subnet (rarissimo, ma teorico): prendiamo il primo host
  // con quell'IP che ha link multihomed; altrimenti il primo qualsiasi.
  const host = d.prepare(`SELECT h.id FROM hosts h LEFT JOIN multihomed_links ml ON ml.host_id = h.id WHERE h.ip = ? ORDER BY (ml.id IS NULL), h.id LIMIT 1`).get(dev.host) as { id: number } | undefined;
  if (!host) return null;
  return getMultihomedStatus(host.id);
}

export function getAdUsers(integrationId: number): AdUser[] {
  return db().prepare("SELECT * FROM ad_users WHERE integration_id = ? ORDER BY sam_account_name").all(integrationId) as AdUser[];
}

export function getAdUsersPaginated(integrationId: number, page: number, pageSize: number, search?: string, activeDays?: number): { rows: AdUser[]; total: number } {
  const offset = (page - 1) * pageSize;
  let whereClause = "WHERE integration_id = ?";
  const params: unknown[] = [integrationId];
  if (search?.trim()) { whereClause += " AND (sam_account_name LIKE ? OR user_principal_name LIKE ? OR display_name LIKE ? OR email LIKE ? OR department LIKE ?)"; const s = `%${search.trim()}%`; params.push(s, s, s, s, s); }
  if (activeDays && activeDays > 0) { whereClause += ` AND last_logon_at IS NOT NULL AND substr(replace(replace(last_logon_at,'T',' '),'Z',''),1,19) >= datetime('now', '-${activeDays} days')`; }
  const total = (db().prepare(`SELECT COUNT(*) as c FROM ad_users ${whereClause}`).get(...params) as { c: number }).c;
  const rows = db().prepare(`SELECT * FROM ad_users ${whereClause} ORDER BY sam_account_name LIMIT ? OFFSET ?`).all(...params, pageSize, offset) as AdUser[];
  return { rows, total };
}

export function upsertAdUser(integrationId: number, input: { object_guid: string; sam_account_name: string; user_principal_name?: string | null; display_name?: string | null; email?: string | null; department?: string | null; title?: string | null; phone?: string | null; ou?: string | null; enabled?: number; last_logon_at?: string | null; password_last_set_at?: string | null; raw_data?: string | null }): void {
  db().prepare(`INSERT INTO ad_users (integration_id, object_guid, sam_account_name, user_principal_name, display_name, email, department, title, phone, ou, enabled, last_logon_at, password_last_set_at, raw_data, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(integration_id, object_guid) DO UPDATE SET sam_account_name = excluded.sam_account_name, user_principal_name = excluded.user_principal_name, display_name = excluded.display_name, email = excluded.email, department = excluded.department, title = excluded.title, phone = excluded.phone, ou = excluded.ou, enabled = excluded.enabled, last_logon_at = excluded.last_logon_at, password_last_set_at = excluded.password_last_set_at, raw_data = excluded.raw_data, synced_at = datetime('now')`).run(integrationId, input.object_guid, input.sam_account_name, input.user_principal_name ?? null, input.display_name ?? null, input.email ?? null, input.department ?? null, input.title ?? null, input.phone ?? null, input.ou ?? null, input.enabled ?? 1, input.last_logon_at ?? null, input.password_last_set_at ?? null, input.raw_data ?? null);
}

export function getAdGroups(integrationId: number): AdGroup[] {
  return db().prepare("SELECT * FROM ad_groups WHERE integration_id = ? ORDER BY sam_account_name").all(integrationId) as AdGroup[];
}

export function getAdGroupsPaginated(integrationId: number, page: number, pageSize: number, search?: string): { rows: AdGroup[]; total: number } {
  const offset = (page - 1) * pageSize;
  let whereClause = "WHERE integration_id = ?";
  const params: unknown[] = [integrationId];
  if (search?.trim()) { whereClause += " AND (sam_account_name LIKE ? OR display_name LIKE ? OR description LIKE ?)"; const s = `%${search.trim()}%`; params.push(s, s, s); }
  const total = (db().prepare(`SELECT COUNT(*) as c FROM ad_groups ${whereClause}`).get(...params) as { c: number }).c;
  const rows = db().prepare(`SELECT * FROM ad_groups ${whereClause} ORDER BY sam_account_name LIMIT ? OFFSET ?`).all(...params, pageSize, offset) as AdGroup[];
  return { rows, total };
}

export function upsertAdGroup(integrationId: number, input: { object_guid: string; sam_account_name: string; display_name?: string | null; description?: string | null; distinguished_name: string; group_type?: number | null; member_guids?: string | null }): void {
  db().prepare(`INSERT INTO ad_groups (integration_id, object_guid, sam_account_name, display_name, description, distinguished_name, group_type, member_guids, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(integration_id, object_guid) DO UPDATE SET sam_account_name = excluded.sam_account_name, display_name = excluded.display_name, description = excluded.description, distinguished_name = excluded.distinguished_name, group_type = excluded.group_type, member_guids = excluded.member_guids, synced_at = datetime('now')`).run(integrationId, input.object_guid, input.sam_account_name, input.display_name ?? null, input.description ?? null, input.distinguished_name, input.group_type ?? null, input.member_guids ?? null);
}

export function clearAdData(integrationId: number): void {
  db().prepare("DELETE FROM ad_computers WHERE integration_id = ?").run(integrationId);
  db().prepare("DELETE FROM ad_users WHERE integration_id = ?").run(integrationId);
  db().prepare("DELETE FROM ad_groups WHERE integration_id = ?").run(integrationId);
  db().prepare("DELETE FROM ad_dhcp_leases WHERE integration_id = ?").run(integrationId);
}

export function getAdDhcpLeasesPaginated(integrationId: number, page: number, pageSize: number, search?: string): { rows: AdDhcpLease[]; total: number } {
  const offset = (page - 1) * pageSize;
  let whereClause = "WHERE integration_id = ?";
  const params: unknown[] = [integrationId];
  if (search?.trim()) { whereClause += " AND (hostname LIKE ? OR ip_address LIKE ? OR mac_address LIKE ? OR scope_id LIKE ?)"; const s = `%${search.trim()}%`; params.push(s, s, s, s); }
  const total = (db().prepare(`SELECT COUNT(*) as c FROM ad_dhcp_leases ${whereClause}`).get(...params) as { c: number }).c;
  const rows = db().prepare(`SELECT * FROM ad_dhcp_leases ${whereClause} ORDER BY ip_address LIMIT ? OFFSET ?`).all(...params, pageSize, offset) as AdDhcpLease[];
  return { rows, total };
}

export function upsertAdDhcpLease(integrationId: number, input: { scope_id: string; scope_name?: string | null; ip_address: string; mac_address: string; hostname?: string | null; lease_expires?: string | null; address_state?: string | null; description?: string | null; last_seen?: string | null }): void {
  const macNorm = normalizeMacForStorage(input.mac_address) ?? input.mac_address.trim();
  // v0.2.659: aggiunto last_seen (calcolato lato PS come LeaseExpiryTime - LeaseDuration).
  db().prepare(`INSERT INTO ad_dhcp_leases (integration_id, scope_id, scope_name, ip_address, mac_address, hostname, lease_expires, address_state, description, last_seen, last_synced) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(integration_id, ip_address) DO UPDATE SET scope_id = excluded.scope_id, scope_name = excluded.scope_name, mac_address = excluded.mac_address, hostname = excluded.hostname, lease_expires = excluded.lease_expires, address_state = excluded.address_state, description = excluded.description, last_seen = excluded.last_seen, last_synced = datetime('now')`).run(integrationId, input.scope_id, input.scope_name ?? null, input.ip_address, macNorm, input.hostname ?? null, input.lease_expires ?? null, input.address_state ?? null, input.description ?? null, input.last_seen ?? null);
}

export function clearAdDhcpLeases(integrationId: number): void {
  db().prepare("DELETE FROM ad_dhcp_leases WHERE integration_id = ?").run(integrationId);
}

// ═══════════════════════════════════════════════════════════════════════════
// DHCP LEASES
// ═══════════════════════════════════════════════════════════════════════════

export interface DhcpLease { id: number; source_type: "mikrotik" | "windows" | "cisco" | "other"; source_device_id: number | null; source_name: string | null; server_name: string | null; scope_id: string | null; scope_name: string | null; ip_address: string; mac_address: string; hostname: string | null; status: string | null; lease_start: string | null; lease_expires: string | null; description: string | null; dynamic_lease: number | null; last_seen: string | null; host_id: number | null; network_id: number | null; last_synced: string; }
export interface DhcpLeaseWithRelations extends DhcpLease { host_hostname?: string | null; host_ip?: string | null; network_name?: string | null; network_cidr?: string | null; device_name?: string | null; }

export function getDhcpLeases(): DhcpLeaseWithRelations[] {
  return db().prepare(`SELECT d.*, h.hostname as host_hostname, h.ip as host_ip, n.name as network_name, n.cidr as network_cidr, nd.name as device_name FROM dhcp_leases d LEFT JOIN hosts h ON h.id = d.host_id LEFT JOIN networks n ON n.id = d.network_id LEFT JOIN network_devices nd ON nd.id = d.source_device_id ORDER BY d.last_synced DESC`).all() as DhcpLeaseWithRelations[];
}

export function getDhcpLeasesPaginated(
  page: number,
  pageSize: number,
  filters?: {
    search?: string;
    sourceType?: string;
    sourceDeviceId?: number;
    networkId?: number;
    /** Solo lease visti negli ultimi N giorni (prima filtrato nel browser sulla sola pagina, UI-4). */
    recentDays?: number;
    sortKey?: string;
    sortDir?: SortDirection;
  }
): { rows: DhcpLeaseWithRelations[]; total: number } {
  const offset = (page - 1) * pageSize;
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters?.search?.trim()) { const s = `%${filters.search.trim()}%`; conditions.push("(d.ip_address LIKE ? OR d.mac_address LIKE ? OR d.hostname LIKE ?)"); params.push(s, s, s); }
  if (filters?.sourceType) { conditions.push("d.source_type = ?"); params.push(filters.sourceType); }
  if (filters?.sourceDeviceId) { conditions.push("d.source_device_id = ?"); params.push(filters.sourceDeviceId); }
  if (filters?.networkId) { conditions.push("d.network_id = ?"); params.push(filters.networkId); }
  if (filters?.recentDays && filters.recentDays > 0) { conditions.push("datetime(d.last_seen) >= datetime('now', ?)"); params.push(`-${Math.floor(filters.recentDays)} days`); }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = (db().prepare(`SELECT COUNT(*) as c FROM dhcp_leases d ${whereClause}`).get(...params) as { c: number }).c;
  const orderSql = sqlOrderByDhcpLeases(filters?.sortKey, filters?.sortDir ?? "desc");
  const rows = db().prepare(`SELECT d.*, h.hostname as host_hostname, h.ip as host_ip, n.name as network_name, n.cidr as network_cidr, nd.name as device_name FROM dhcp_leases d LEFT JOIN hosts h ON h.id = d.host_id LEFT JOIN networks n ON n.id = d.network_id LEFT JOIN network_devices nd ON nd.id = d.source_device_id ${whereClause} ORDER BY ${orderSql} LIMIT ? OFFSET ?`).all(...params, pageSize, offset) as DhcpLeaseWithRelations[];
  return { rows, total };
}

export function getDhcpLeasesByDevice(deviceId: number): DhcpLease[] {
  return db().prepare("SELECT * FROM dhcp_leases WHERE source_device_id = ? ORDER BY ip_address").all(deviceId) as DhcpLease[];
}

export function upsertDhcpLease(input: { source_type: "mikrotik" | "windows" | "cisco" | "other"; source_device_id: number; source_name?: string | null; server_name?: string | null; scope_id?: string | null; scope_name?: string | null; ip_address: string; mac_address: string; hostname?: string | null; status?: string | null; lease_start?: string | null; lease_expires?: string | null; description?: string | null; host_id?: number | null; network_id?: number | null; dynamic_lease?: number | null; last_seen?: string | null }): void {
  const d = db();
  const macNorm = normalizeMacForStorage(input.mac_address) ?? input.mac_address.trim();
  // v0.2.659: aggiunto last_seen (ISO timestamp, da Mikrotik last-seen o
  // calcolato per Windows DHCP).
  d.prepare(`INSERT INTO dhcp_leases (source_type, source_device_id, source_name, server_name, scope_id, scope_name, ip_address, mac_address, hostname, status, lease_start, lease_expires, description, dynamic_lease, last_seen, host_id, network_id, last_synced) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(source_device_id, ip_address) DO UPDATE SET source_name = excluded.source_name, server_name = excluded.server_name, scope_id = excluded.scope_id, scope_name = excluded.scope_name, mac_address = excluded.mac_address, hostname = excluded.hostname, status = excluded.status, lease_start = excluded.lease_start, lease_expires = excluded.lease_expires, description = excluded.description, dynamic_lease = COALESCE(excluded.dynamic_lease, dhcp_leases.dynamic_lease), last_seen = COALESCE(excluded.last_seen, dhcp_leases.last_seen), host_id = COALESCE(excluded.host_id, dhcp_leases.host_id), network_id = COALESCE(excluded.network_id, dhcp_leases.network_id), last_synced = datetime('now')`).run(input.source_type, input.source_device_id, input.source_name ?? null, input.server_name ?? null, input.scope_id ?? null, input.scope_name ?? null, input.ip_address, macNorm, input.hostname ?? null, input.status ?? null, input.lease_start ?? null, input.lease_expires ?? null, input.description ?? null, input.dynamic_lease ?? null, input.last_seen ?? null, input.host_id ?? null, input.network_id ?? null);
}

export function syncIpAssignmentsForNetwork(networkId: number): number {
  const network = getNetworkById(networkId);
  if (!network) return 0;
  const rows = db().prepare(`SELECT id, ip, mac FROM hosts WHERE network_id = ?`).all(networkId) as { id: number; ip: string; mac: string | null }[];
  if (rows.length === 0) return 0;
  const dhcpLeases = db().prepare(`SELECT * FROM dhcp_leases WHERE network_id = ?`).all(networkId) as DhcpLease[];
  const ips = rows.map((r) => r.ip);
  const placeholders = ips.map(() => "?").join(",");
  const adLeasesByIp = db().prepare(`SELECT * FROM ad_dhcp_leases WHERE ip_address IN (${placeholders})`).all(...ips) as AdDhcpLease[];
  const byIpAd = new Map<string, AdDhcpLease>();
  for (const a of adLeasesByIp) { if (!byIpAd.has(a.ip_address)) byIpAd.set(a.ip_address, a); }
  const needsFullAdForMac = rows.some((h) => !!h.mac?.trim() && !byIpAd.get(h.ip));
  const adAllRows = needsFullAdForMac ? (db().prepare(`SELECT * FROM ad_dhcp_leases`).all() as AdDhcpLease[]) : [];
  const stmt = db().prepare(`UPDATE hosts SET ip_assignment = ?, updated_at = datetime('now') WHERE id = ?`);
  let n = 0;
  for (const h of rows) {
    const dhcpLease = resolveDhcpLeaseForHost(h.ip, h.mac, dhcpLeases);
    const adLease = resolveAdDhcpLeaseForHost(h.ip, h.mac, byIpAd, adAllRows);
    const next = inferIpAssignment(dhcpLease, adLease);
    stmt.run(next, h.id);
    n++;
  }
  return n;
}

export function syncIpAssignmentsForAllNetworks(): number {
  const nets = getNetworks();
  let t = 0;
  for (const n of nets) { t += syncIpAssignmentsForNetwork(n.id); }
  return t;
}

export function bulkUpsertDhcpLeases(leases: Array<{ source_type: "mikrotik" | "windows" | "cisco" | "other"; source_device_id: number; source_name?: string | null; server_name?: string | null; ip_address: string; mac_address: string; hostname?: string | null; status?: string | null; lease_expires?: string | null; description?: string | null; network_id?: number | null; dynamic_lease?: number | null }>): { inserted: number; updated: number } {
  let inserted = 0;
  let updated = 0;
  const netIds = new Set<number | null>();
  const t = db().transaction(() => {
    for (const lease of leases) {
      const existing = db().prepare("SELECT id FROM dhcp_leases WHERE source_device_id = ? AND ip_address = ?").get(lease.source_device_id, lease.ip_address);
      upsertDhcpLease(lease);
      if (existing) updated++; else inserted++;
      if (lease.network_id != null) netIds.add(lease.network_id);
    }
  });
  t();
  for (const nid of netIds) { if (nid != null) syncIpAssignmentsForNetwork(nid); }
  return { inserted, updated };
}

export function deleteDhcpLeasesByDevice(deviceId: number): number {
  return db().prepare("DELETE FROM dhcp_leases WHERE source_device_id = ?").run(deviceId).changes;
}

export function getDhcpLeaseStats(): { total: number; bySource: Record<string, number>; byNetwork: Array<{ network_id: number; network_name: string; count: number }> } {
  const total = (db().prepare("SELECT COUNT(*) as c FROM dhcp_leases").get() as { c: number }).c;
  const bySourceRows = db().prepare("SELECT source_type, COUNT(*) as c FROM dhcp_leases GROUP BY source_type").all() as Array<{ source_type: string; c: number }>;
  const bySource: Record<string, number> = {};
  for (const r of bySourceRows) bySource[r.source_type] = r.c;
  const byNetwork = db().prepare(`SELECT d.network_id, COALESCE(n.name, 'Sconosciuta') as network_name, COUNT(*) as count FROM dhcp_leases d LEFT JOIN networks n ON n.id = d.network_id GROUP BY d.network_id ORDER BY count DESC`).all() as Array<{ network_id: number; network_name: string; count: number }>;
  return { total, bySource, byNetwork };
}

// ═══════════════════════════════════════════════════════════════════════════
// MISC
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Reset configurazione tenant (solo tabelle tenant, non hub).
 * Le catene vecchie (`network_host_credentials`, `host_detect_credential`)
 * non si nominano (T26): dove ci sono ancora, le loro righe se ne vanno con la
 * cascata di `credentials`, `hosts` e `networks`; dove la pulizia della 2g le
 * ha tolte, una DELETE darebbe «no such table» e farebbe fallire l'intero
 * reset, che è una transazione.
 */
export function resetConfiguration(): void {
  const d = db();
  d.transaction(() => {
    d.exec(`
      DELETE FROM scan_history;
      DELETE FROM status_history;
      DELETE FROM host_credentials;
      DELETE FROM network_credentials;
      DELETE FROM arp_entries;
      DELETE FROM mac_port_entries;
      DELETE FROM mac_ip_history;
      DELETE FROM mac_ip_mapping;
      DELETE FROM switch_ports;
      DELETE FROM network_router;
      DELETE FROM device_credential_bindings;
      DELETE FROM device_neighbors;
      DELETE FROM routing_table;
      DELETE FROM multihomed_links;
      DELETE FROM hosts;
      DELETE FROM network_devices;
      DELETE FROM networks;
      DELETE FROM ad_dhcp_leases;
      DELETE FROM ad_computers;
      DELETE FROM ad_users;
      DELETE FROM ad_groups;
      DELETE FROM ad_integrations;
      DELETE FROM credentials;
      DELETE FROM scheduled_jobs;
      DELETE FROM proxmox_hosts;
      DELETE FROM inventory_audit_log;
      DELETE FROM license_seats;
      DELETE FROM licenses;
      DELETE FROM asset_assignees;
      DELETE FROM inventory_assets;
      DELETE FROM locations;
      DELETE FROM dhcp_leases;
    `);
  })();
}

export function getDistinctHostVendorHints(limit = 400): string[] {
  const rows = db()
    .prepare(
      `SELECT DISTINCT trim(v) AS v FROM (
        SELECT vendor AS v FROM hosts WHERE vendor IS NOT NULL AND trim(vendor) != ''
        UNION
        SELECT device_manufacturer AS v FROM hosts WHERE device_manufacturer IS NOT NULL AND trim(device_manufacturer) != ''
      ) ORDER BY v COLLATE NOCASE LIMIT ?`
    )
    .all(limit) as { v: string }[];
  return rows.map((r) => r.v);
}

// ═══════════════════════════════════════════════════════════════════════════
// CROSS-TENANT AGGREGATION (superadmin)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Esegue una query su TUTTI i tenant attivi e unisce i risultati.
 * Ogni item viene annotato con _tenantCode e _tenantName.
 */
export function queryAllTenants<T extends Record<string, unknown>>(
  fn: () => T[]
): (T & { _tenantCode: string; _tenantName: string })[] {
  const tenants = getActiveTenants();
  const results: (T & { _tenantCode: string; _tenantName: string })[] = [];
  for (const t of tenants) {
    try {
      const items = withTenant(t.codice_cliente, fn);
      for (const item of items) {
        results.push({ ...item, _tenantCode: t.codice_cliente, _tenantName: t.ragione_sociale });
      }
    } catch { /* skip tenant con errori */ }
  }
  return results;
}

/**
 * Esegue una query scalare/aggregata su TUTTI i tenant attivi.
 * Restituisce un array con il risultato per ogni tenant.
 */
export function queryAllTenantsScalar<T>(
  fn: () => T
): Array<{ tenant: { code: string; name: string }; data: T }> {
  const tenants = getActiveTenants();
  return tenants.map(t => {
    try {
      return { tenant: { code: t.codice_cliente, name: t.ragione_sociale }, data: withTenant(t.codice_cliente, fn) };
    } catch {
      return { tenant: { code: t.codice_cliente, name: t.ragione_sociale }, data: null as unknown as T };
    }
  });
}


/**
 * Per ogni host con findings CVE archiviati: severità peggiore + conteggi
 * Critical/High/Medium dell'ultima scan_run su quell'host.
 *
 * Usato in /discovery per la colonna "Vulnerabilità". O(N) con index su
 * vuln_findings(host_id, scanned_at DESC) — già presente.
 */
export interface HostVulnSummary {
  max_severity: "Critical" | "High" | "Medium" | "Low";
  critical: number;
  high: number;
  medium: number;
  total: number;
}

// v0.2.646 audit perf UI11: cache per-tenant del summary CVE, TTL 30s.
// La query fa 2 full-scan + GROUP BY su vuln_findings + wazuh_vuln (100k row
// tipici = 500-1500ms). Viene invocata ad ogni hit di /api/hosts/discovery
// (apertura pagina + refetch post-mutation). Cache abbatte il costo dopo
// la prima call, invalidata implicitamente dal TTL.
interface VulnSummaryCacheEntry {
  data: Map<number, HostVulnSummary>;
  expires: number;
}
const vulnSummaryCache = new Map<string, VulnSummaryCacheEntry>();
const VULN_SUMMARY_TTL_MS = 30_000;

export function invalidateAllHostsVulnSummaryCache(): void {
  const tenant = getCurrentTenantCode() ?? "_default";
  vulnSummaryCache.delete(tenant);
}

export function getAllHostsVulnSummary(): Map<number, HostVulnSummary> {
  const tenant = getCurrentTenantCode() ?? "_default";
  const cached = vulnSummaryCache.get(tenant);
  if (cached && cached.expires > Date.now()) return cached.data;

  // Aggregazione SU TUTTE le scan_run + Wazuh: per ogni host conta findings
  // per severità da entrambe le fonti (scanner-edge `vuln_findings` e Wazuh
  // `wazuh_vuln` joinato via wazuh_agent.host_id). Per discovery interessa
  // "ha mai avuto CVE Critical/High" non "ne ha ora", quindi nessun filtro
  // temporale. Le due fonti possono sovrapporsi sullo stesso CVE: i conteggi
  // si sommano (UNION ALL) — accettiamo possibile inflazione perché l'obiettivo
  // della discovery è triage rapido, non analisi puntuale.
  const rows = db()
    .prepare(
      `SELECT host_id, severity, SUM(n) AS n FROM (
         SELECT host_id, severity, COUNT(*) AS n
           FROM vuln_findings
          WHERE host_id IS NOT NULL
            AND severity IN ('Critical','High','Medium','Low')
          GROUP BY host_id, severity
         UNION ALL
         SELECT wa.host_id AS host_id, wv.severity AS severity, COUNT(*) AS n
           FROM wazuh_vuln wv
           JOIN wazuh_agent wa ON wa.agent_id = wv.agent_id
          WHERE wa.host_id IS NOT NULL
            AND wv.status = 'VALID'
            AND wv.severity IN ('Critical','High','Medium','Low')
          GROUP BY wa.host_id, wv.severity
       )
       GROUP BY host_id, severity`
    )
    .all() as Array<{ host_id: number; severity: string; n: number }>;

  const rank: Record<string, number> = {
    Critical: 0, High: 1, Medium: 2, Low: 3, Unknown: 5,
  };
  const map = new Map<number, HostVulnSummary>();
  for (const r of rows) {
    const cur = map.get(r.host_id) ?? {
      max_severity: "Low" as HostVulnSummary["max_severity"],
      critical: 0, high: 0, medium: 0, total: 0,
    };
    if (r.severity === "Critical") cur.critical = r.n;
    else if (r.severity === "High") cur.high = r.n;
    else if (r.severity === "Medium") cur.medium = r.n;
    cur.total += r.n;
    // max_severity = il più alto (rank più basso) tra quelli osservati
    const curRank = rank[cur.max_severity] ?? 5;
    const newRank = rank[r.severity] ?? 5;
    if (newRank < curRank) {
      cur.max_severity = r.severity as HostVulnSummary["max_severity"];
    }
    map.set(r.host_id, cur);
  }
  vulnSummaryCache.set(tenant, { data: map, expires: Date.now() + VULN_SUMMARY_TTL_MS });
  return map;
}

// ═══════════════════════════════════════════════════════════════════════════
// TENANT SETTINGS (key/value)
// ═══════════════════════════════════════════════════════════════════════════

export function getTenantSetting(key: string): string | null {
  const row = db()
    .prepare("SELECT value FROM tenant_settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setTenantSetting(key: string, value: string): void {
  db()
    .prepare(
      `INSERT INTO tenant_settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    )
    .run(key, value);
}

export function deleteTenantSetting(key: string): void {
  db().prepare("DELETE FROM tenant_settings WHERE key = ?").run(key);
}

export function getAllTenantSettings(): Record<string, string> {
  const rows = db()
    .prepare("SELECT key, value FROM tenant_settings")
    .all() as { key: string; value: string }[];
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// SOFTWARE INVENTORY — scan / inventory / logs (tenant-scoped)
// ═══════════════════════════════════════════════════════════════════════════

const SOFTWARE_RETENTION_KEY = "software_scan_retention_per_host";
const SOFTWARE_RETENTION_DEFAULT = 12;
const SOFTWARE_RETENTION_MIN = 1;
const SOFTWARE_RETENTION_MAX = 999;

export function getSoftwareScanRetention(): number {
  const raw = getTenantSetting(SOFTWARE_RETENTION_KEY);
  if (!raw) return SOFTWARE_RETENTION_DEFAULT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return SOFTWARE_RETENTION_DEFAULT;
  if (n < SOFTWARE_RETENTION_MIN) return SOFTWARE_RETENTION_MIN;
  if (n > SOFTWARE_RETENTION_MAX) return SOFTWARE_RETENTION_MAX;
  return n;
}

export function setSoftwareScanRetention(value: number): number {
  let v = Math.trunc(value);
  if (!Number.isFinite(v)) v = SOFTWARE_RETENTION_DEFAULT;
  if (v < SOFTWARE_RETENTION_MIN) v = SOFTWARE_RETENTION_MIN;
  if (v > SOFTWARE_RETENTION_MAX) v = SOFTWARE_RETENTION_MAX;
  setTenantSetting(SOFTWARE_RETENTION_KEY, String(v));
  return v;
}

export interface CreateSoftwareScanInput {
  target: SoftwareScanTarget;
  os_family: SoftwareOsFamily;
  probe: SoftwareProbe;
  timeout_ms: number;
  triggered_by: SoftwareScanTrigger;
  triggered_by_user_id?: number | null;
  credential_id?: number | null;
}

export function createSoftwareScan(input: CreateSoftwareScanInput): number {
  const hostId = input.target.kind === "host" ? input.target.hostId : null;
  const deviceId = input.target.kind === "device" ? input.target.deviceId : null;
  const stmt = db().prepare(
    `INSERT INTO software_scans
       (host_id, device_id, started_at, status, os_family, probe, timeout_ms,
        triggered_by, triggered_by_user_id, credential_id)
     VALUES (?, ?, datetime('now'), 'running', ?, ?, ?, ?, ?, ?)`
  );
  const info = stmt.run(
    hostId,
    deviceId,
    input.os_family,
    input.probe,
    input.timeout_ms,
    input.triggered_by,
    input.triggered_by_user_id ?? null,
    input.credential_id ?? null
  );
  return Number(info.lastInsertRowid);
}

export interface UpdateSoftwareScanInput {
  status: SoftwareScanStatus;
  apps_count?: number;
  error_message?: string | null;
  probe?: SoftwareProbe;
}

export function updateSoftwareScanFinish(
  scanId: number,
  input: UpdateSoftwareScanInput
): void {
  db()
    .prepare(
      `UPDATE software_scans
          SET status = ?,
              finished_at = datetime('now'),
              apps_count = COALESCE(?, apps_count),
              error_message = ?,
              probe = COALESCE(?, probe)
        WHERE id = ?`
    )
    .run(
      input.status,
      input.apps_count ?? null,
      input.error_message ?? null,
      input.probe ?? null,
      scanId
    );
}

export function insertSoftwareInventoryBulk(
  scanId: number,
  packages: SoftwarePackage[]
): number {
  if (packages.length === 0) return 0;
  const stmt = db().prepare(
    `INSERT INTO software_inventory
       (scan_id, name, version, publisher, install_date, install_location,
        source, architecture, size_bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const tx = db().transaction((rows: SoftwarePackage[]) => {
    for (const p of rows) {
      stmt.run(
        scanId,
        p.name,
        p.version,
        p.publisher,
        p.install_date,
        p.install_location,
        p.source,
        p.architecture,
        p.size_bytes
      );
    }
  });
  tx(packages);
  return packages.length;
}

export function insertSoftwareScanLog(
  scanId: number,
  level: SoftwareLogLevel,
  step: string | null,
  message: string,
  details?: unknown
): void {
  let detailsJson: string | null = null;
  if (details !== undefined && details !== null) {
    try {
      detailsJson = JSON.stringify(details);
    } catch {
      detailsJson = null;
    }
  }
  db()
    .prepare(
      `INSERT INTO software_scan_logs (scan_id, ts, level, step, message, details)
       VALUES (?, datetime('now'), ?, ?, ?, ?)`
    )
    .run(scanId, level, step, message, detailsJson);
}

export function cleanupOldSoftwareScansForHost(
  hostId: number,
  keep: number
): number {
  if (!Number.isFinite(keep) || keep < 1) return 0;
  const info = db()
    .prepare(
      `DELETE FROM software_scans
        WHERE host_id = ?
          AND status != 'running'
          AND id NOT IN (
            SELECT id FROM software_scans
             WHERE host_id = ? AND status != 'running'
             ORDER BY started_at DESC
             LIMIT ?
          )`
    )
    .run(hostId, hostId, keep);
  return Number(info.changes);
}

export function cleanupOldSoftwareScansForDevice(
  deviceId: number,
  keep: number
): number {
  if (!Number.isFinite(keep) || keep < 1) return 0;
  const info = db()
    .prepare(
      `DELETE FROM software_scans
        WHERE device_id = ?
          AND status != 'running'
          AND id NOT IN (
            SELECT id FROM software_scans
             WHERE device_id = ? AND status != 'running'
             ORDER BY started_at DESC
             LIMIT ?
          )`
    )
    .run(deviceId, deviceId, keep);
  return Number(info.changes);
}

export function cleanupOldSoftwareScansForTarget(
  target: SoftwareScanTarget,
  keep: number
): number {
  return target.kind === "host"
    ? cleanupOldSoftwareScansForHost(target.hostId, keep)
    : cleanupOldSoftwareScansForDevice(target.deviceId, keep);
}

export function getSoftwareScanById(scanId: number): SoftwareScan | undefined {
  return db()
    .prepare("SELECT * FROM software_scans WHERE id = ?")
    .get(scanId) as SoftwareScan | undefined;
}

export function getSoftwareScansForHost(
  hostId: number,
  limit: number = 20,
  offset: number = 0
): SoftwareScan[] {
  const safeLimit = Math.min(Math.max(1, Math.trunc(limit)), 200);
  const safeOffset = Math.max(0, Math.trunc(offset));
  return db()
    .prepare(
      `SELECT * FROM software_scans
        WHERE host_id = ?
        ORDER BY started_at DESC
        LIMIT ? OFFSET ?`
    )
    .all(hostId, safeLimit, safeOffset) as SoftwareScan[];
}

export function getSoftwareInventoryForScan(
  scanId: number
): SoftwareInventoryRow[] {
  return db()
    .prepare(
      `SELECT * FROM software_inventory
        WHERE scan_id = ?
        ORDER BY LOWER(name) ASC, version ASC`
    )
    .all(scanId) as SoftwareInventoryRow[];
}

export function getSoftwareScanLogs(
  scanId: number,
  limit: number = 500
): SoftwareScanLog[] {
  const safeLimit = Math.min(Math.max(1, Math.trunc(limit)), 5000);
  return db()
    .prepare(
      `SELECT * FROM software_scan_logs
        WHERE scan_id = ?
        ORDER BY ts ASC, id ASC
        LIMIT ?`
    )
    .all(scanId, safeLimit) as SoftwareScanLog[];
}

export function getLatestOkSoftwareScanForHost(
  hostId: number
): SoftwareScan | undefined {
  return db()
    .prepare(
      `SELECT * FROM software_scans
        WHERE host_id = ? AND status = 'ok'
        ORDER BY started_at DESC
        LIMIT 1`
    )
    .get(hostId) as SoftwareScan | undefined;
}

export function getSoftwareScansForDevice(
  deviceId: number,
  limit: number = 20,
  offset: number = 0
): SoftwareScan[] {
  const safeLimit = Math.min(Math.max(1, Math.trunc(limit)), 200);
  const safeOffset = Math.max(0, Math.trunc(offset));
  return db()
    .prepare(
      `SELECT * FROM software_scans
        WHERE device_id = ?
        ORDER BY started_at DESC
        LIMIT ? OFFSET ?`
    )
    .all(deviceId, safeLimit, safeOffset) as SoftwareScan[];
}

/**
 * Trova il network_device linkato a un host via IP (network_devices.host = hosts.ip).
 * Ritorna il primo (i casi multi-device per stesso IP sono rari, non gestiti qui).
 */
export function getNetworkDeviceByIp(ip: string): NetworkDevice | undefined {
  return db()
    .prepare("SELECT * FROM network_devices WHERE host = ? LIMIT 1")
    .get(ip) as NetworkDevice | undefined;
}

/**
 * Aggiorna campi di `network_devices` legati a un host via IP (network_devices.host = hosts.ip).
 * Ritorna il numero di righe modificate. Usato dal bulk-update di /discovery.
 * Whitelist dei campi accettati per sicurezza.
 */
const ALLOWED_NETWORK_DEVICE_BULK_FIELDS = new Set([
  "device_type", "vendor", "vendor_subtype", "scan_target", "classification",
]);

export function bulkUpdateNetworkDeviceByHostId(
  hostId: number,
  fields: Record<string, unknown>
): number {
  const entries = Object.entries(fields).filter(([k]) => ALLOWED_NETWORK_DEVICE_BULK_FIELDS.has(k));
  if (entries.length === 0) return 0;
  const sets = entries.map(([k]) => `${k} = ?`).join(", ");
  const vals = entries.map(([, v]) => v);
  const r = db()
    .prepare(
      `UPDATE network_devices SET ${sets}, updated_at = datetime('now')
        WHERE host IN (SELECT ip FROM hosts WHERE id = ?)`
    )
    .run(...vals, hostId);
  return Number(r.changes);
}

const ALLOWED_INVENTORY_ASSET_BULK_FIELDS = new Set([
  "categoria_nis2", "criticita_nis2", "categoria", "stato",
  "business_owner_id", "technical_owner_id", "location_id",
]);

export function bulkUpdateInventoryAssetByHostId(
  hostId: number,
  fields: Record<string, unknown>
): number {
  const entries = Object.entries(fields).filter(([k]) => ALLOWED_INVENTORY_ASSET_BULK_FIELDS.has(k));
  if (entries.length === 0) return 0;
  const sets = entries.map(([k]) => `${k} = ?`).join(", ");
  const vals = entries.map(([, v]) => v);
  const r = db()
    .prepare(
      `UPDATE inventory_assets SET ${sets}, updated_at = datetime('now')
        WHERE host_id = ?`
    )
    .run(...vals, hostId);
  return Number(r.changes);
}

export function getLatestOkSoftwareScanForDevice(
  deviceId: number
): SoftwareScan | undefined {
  return db()
    .prepare(
      `SELECT * FROM software_scans
        WHERE device_id = ? AND status = 'ok'
        ORDER BY started_at DESC
        LIMIT 1`
    )
    .get(deviceId) as SoftwareScan | undefined;
}

// ═══════════════════════════════════════════════════════════════════════════
// AGGREGAZIONI GLOBALI: pagine /vulnerabilities e /software
// Vista INVERSA: data una CVE / un software → lista host che lo presentano.
// Sorgenti unificate per vulnerabilità:
//  - "Edge"  = vuln_findings, ovvero le CVE che arrivano dal scanner-edge
//              appliance (uplink sync periodico). Lo strumento dietro (Greenbone,
//              OpenVAS, ecc.) NON viene esposto in UI: dal punto di vista
//              DA-IPAM la fonte è il canale Edge stesso.
//  - "Wazuh" = wazuh_vuln, ovvero le CVE riportate dagli agent Wazuh installati
//              sugli endpoint.
// Sorgenti unificate per software: SOLO wazuh_software + software_inventory.
// Le vuln_findings (Edge) NON sono una fonte di software (sono vulnerabilità).
// ═══════════════════════════════════════════════════════════════════════════

import { SEVERITY_RANK, maxSeverity, normalizeSeverity, type Severity } from "./severity-style";
import { rangoExploit, type ExploitInfo } from "./vuln/exploit-feed/archivio";

export type AggregatedVulnSourceLabel = string;

export interface AggregatedVulnHostRef {
  host_id: number | null;
  ip: string;
  hostname: string | null;
  network_id: number | null;
  network_name: string | null;
  severity: string;
  cvss_score: number | null;
  source: AggregatedVulnSourceLabel;
  package_label: string | null;
  scanned_at: string;
}

export interface AggregatedVuln {
  key: string;
  cve_id: string | null;
  nvt_oid: string | null;
  severity: Severity;
  cvss_score: number | null;
  package_label: string | null;
  sources: AggregatedVulnSourceLabel[];
  host_count: number;
  orphan_count: number;
  hosts_preview: AggregatedVulnHostRef[];
  latest_scanned_at: string;
  /** Exploit noti (KEV, Exploit-DB, EPSS); null = nessuna fonte la cita, o chiave `nvt:`. */
  exploit: ExploitInfo | null;
}

/** «kev» = sfruttata attivamente (CISA KEV), «edb» = exploit pubblico (Exploit-DB). */
export type FiltroExploit = "kev" | "edb";

/** Le informazioni sugli exploit per un elenco di CVE: la rotta passa l'archivio vero, le prove uno finto. */
export type ExploitDi = (cves: string[]) => Map<string, ExploitInfo>;

export type OsFamily = "Windows" | "Linux" | "Apple" | "Unknown";

export const OS_FAMILIES: readonly OsFamily[] = ["Windows", "Linux", "Apple", "Unknown"] as const;

/**
 * Carica la mappa hostId → OsFamily per un set di host. Usa hosts.os_info
 * (free text classificato via keyword) come fonte primaria.
 */
export function loadHostsOsFamily(hostIds: number[]): Map<number, OsFamily> {
  const out = new Map<number, OsFamily>();
  if (hostIds.length === 0) return out;
  const placeholders = hostIds.map(() => "?").join(",");
  const rows = db()
    .prepare(`SELECT id, os_info FROM hosts WHERE id IN (${placeholders})`)
    .all(...hostIds) as Array<{ id: number; os_info: string | null }>;
  for (const r of rows) out.set(r.id, classifyOsFamily(r.os_info));
  return out;
}

/**
 * Classifica un host in una famiglia OS in base a `hosts.os_info`
 * (free text). Best-effort tramite keyword matching case-insensitive.
 */
export function classifyOsFamily(osInfo: string | null | undefined): OsFamily {
  if (!osInfo) return "Unknown";
  const s = osInfo.toLowerCase();
  if (s.includes("windows")) return "Windows";
  if (s.includes("macos") || s.includes("mac os") || s.includes("darwin") || s.includes("osx")) return "Apple";
  if (
    s.includes("linux") || s.includes("ubuntu") || s.includes("debian") ||
    s.includes("centos") || s.includes("rhel") || s.includes("red hat") ||
    s.includes("fedora") || s.includes("alpine") || s.includes("suse") ||
    s.includes("arch") || s.includes("rocky") || s.includes("almalinux")
  ) return "Linux";
  return "Unknown";
}

export interface AggregatedVulnOpts {
  page: number;
  pageSize: number;
  severity?: Severity[];
  sources?: string[];
  osFamilies?: OsFamily[];
  search?: string;
  hasCve?: boolean;
  exploit?: FiltroExploit[];
  exploitDi?: ExploitDi;
  sortBy?: "severity" | "cvss" | "host_count" | "latest_scanned_at" | "cve_id" | "exploit";
  sortDir?: "asc" | "desc";
}

export interface AggregatedVulnResult {
  data: AggregatedVuln[];
  total: number;
  severity_rollup: { Critical: number; High: number; Medium: number; Low: number };
}

export type SoftwareSource = "Wazuh" | "Probe" | "Agent";

export interface AggregatedSoftwareHostRef {
  host_id: number;
  ip: string;
  hostname: string | null;
  network_id: number | null;
  network_name: string | null;
  sources: SoftwareSource[];
  publisher: string | null;
  install_date: string | null;
  scanned_at: string | null;
  version: string | null;          // versione installata su questo host (può differire fra host)
}

export interface AggregatedSoftwareVersionHost {
  host_id: number;
  ip: string;
  hostname: string | null;
}

export interface AggregatedSoftwareVersion {
  version: string | null;
  host_count: number;
  latest_seen_at: string | null;
  hosts: AggregatedSoftwareVersionHost[];   // elenco computer per QUESTA versione
}

export interface AggregatedSoftware {
  key: string;                 // = lowercase(name)
  name: string;
  publisher: string | null;
  sources: SoftwareSource[];
  host_count: number;          // host distinti (qualunque versione)
  hosts_preview: AggregatedSoftwareHostRef[];
  vuln_count: number;
  latest_seen_at: string | null;
  versions: AggregatedSoftwareVersion[];  // dettaglio versioni (ordinato desc)
}

export interface AggregatedSoftwareOpts {
  page: number;
  pageSize: number;
  sources?: SoftwareSource[];
  osFamilies?: OsFamily[];
  search?: string;
  hasVulns?: boolean;
  sortBy?: "name" | "host_count" | "vuln_count" | "latest_seen_at";
  sortDir?: "asc" | "desc";
}

export interface AggregatedSoftwareResult {
  data: AggregatedSoftware[];
  total: number;
}

interface HostMeta {
  host_id: number;
  ip: string;
  hostname: string | null;
  network_id: number | null;
  network_name: string | null;
  os_family: string | null;
}

function loadHostsMeta(hostIds: number[]): Map<number, HostMeta> {
  const map = new Map<number, HostMeta>();
  // A blocchi: la vista per host e la ricerca per nome chiedono tutti gli host con vulnerabilità.
  for (let i = 0; i < hostIds.length; i += 500) {
    const parte = hostIds.slice(i, i + 500);
    const placeholders = parte.map(() => "?").join(",");
    const rows = db()
      .prepare(
        `SELECT h.id AS host_id, h.ip,
                COALESCE(h.custom_name, h.hostname) AS hostname,
                h.network_id, n.name AS network_name, h.os_family
           FROM hosts h
           LEFT JOIN networks n ON n.id = h.network_id
          WHERE h.id IN (${placeholders})`
      )
      .all(...parte) as HostMeta[];
    for (const r of rows) map.set(r.host_id, r);
  }
  return map;
}

function compareSeverityRank(a: string, b: string): number {
  return (SEVERITY_RANK[b] ?? 0) - (SEVERITY_RANK[a] ?? 0);
}

function compareNullableNumber(a: number | null, b: number | null, dir: "asc" | "desc"): number {
  const av = a ?? -Infinity;
  const bv = b ?? -Infinity;
  return dir === "asc" ? av - bv : bv - av;
}

interface RawVulnRow {
  key: string;
  cve_id: string | null;
  nvt_oid: string | null;
  severity: string | null;
  cvss_score: number | null;
  package_label: string | null;
  host_id: number | null;
  ip: string;
  port: string | null;
  scanned_at: string;
  source: string;
}

/**
 * Le righe grezze di tutte le vulnerabilità del tenant (Edge + Wazuh), una per rilevamento:
 * la fonte comune della vista per CVE e di quella per host (22/10).
 */
function leggiRigheVuln(osFamilies?: OsFamily[]): RawVulnRow[] {
  // Filtro OS via SQL nativo (indice idx_hosts_os_family). Se attivo: JOIN
  // su hosts.os_family. Quando non c'è filtro evitiamo la join (più veloce).
  const osActive = !!(osFamilies && osFamilies.length > 0 && osFamilies.length < OS_FAMILIES.length);
  const osList = osActive ? osFamilies! : [];
  const osPlaceholders = osList.map(() => "?").join(",");
  const edgeOsJoin = osActive ? `JOIN hosts h ON h.id = f.host_id AND h.os_family IN (${osPlaceholders})` : "";
  const wazuhOsJoin = osActive ? `JOIN hosts h ON h.id = a.host_id AND h.os_family IN (${osPlaceholders})` : "";

  const baseSql = `
    SELECT
      COALESCE(f.cve_id, 'nvt:' || f.nvt_oid) AS key,
      f.cve_id,
      f.nvt_oid,
      f.severity,
      f.cvss_score,
      f.nvt_name AS package_label,
      f.host_id,
      f.ip,
      f.port,
      f.scanned_at,
      'Edge' AS source
    FROM vuln_findings f
    ${edgeOsJoin}
    WHERE f.severity IN ('Critical','High','Medium','Low')
      AND (f.cve_id IS NOT NULL OR f.nvt_oid IS NOT NULL)
    UNION ALL
    SELECT
      v.cve AS key,
      v.cve AS cve_id,
      NULL AS nvt_oid,
      v.severity,
      COALESCE(v.cvss3_score, v.cvss2_score) AS cvss_score,
      CASE WHEN v.package_name IS NULL THEN NULL
           ELSE v.package_name || COALESCE(' ' || v.package_version, '') END AS package_label,
      a.host_id,
      COALESCE(a.ip, '') AS ip,
      NULL AS port,
      COALESCE(v.detection_time, v.synced_at) AS scanned_at,
      'Wazuh' AS source
    FROM wazuh_vuln v
    JOIN wazuh_agent a ON a.agent_id = v.agent_id
    ${wazuhOsJoin}
    WHERE v.status = 'VALID'
      AND v.severity IN ('Critical','High','Medium','Low')
  `;

  const params = osActive ? [...osList, ...osList] : [];
  return db().prepare(baseSql).all(...params) as RawVulnRow[];
}

/** Vero se l'exploit passa il filtro: basta una delle condizioni scelte. */
function passaFiltroExploit(e: ExploitInfo | null, filtro: FiltroExploit[] | undefined): boolean {
  if (!filtro?.length) return true;
  if (!e) return false;
  return filtro.some((f) => (f === "kev" ? e.kev : e.edb > 0));
}

/** Le chiavi `h:<id>`/`ip:<ip>` degli host il cui IP o nome contiene `q` (già in minuscolo). */
function hostCheCorrispondono(rows: RawVulnRow[], q: string): Set<string> {
  const ids = [...new Set(rows.map((r) => r.host_id).filter((x): x is number => x != null))];
  const meta = loadHostsMeta(ids);
  const out = new Set<string>();
  for (const r of rows) {
    const m = r.host_id != null ? meta.get(r.host_id) : undefined;
    const ip = (m?.ip || r.ip || "").toLowerCase();
    if (ip.includes(q) || (m?.hostname ?? "").toLowerCase().includes(q)) out.add(chiaveHostVuln(r));
  }
  return out;
}

/** La chiave dell'host nella vista per host: l'id se l'host è agganciato, altrimenti l'IP. */
function chiaveHostVuln(r: { host_id: number | null; ip: string }): string {
  return r.host_id != null ? `h:${r.host_id}` : `ip:${r.ip}`;
}

export function getAggregatedVulnerabilities(opts: AggregatedVulnOpts): AggregatedVulnResult {
  const rows = leggiRigheVuln(opts.osFamilies);

  interface AggInternal extends AggregatedVuln {
    _hostKeys: Set<string>;
    _hostIds: Set<number>;
    _orphanCount: number;
    _firstHostHits: AggregatedVulnHostRef[];
  }
  const map = new Map<string, AggInternal>();

  for (const r of rows) {
    if (!r.key) continue;
    const sev = normalizeSeverity(r.severity);
    const hostKey = r.host_id != null ? `h:${r.host_id}` : `ip:${r.ip}:${r.source}`;
    let entry = map.get(r.key);
    if (!entry) {
      entry = {
        key: r.key,
        cve_id: r.cve_id,
        nvt_oid: r.nvt_oid,
        severity: sev,
        cvss_score: r.cvss_score,
        package_label: r.package_label,
        sources: [],
        host_count: 0,
        orphan_count: 0,
        hosts_preview: [],
        latest_scanned_at: r.scanned_at,
        exploit: null,
        _hostKeys: new Set(),
        _hostIds: new Set(),
        _orphanCount: 0,
        _firstHostHits: [],
      };
      map.set(r.key, entry);
    }
    entry.severity = maxSeverity(entry.severity, sev) as Severity;
    if (r.cvss_score != null && (entry.cvss_score == null || r.cvss_score > entry.cvss_score)) {
      entry.cvss_score = r.cvss_score;
    }
    if (!entry.package_label && r.package_label) entry.package_label = r.package_label;
    if (r.scanned_at > entry.latest_scanned_at) entry.latest_scanned_at = r.scanned_at;
    if (!entry.sources.includes(r.source)) entry.sources.push(r.source);
    if (!entry.cve_id && r.cve_id) entry.cve_id = r.cve_id;
    if (!entry.nvt_oid && r.nvt_oid) entry.nvt_oid = r.nvt_oid;

    if (!entry._hostKeys.has(hostKey)) {
      entry._hostKeys.add(hostKey);
      if (r.host_id != null) entry._hostIds.add(r.host_id);
      else entry._orphanCount += 1;
      if (entry._firstHostHits.length < 10) {
        entry._firstHostHits.push({
          host_id: r.host_id,
          ip: r.ip,
          hostname: null,
          network_id: null,
          network_name: null,
          severity: sev,
          cvss_score: r.cvss_score,
          source: r.source,
          package_label: r.package_label,
          scanned_at: r.scanned_at,
        });
      }
    }
  }

  for (const a of map.values()) {
    a.host_count = a._hostIds.size + a._orphanCount;
    a.orphan_count = a._orphanCount;
  }
  if (opts.exploitDi) {
    const info = opts.exploitDi([...map.values()].map((a) => a.cve_id).filter((c): c is string => !!c));
    for (const a of map.values()) a.exploit = (a.cve_id && info.get(a.cve_id)) || null;
  }

  let arr = [...map.values()];
  const severity_rollup = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  for (const a of arr) {
    if (a.severity in severity_rollup) severity_rollup[a.severity] += 1;
  }

  if (opts.severity?.length) {
    const set = new Set(opts.severity);
    arr = arr.filter((v) => set.has(v.severity));
  }
  if (opts.sources?.length) {
    const set = new Set(opts.sources);
    arr = arr.filter((v) => v.sources.some((s) => set.has(s)));
  }
  if (opts.hasCve === true) arr = arr.filter((v) => v.cve_id !== null);
  else if (opts.hasCve === false) arr = arr.filter((v) => v.cve_id === null);
  if (opts.exploit?.length) arr = arr.filter((v) => passaFiltroExploit(v.exploit, opts.exploit));
  if (opts.search) {
    const q = opts.search.toLowerCase();
    // Anche per IP e nome dell'host (22/10): una vulnerabilità passa se uno dei suoi host corrisponde.
    const hostOk = hostCheCorrispondono(rows, q);
    const chiaviPerHost = new Set(rows.filter((r) => hostOk.has(chiaveHostVuln(r))).map((r) => r.key));
    arr = arr.filter(
      (v) =>
        v.cve_id?.toLowerCase().includes(q) ||
        v.package_label?.toLowerCase().includes(q) ||
        v.nvt_oid?.toLowerCase().includes(q) ||
        chiaviPerHost.has(v.key)
    );
  }

  const sortBy = opts.sortBy ?? "severity";
  const sortDir = opts.sortDir ?? "desc";
  arr.sort((a, b) => {
    let cmp = 0;
    switch (sortBy) {
      case "cvss":
        cmp = compareNullableNumber(a.cvss_score, b.cvss_score, sortDir);
        if (cmp !== 0) return cmp;
        break;
      case "host_count":
        cmp = sortDir === "asc" ? a.host_count - b.host_count : b.host_count - a.host_count;
        if (cmp !== 0) return cmp;
        break;
      case "latest_scanned_at":
        cmp = sortDir === "asc"
          ? a.latest_scanned_at.localeCompare(b.latest_scanned_at)
          : b.latest_scanned_at.localeCompare(a.latest_scanned_at);
        if (cmp !== 0) return cmp;
        break;
      case "cve_id":
        cmp = sortDir === "asc"
          ? (a.cve_id ?? "zzz").localeCompare(b.cve_id ?? "zzz")
          : (b.cve_id ?? "zzz").localeCompare(a.cve_id ?? "zzz");
        if (cmp !== 0) return cmp;
        break;
      case "exploit":
        cmp = sortDir === "asc"
          ? rangoExploit(a.exploit) - rangoExploit(b.exploit)
          : rangoExploit(b.exploit) - rangoExploit(a.exploit);
        if (cmp !== 0) return cmp;
        cmp = compareSeverityRank(a.severity, b.severity);
        if (cmp !== 0) return cmp;
        break;
      case "severity":
      default:
        cmp = sortDir === "asc" ? -compareSeverityRank(a.severity, b.severity) : compareSeverityRank(a.severity, b.severity);
        if (cmp !== 0) return cmp;
        cmp = compareNullableNumber(a.cvss_score, b.cvss_score, "desc");
        if (cmp !== 0) return cmp;
        cmp = b.host_count - a.host_count;
        if (cmp !== 0) return cmp;
        break;
    }
    return a.key.localeCompare(b.key);
  });

  const total = arr.length;
  const start = (opts.page - 1) * opts.pageSize;
  const pageRows = arr.slice(start, start + opts.pageSize);

  const allHostIds = new Set<number>();
  for (const r of pageRows) for (const h of r._firstHostHits) if (h.host_id != null) allHostIds.add(h.host_id);
  const meta = loadHostsMeta([...allHostIds]);
  for (const r of pageRows) {
    r.hosts_preview = r._firstHostHits.map((h) => {
      const m = h.host_id != null ? meta.get(h.host_id) : undefined;
      return m
        ? { ...h, hostname: m.hostname, network_id: m.network_id, network_name: m.network_name, ip: m.ip || h.ip }
        : h;
    });
  }

  const data = pageRows.map(({ _hostKeys: _a, _hostIds: _b, _orphanCount: _c, _firstHostHits: _d, ...rest }) => {
    void _a; void _b; void _c; void _d;
    return rest;
  });

  return { data, total, severity_rollup };
}

export function getVulnHostsByKey(key: string, limit = 500): AggregatedVulnHostRef[] {
  const isNvt = key.startsWith("nvt:");
  const cveKey = isNvt ? null : key;
  const nvtKey = isNvt ? key.substring(4) : null;

  const edgeRows = db()
    .prepare(
      `SELECT f.host_id, f.ip, f.severity, f.cvss_score, f.scanned_at,
              f.nvt_name AS package_label,
              'Edge' AS source
         FROM vuln_findings f
        WHERE (
          (? IS NOT NULL AND f.cve_id = ?) OR
          (? IS NOT NULL AND f.nvt_oid = ? AND f.cve_id IS NULL)
        )
        AND f.severity IN ('Critical','High','Medium','Low')
        ORDER BY f.scanned_at DESC
        LIMIT ?`
    )
    .all(cveKey, cveKey, nvtKey, nvtKey, limit) as Array<{
      host_id: number | null; ip: string; severity: string; cvss_score: number | null;
      scanned_at: string; package_label: string | null; source: string;
    }>;

  const wazuhRows = isNvt
    ? []
    : (db()
        .prepare(
          `SELECT a.host_id, COALESCE(a.ip, '') AS ip, v.severity,
                  COALESCE(v.cvss3_score, v.cvss2_score) AS cvss_score,
                  COALESCE(v.detection_time, v.synced_at) AS scanned_at,
                  CASE WHEN v.package_name IS NULL THEN NULL
                       ELSE v.package_name || COALESCE(' ' || v.package_version, '') END AS package_label,
                  'Wazuh' AS source
             FROM wazuh_vuln v
             JOIN wazuh_agent a ON a.agent_id = v.agent_id
            WHERE v.cve = ?
              AND v.status = 'VALID'
              AND v.severity IN ('Critical','High','Medium','Low')
            ORDER BY scanned_at DESC
            LIMIT ?`
        )
        .all(cveKey, limit) as Array<{
          host_id: number | null; ip: string; severity: string; cvss_score: number | null;
          scanned_at: string; package_label: string | null; source: string;
        }>);

  const combined = [...edgeRows, ...wazuhRows];
  const ids = [...new Set(combined.map((r) => r.host_id).filter((x): x is number => x != null))];
  const meta = loadHostsMeta(ids);

  const seen = new Set<string>();
  const out: AggregatedVulnHostRef[] = [];
  for (const r of combined) {
    const k = `${r.host_id ?? "ip:" + r.ip}|${r.source}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const m = r.host_id != null ? meta.get(r.host_id) : undefined;
    out.push({
      host_id: r.host_id,
      ip: m?.ip || r.ip,
      hostname: m?.hostname ?? null,
      network_id: m?.network_id ?? null,
      network_name: m?.network_name ?? null,
      severity: normalizeSeverity(r.severity),
      cvss_score: r.cvss_score,
      source: r.source,
      package_label: r.package_label,
      scanned_at: r.scanned_at,
    });
  }
  return out;
}

// ── Vista per host (Riccardo, 22/10) ─────────────────────────────────────────
// Le stesse righe della vista per CVE, raggruppate per host: una CVE trovata su più porte
// dello stesso host conta una volta. Gli IP senza host agganciato restano, con chiave `ip:`.

export interface VulnHostRow {
  /** `h:<id>` o `ip:<ip>` (senza match nell'inventario). */
  host_key: string;
  host_id: number | null;
  ip: string;
  hostname: string | null;
  network_name: string | null;
  os_family: string | null;
  top_severity: Severity;
  counts: { Critical: number; High: number; Medium: number; Low: number };
  vuln_count: number;
  /** Vulnerabilità in CISA KEV (sfruttate attivamente). */
  kev_count: number;
  /** Vulnerabilità con almeno un exploit pubblico in Exploit-DB. */
  edb_count: number;
  epss_max: number | null;
  sources: string[];
  latest_scanned_at: string;
}

export interface VulnHostOpts {
  page: number;
  pageSize: number;
  severity?: Severity[];
  sources?: string[];
  osFamilies?: OsFamily[];
  search?: string;
  hasCve?: boolean;
  exploit?: FiltroExploit[];
  exploitDi?: ExploitDi;
  sortBy?: "severity" | "exploit" | "vuln_count" | "ip" | "latest_scanned_at";
  sortDir?: "asc" | "desc";
}

export interface VulnHostResult {
  data: VulnHostRow[];
  total: number;
  severity_rollup: { Critical: number; High: number; Medium: number; Low: number };
}

export interface VulnDiHost {
  key: string;
  cve_id: string | null;
  nvt_oid: string | null;
  severity: Severity;
  cvss_score: number | null;
  package_label: string | null;
  /** Porte distinte dove è stata trovata (vuoto per Wazuh). */
  ports: string[];
  sources: string[];
  scanned_at: string;
  exploit: ExploitInfo | null;
}

/** Ordina gli IPv4 per numero (192.168.1.9 prima di 192.168.1.10); il resto per testo. */
function confrontaIp(a: string, b: string): number {
  const na = a.split(".").map(Number);
  const nb = b.split(".").map(Number);
  if (na.length === 4 && nb.length === 4 && na.every(Number.isFinite) && nb.every(Number.isFinite)) {
    for (let i = 0; i < 4; i++) if (na[i] !== nb[i]) return na[i]! - nb[i]!;
    return 0;
  }
  return a.localeCompare(b);
}

/** Una vulnerabilità per chiave, su un insieme di righe dello stesso host. */
function vulnDistinte(rows: RawVulnRow[], info: Map<string, ExploitInfo>): VulnDiHost[] {
  const per = new Map<string, VulnDiHost>();
  for (const r of rows) {
    const sev = normalizeSeverity(r.severity);
    let v = per.get(r.key);
    if (!v) {
      v = {
        key: r.key, cve_id: r.cve_id, nvt_oid: r.nvt_oid, severity: sev, cvss_score: r.cvss_score,
        package_label: r.package_label, ports: [], sources: [], scanned_at: r.scanned_at,
        exploit: (r.cve_id && info.get(r.cve_id)) || null,
      };
      per.set(r.key, v);
    }
    v.severity = maxSeverity(v.severity, sev) as Severity;
    if (r.cvss_score != null && (v.cvss_score == null || r.cvss_score > v.cvss_score)) v.cvss_score = r.cvss_score;
    if (!v.package_label && r.package_label) v.package_label = r.package_label;
    if (r.port && !v.ports.includes(r.port)) v.ports.push(r.port);
    if (!v.sources.includes(r.source)) v.sources.push(r.source);
    if (r.scanned_at > v.scanned_at) v.scanned_at = r.scanned_at;
  }
  return [...per.values()];
}

function infoExploit(rows: RawVulnRow[], exploitDi: ExploitDi | undefined): Map<string, ExploitInfo> {
  if (!exploitDi) return new Map();
  return exploitDi([...new Set(rows.map((r) => r.cve_id).filter((c): c is string => !!c))]);
}

export function getVulnerabilitiesByHost(opts: VulnHostOpts): VulnHostResult {
  const rows = leggiRigheVuln(opts.osFamilies);
  const info = infoExploit(rows, opts.exploitDi);

  // Il riepilogo in testa resta quello delle vulnerabilità distinte, come nella vista per CVE.
  const severity_rollup = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  const sevPerChiave = new Map<string, Severity>();
  for (const r of rows) {
    if (!r.key) continue;
    sevPerChiave.set(r.key, maxSeverity(sevPerChiave.get(r.key) ?? "Low", normalizeSeverity(r.severity)) as Severity);
  }
  for (const sev of sevPerChiave.values()) severity_rollup[sev] += 1;

  const sevSet = opts.severity?.length ? new Set(opts.severity) : null;
  const srcSet = opts.sources?.length ? new Set(opts.sources) : null;
  const q = opts.search?.toLowerCase() ?? "";
  const hostOk = q ? hostCheCorrispondono(rows, q) : null;

  const filtrate = rows.filter((r) => {
    if (!r.key) return false;
    if (sevSet && !sevSet.has(normalizeSeverity(r.severity))) return false;
    if (srcSet && !srcSet.has(r.source)) return false;
    if (opts.hasCve === true && !r.cve_id) return false;
    if (opts.hasCve === false && r.cve_id) return false;
    if (!passaFiltroExploit((r.cve_id && info.get(r.cve_id)) || null, opts.exploit)) return false;
    if (q) {
      const suVuln =
        r.cve_id?.toLowerCase().includes(q) ||
        r.package_label?.toLowerCase().includes(q) ||
        r.nvt_oid?.toLowerCase().includes(q);
      if (!suVuln && !hostOk!.has(chiaveHostVuln(r))) return false;
    }
    return true;
  });

  const perHost = new Map<string, RawVulnRow[]>();
  for (const r of filtrate) {
    const k = chiaveHostVuln(r);
    const l = perHost.get(k);
    if (l) l.push(r);
    else perHost.set(k, [r]);
  }

  const ids = [...new Set(filtrate.map((r) => r.host_id).filter((x): x is number => x != null))];
  const meta = loadHostsMeta(ids);

  let arr: VulnHostRow[] = [...perHost.entries()].map(([host_key, rs]) => {
    const vulns = vulnDistinte(rs, info);
    const counts = { Critical: 0, High: 0, Medium: 0, Low: 0 };
    let top: Severity = "Low";
    let kev = 0;
    let edb = 0;
    let epss: number | null = null;
    for (const v of vulns) {
      counts[v.severity] += 1;
      top = maxSeverity(top, v.severity) as Severity;
      if (v.exploit?.kev) kev += 1;
      if ((v.exploit?.edb ?? 0) > 0) edb += 1;
      if (v.exploit?.epss != null && (epss == null || v.exploit.epss > epss)) epss = v.exploit.epss;
    }
    const sources = [...new Set(rs.map((r) => r.source))];
    const latest = rs.reduce((acc, r) => (r.scanned_at > acc ? r.scanned_at : acc), rs[0]!.scanned_at);
    const hostId = rs[0]!.host_id;
    const m = hostId != null ? meta.get(hostId) : undefined;
    return {
      host_key, host_id: hostId, ip: m?.ip || rs[0]!.ip, hostname: m?.hostname ?? null,
      network_name: m?.network_name ?? null, os_family: m?.os_family ?? null,
      top_severity: top, counts, vuln_count: vulns.length, kev_count: kev, edb_count: edb, epss_max: epss,
      sources, latest_scanned_at: latest,
    };
  });

  const sortBy = opts.sortBy ?? "severity";
  const dir = opts.sortDir === "asc" ? -1 : 1;
  const perGravita = (a: VulnHostRow, b: VulnHostRow) =>
    compareSeverityRank(a.top_severity, b.top_severity) ||
    b.counts.Critical - a.counts.Critical ||
    b.counts.High - a.counts.High ||
    b.counts.Medium - a.counts.Medium ||
    b.counts.Low - a.counts.Low;
  const perExploit = (a: VulnHostRow, b: VulnHostRow) =>
    b.kev_count - a.kev_count || b.edb_count - a.edb_count || (b.epss_max ?? -1) - (a.epss_max ?? -1);
  arr.sort((a, b) => {
    let cmp = 0;
    switch (sortBy) {
      case "exploit":
        cmp = dir * perExploit(a, b) || perGravita(a, b);
        break;
      case "vuln_count":
        cmp = dir * (b.vuln_count - a.vuln_count) || perGravita(a, b);
        break;
      case "ip":
        cmp = -dir * confrontaIp(a.ip, b.ip);
        break;
      case "latest_scanned_at":
        cmp = dir * b.latest_scanned_at.localeCompare(a.latest_scanned_at);
        break;
      case "severity":
      default:
        cmp = dir * perGravita(a, b) || perExploit(a, b);
        break;
    }
    return cmp || confrontaIp(a.ip, b.ip);
  });

  const total = arr.length;
  const start = (opts.page - 1) * opts.pageSize;
  arr = arr.slice(start, start + opts.pageSize);
  return { data: arr, total, severity_rollup };
}

/**
 * Tutte le vulnerabilità di un host (`h:<id>` o `ip:<ip>`), senza filtri: le sfruttate in
 * cima, poi quelle con exploit pubblico, poi per gravità e CVSS. Null = chiave non valida.
 */
export function getVulnerabilitiesOfHost(hostKey: string, exploitDi?: ExploitDi): VulnDiHost[] | null {
  let filtro: (r: RawVulnRow) => boolean;
  if (/^h:\d+$/.test(hostKey)) {
    const id = Number(hostKey.slice(2));
    filtro = (r) => r.host_id === id;
  } else if (hostKey.startsWith("ip:") && hostKey.length > 3) {
    const ip = hostKey.slice(3);
    filtro = (r) => r.host_id == null && r.ip === ip;
  } else return null;
  const rows = leggiRigheVuln().filter((r) => r.key && filtro(r));
  return vulnDistinte(rows, infoExploit(rows, exploitDi)).sort(
    (a, b) =>
      rangoExploit(b.exploit) - rangoExploit(a.exploit) ||
      compareSeverityRank(a.severity, b.severity) ||
      (b.cvss_score ?? -1) - (a.cvss_score ?? -1) ||
      a.key.localeCompare(b.key),
  );
}

interface RawSoftwareRow {
  key: string;
  name: string;
  version: string | null;
  publisher: string | null;
  host_id: number | null;
  ip: string;
  install_date: string | null;
  scanned_at: string | null;
  source: SoftwareSource;
}

/**
 * Chiave di aggregazione software: SOLO il nome (lowercase). Le versioni
 * confluiscono dentro la stessa riga, esposte come sotto-categoria
 * `versions: AggregatedSoftwareVersion[]`. Riduce drasticamente il numero
 * di righe in tabella.
 */
function softwareKeyOf(name: string): string {
  return name.toLowerCase();
}

function invAgentSoftwareTableExists(): boolean {
  const row = db()
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'inv_agent_software'")
    .get() as { ok: number } | undefined;
  return row?.ok === 1;
}

function fetchInvAgentSoftwareRows(
  osActive: boolean,
  osList: OsFamily[],
): Array<{
  name: string;
  version: string | null;
  publisher: string | null;
  host_id: number;
  ip: string;
  install_date: string | null;
  scanned_at: string | null;
  source: SoftwareSource;
}> {
  if (!invAgentSoftwareTableExists()) return [];
  const osPlaceholders = osList.map(() => "?").join(",");
  const agentOsClause = osActive ? `AND h.os_family IN (${osPlaceholders})` : "";
  return db()
    .prepare(
      `SELECT sw.name, sw.version, sw.publisher,
              e.host_id, COALESCE(h.ip, e.primary_ip, '') AS ip,
              sw.install_date,
              r.received_at AS scanned_at,
              'Agent' AS source
         FROM inv_agent_software sw
         JOIN inv_agent_report r ON r.id = sw.report_id
         JOIN inv_agent_endpoint e ON e.device_id = r.device_id AND e.last_report_id = r.id
         JOIN hosts h ON h.id = e.host_id
        WHERE e.host_id IS NOT NULL
          AND sw.name IS NOT NULL AND TRIM(sw.name) != ''
          ${agentOsClause}`,
    )
    .all(...(osActive ? osList : [])) as Array<{
      name: string;
      version: string | null;
      publisher: string | null;
      host_id: number;
      ip: string;
      install_date: string | null;
      scanned_at: string | null;
      source: SoftwareSource;
    }>;
}

export function getAggregatedSoftware(opts: AggregatedSoftwareOpts): AggregatedSoftwareResult {
  // Filtro OS via SQL nativo (indice idx_hosts_os_family). Quando attivo:
  // - wazuh: aggiunge JOIN hosts h ON h.id = a.host_id AND h.os_family IN (...)
  // - probe: aggiunge condizione sulla CTE effective (host già joinato come h)
  const osActive = !!(opts.osFamilies && opts.osFamilies.length > 0 && opts.osFamilies.length < OS_FAMILIES.length);
  const osList = osActive ? opts.osFamilies! : [];
  const osPlaceholders = osList.map(() => "?").join(",");
  const wazuhOsJoin = osActive ? `JOIN hosts h ON h.id = a.host_id AND h.os_family IN (${osPlaceholders})` : "";
  const probeOsClause = osActive ? `AND h.os_family IN (${osPlaceholders})` : "";

  const wazuhRows = db()
    .prepare(
      `SELECT w.name, w.version, w.vendor AS publisher,
              a.host_id, COALESCE(a.ip, '') AS ip,
              w.install_time AS install_date,
              w.scan_time AS scanned_at,
              'Wazuh' AS source
         FROM wazuh_software w
         JOIN wazuh_agent a ON a.agent_id = w.agent_id
         ${wazuhOsJoin}
        WHERE a.host_id IS NOT NULL
          AND w.name IS NOT NULL AND TRIM(w.name) != ''`
    )
    .all(...(osActive ? osList : [])) as Array<{
      name: string; version: string | null; publisher: string | null;
      host_id: number; ip: string; install_date: string | null;
      scanned_at: string | null; source: SoftwareSource;
    }>;

  // Probe scans: includere sia scan linkati a host_id direttamente sia scan
  // linkati a un network_device (host_id NULL ma device_id NOT NULL) — il
  // mapping device→host avviene via hosts.ip = network_devices.host.
  // Per ogni host prendiamo l'ULTIMO scan ok (sia host-linked che device-linked).
  const probeRows = db()
    .prepare(
      `WITH effective AS (
         SELECT sc.id AS scan_id,
                COALESCE(sc.host_id, h2.id) AS host_id,
                sc.started_at
           FROM software_scans sc
           LEFT JOIN network_devices nd ON nd.id = sc.device_id
           LEFT JOIN hosts h2 ON h2.ip = nd.host
          WHERE sc.status = 'ok'
            AND COALESCE(sc.host_id, h2.id) IS NOT NULL
       ),
       latest AS (
         SELECT host_id, MAX(scan_id) AS scan_id FROM effective GROUP BY host_id
       )
       SELECT si.name, si.version, si.publisher,
              latest.host_id, h.ip,
              si.install_date,
              sc.started_at AS scanned_at,
              'Probe' AS source
         FROM latest
         JOIN software_inventory si ON si.scan_id = latest.scan_id
         JOIN software_scans sc ON sc.id = latest.scan_id
         JOIN hosts h ON h.id = latest.host_id
        WHERE si.name IS NOT NULL AND TRIM(si.name) != ''
          ${probeOsClause}`
    )
    .all(...(osActive ? osList : [])) as Array<{
      name: string; version: string | null; publisher: string | null;
      host_id: number; ip: string; install_date: string | null;
      scanned_at: string | null; source: SoftwareSource;
    }>;

  const agentRows = fetchInvAgentSoftwareRows(osActive, osList);

  const all: RawSoftwareRow[] = [
    ...wazuhRows.map((r) => ({ ...r, key: softwareKeyOf(r.name) })),
    ...probeRows.map((r) => ({ ...r, key: softwareKeyOf(r.name) })),
    ...agentRows.map((r) => ({ ...r, key: softwareKeyOf(r.name) })),
  ];

  interface AggInternal extends AggregatedSoftware {
    _hostMap: Map<number, { sources: Set<SoftwareSource>; publisher: string | null; install_date: string | null; scanned_at: string | null; ip: string }>;
    _versions: Map<string, { hostIds: Set<number>; latest_seen_at: string | null }>;
  }
  const map = new Map<string, AggInternal>();

  for (const r of all) {
    let entry = map.get(r.key);
    if (!entry) {
      entry = {
        key: r.key,
        name: r.name,
        publisher: r.publisher,
        sources: [],
        host_count: 0,
        hosts_preview: [],
        vuln_count: 0,
        latest_seen_at: r.scanned_at,
        versions: [],
        _hostMap: new Map(),
        _versions: new Map(),
      };
      map.set(r.key, entry);
    }
    if (!entry.sources.includes(r.source)) entry.sources.push(r.source);
    if (r.publisher) {
      if (r.source === "Probe" || r.source === "Agent") entry.publisher = r.publisher;
      else if (!entry.publisher && r.source === "Wazuh") entry.publisher = r.publisher;
    }
    if (r.scanned_at && (!entry.latest_seen_at || r.scanned_at > entry.latest_seen_at)) {
      entry.latest_seen_at = r.scanned_at;
    }
    // Sotto-categoria versioni: per ogni (name, version) traccio gli host distinti
    // e l'ultimo scan. version=NULL diventa chiave "" (= "versione non rilevata").
    const verKey = r.version ?? "";
    let v = entry._versions.get(verKey);
    if (!v) {
      v = { hostIds: new Set(), latest_seen_at: null };
      entry._versions.set(verKey, v);
    }
    if (r.host_id != null) v.hostIds.add(r.host_id);
    if (r.scanned_at && (!v.latest_seen_at || r.scanned_at > v.latest_seen_at)) {
      v.latest_seen_at = r.scanned_at;
    }
    if (r.host_id != null) {
      let h = entry._hostMap.get(r.host_id);
      if (!h) {
        h = { sources: new Set(), publisher: null, install_date: null, scanned_at: null, ip: r.ip };
        entry._hostMap.set(r.host_id, h);
      }
      h.sources.add(r.source);
      if (r.publisher && (!h.publisher || r.source === "Probe" || r.source === "Agent")) {
        h.publisher = r.publisher;
      }
      if (r.install_date && !h.install_date) h.install_date = r.install_date;
      if (r.scanned_at && (!h.scanned_at || r.scanned_at > h.scanned_at)) h.scanned_at = r.scanned_at;
      if (r.ip && !h.ip) h.ip = r.ip;
    }
  }

  let arr = [...map.values()];
  for (const a of arr) {
    a.host_count = a._hostMap.size;
    // Ordina versioni desc (versioni "vuote" in coda). Gli `hosts` per versione
    // vengono popolati più sotto, dopo aver caricato la meta degli host della pagina.
    a.versions = [...a._versions.entries()]
      .map(([ver, v]) => ({
        version: ver === "" ? null : ver,
        host_count: v.hostIds.size,
        latest_seen_at: v.latest_seen_at,
        hosts: [] as AggregatedSoftwareVersionHost[],
      }))
      .sort((x, y) => {
        if (x.version === null) return 1;
        if (y.version === null) return -1;
        return y.version.localeCompare(x.version, undefined, { numeric: true, sensitivity: "base" });
      });
  }

  const needsVuln = opts.sortBy === "vuln_count" || opts.hasVulns !== undefined || arr.length <= 2000;
  if (needsVuln) computeVulnCounts(arr);

  if (opts.sources?.length) {
    const set = new Set(opts.sources);
    arr = arr.filter((s) => s.sources.some((src) => set.has(src)));
  }
  if (opts.hasVulns === true) arr = arr.filter((s) => s.vuln_count > 0);
  else if (opts.hasVulns === false) arr = arr.filter((s) => s.vuln_count === 0);
  if (opts.search) {
    const q = opts.search.toLowerCase();
    arr = arr.filter(
      (s) => s.name.toLowerCase().includes(q) || s.publisher?.toLowerCase().includes(q)
    );
  }

  const sortBy = opts.sortBy ?? "host_count";
  const sortDir = opts.sortDir ?? "desc";
  arr.sort((a, b) => {
    let cmp = 0;
    switch (sortBy) {
      case "name":
        cmp = sortDir === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
        break;
      case "vuln_count":
        cmp = sortDir === "asc" ? a.vuln_count - b.vuln_count : b.vuln_count - a.vuln_count;
        break;
      case "latest_seen_at":
        cmp = sortDir === "asc"
          ? (a.latest_seen_at ?? "").localeCompare(b.latest_seen_at ?? "")
          : (b.latest_seen_at ?? "").localeCompare(a.latest_seen_at ?? "");
        break;
      case "host_count":
      default:
        cmp = sortDir === "asc" ? a.host_count - b.host_count : b.host_count - a.host_count;
        break;
    }
    if (cmp !== 0) return cmp;
    return a.name.localeCompare(b.name);
  });

  const total = arr.length;
  const start = (opts.page - 1) * opts.pageSize;
  const pageRows = arr.slice(start, start + opts.pageSize);

  const allHostIds = new Set<number>();
  for (const p of pageRows) {
    for (const id of p._hostMap.keys()) allHostIds.add(id);
    for (const v of p._versions.values()) for (const id of v.hostIds) allHostIds.add(id);
  }
  const meta = loadHostsMeta([...allHostIds]);
  for (const p of pageRows) {
    const entries = [...p._hostMap.entries()].slice(0, 10);
    p.hosts_preview = entries.map(([host_id, h]) => {
      const m = meta.get(host_id);
      return {
        host_id,
        ip: m?.ip || h.ip,
        hostname: m?.hostname ?? null,
        network_id: m?.network_id ?? null,
        network_name: m?.network_name ?? null,
        sources: [...h.sources],
        publisher: h.publisher,
        install_date: h.install_date,
        scanned_at: h.scanned_at,
        version: null,  // preview aggregato per host; per dettaglio (host+versione) usare il drill-down
      };
    });
    // Popola gli `hosts` per ogni versione (ordinati per hostname)
    for (const ver of p.versions) {
      const verData = p._versions.get(ver.version ?? "");
      if (!verData) continue;
      ver.hosts = [...verData.hostIds]
        .map((host_id) => {
          const m = meta.get(host_id);
          return {
            host_id,
            ip: m?.ip ?? "",
            hostname: m?.hostname ?? null,
          };
        })
        .sort((a, b) => (a.hostname ?? a.ip).localeCompare(b.hostname ?? b.ip));
    }
  }

  const data = pageRows.map(({ _hostMap: _hm, _versions: _v, ...rest }) => {
    void _hm; void _v;
    return rest;
  });
  return { data, total };
}

/**
 * Conta CVE per ogni software. UNA SOLA query batch (no N+1).
 *
 * Sorgente: solo wazuh_vuln. La match Greenbone via LIKE '%name%' su
 * nvt_name è stata rimossa: era N+1 con full table scan e imprecisa
 * (matcha 'Mozilla' su 'Mozilla Firefox' anche per altri pacchetti che
 * contengono 'Mozilla'). Per il count CVE preciso usare la pagina
 * /vulnerabilities, dove la dedup avviene a livello CVE non package_name.
 */
function computeVulnCounts(items: AggregatedSoftware[]): void {
  if (items.length === 0) return;
  const names = [...new Set(items.map((i) => i.name.toLowerCase()))];
  if (names.length === 0) return;
  const placeholders = names.map(() => "?").join(",");
  const rows = db()
    .prepare(
      `SELECT LOWER(package_name) AS pkg, COUNT(DISTINCT cve) AS n
         FROM wazuh_vuln
        WHERE LOWER(package_name) IN (${placeholders})
          AND status = 'VALID'
        GROUP BY LOWER(package_name)`
    )
    .all(...names) as Array<{ pkg: string; n: number }>;
  const counts = new Map(rows.map((r) => [r.pkg, r.n]));
  for (const item of items) {
    item.vuln_count = counts.get(item.name.toLowerCase()) ?? 0;
  }
}

export function getSoftwareHostsByKey(key: string, limit = 500): AggregatedSoftwareHostRef[] {
  // key = lowercase(name) — aggregato sul nome qualsiasi versione.
  // Retro-compat: se key contiene "|version" lo ignoriamo e prendiamo solo il nome.
  const nameLower = key.split("|")[0];
  if (!nameLower) return [];

  const wazuhRows = db()
    .prepare(
      `SELECT a.host_id, COALESCE(a.ip, '') AS ip,
              w.vendor AS publisher,
              w.install_time AS install_date,
              w.scan_time AS scanned_at,
              w.version AS version,
              'Wazuh' AS source
         FROM wazuh_software w
         JOIN wazuh_agent a ON a.agent_id = w.agent_id
        WHERE a.host_id IS NOT NULL
          AND LOWER(w.name) = ?
        LIMIT ?`
    )
    .all(nameLower, limit) as Array<{
      host_id: number; ip: string; publisher: string | null;
      install_date: string | null; scanned_at: string | null; version: string | null; source: SoftwareSource;
    }>;

  // Probe: include scan host-linked + device-linked (device_id → hosts via IP)
  const probeRows = db()
    .prepare(
      `WITH effective AS (
         SELECT sc.id AS scan_id,
                COALESCE(sc.host_id, h2.id) AS host_id,
                sc.started_at
           FROM software_scans sc
           LEFT JOIN network_devices nd ON nd.id = sc.device_id
           LEFT JOIN hosts h2 ON h2.ip = nd.host
          WHERE sc.status = 'ok'
            AND COALESCE(sc.host_id, h2.id) IS NOT NULL
       ),
       latest AS (
         SELECT host_id, MAX(scan_id) AS scan_id FROM effective GROUP BY host_id
       )
       SELECT latest.host_id, h.ip,
              si.publisher,
              si.install_date,
              sc.started_at AS scanned_at,
              si.version AS version,
              'Probe' AS source
         FROM latest
         JOIN software_inventory si ON si.scan_id = latest.scan_id
         JOIN software_scans sc ON sc.id = latest.scan_id
         JOIN hosts h ON h.id = latest.host_id
        WHERE LOWER(si.name) = ?
        LIMIT ?`
    )
    .all(nameLower, limit) as Array<{
      host_id: number; ip: string; publisher: string | null;
      install_date: string | null; scanned_at: string | null; version: string | null; source: SoftwareSource;
    }>;

  let agentRows: typeof wazuhRows = [];
  if (invAgentSoftwareTableExists()) {
    agentRows = db()
      .prepare(
        `SELECT e.host_id, COALESCE(h.ip, e.primary_ip, '') AS ip,
                sw.publisher,
                sw.install_date,
                r.received_at AS scanned_at,
                sw.version AS version,
                'Agent' AS source
           FROM inv_agent_software sw
           JOIN inv_agent_report r ON r.id = sw.report_id
           JOIN inv_agent_endpoint e ON e.device_id = r.device_id AND e.last_report_id = r.id
           JOIN hosts h ON h.id = e.host_id
          WHERE e.host_id IS NOT NULL
            AND LOWER(sw.name) = ?
          LIMIT ?`,
      )
      .all(nameLower, limit) as typeof wazuhRows;
  }

  const merged = [...wazuhRows, ...probeRows, ...agentRows];
  const ids = [...new Set(merged.map((r) => r.host_id))];
  const meta = loadHostsMeta(ids);

  // Chiave (host_id, version) — un host può avere più versioni dello stesso software.
  const byHostVer = new Map<string, AggregatedSoftwareHostRef>();
  for (const r of merged) {
    const ver = r.version ?? null;
    const k = `${r.host_id}|${ver ?? ""}`;
    let h = byHostVer.get(k);
    if (!h) {
      const m = meta.get(r.host_id);
      h = {
        host_id: r.host_id,
        ip: m?.ip || r.ip,
        hostname: m?.hostname ?? null,
        network_id: m?.network_id ?? null,
        network_name: m?.network_name ?? null,
        sources: [],
        publisher: null,
        install_date: null,
        scanned_at: null,
        version: ver,
      };
      byHostVer.set(k, h);
    }
    if (!h.sources.includes(r.source)) h.sources.push(r.source);
    if (r.publisher && (!h.publisher || r.source === "Probe" || r.source === "Agent")) {
      h.publisher = r.publisher;
    }
    if (r.install_date && !h.install_date) h.install_date = r.install_date;
    if (r.scanned_at && (!h.scanned_at || r.scanned_at > h.scanned_at)) h.scanned_at = r.scanned_at;
  }
  // Ordino per hostname/IP poi versione desc
  return [...byHostVer.values()]
    .sort((a, b) => {
      const an = (a.hostname ?? a.ip).toLowerCase();
      const bn = (b.hostname ?? b.ip).toLowerCase();
      if (an !== bn) return an.localeCompare(bn);
      return (b.version ?? "").localeCompare(a.version ?? "", undefined, { numeric: true });
    })
    .slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════════════
// CUSTOM CLASSIFICATIONS (v0.2.632)
// Tabella tenant `device_classifications_custom`: sotto-categorie utente di
// classification built-in. Eredita icona/macro-categoria dal parent_slug.
// Lo slug è PK immutabile — referenziato da hosts.classification.
// ═══════════════════════════════════════════════════════════════════════════

export interface CustomClassificationRow {
  slug: string;
  label: string;
  parent_slug: string;
  created_at: string;
  updated_at: string;
}

export function listCustomClassifications(): CustomClassificationRow[] {
  return db()
    .prepare("SELECT slug, label, parent_slug, created_at, updated_at FROM device_classifications_custom ORDER BY label COLLATE NOCASE")
    .all() as CustomClassificationRow[];
}

export function getCustomClassificationBySlug(slug: string): CustomClassificationRow | undefined {
  return db()
    .prepare("SELECT slug, label, parent_slug, created_at, updated_at FROM device_classifications_custom WHERE slug = ?")
    .get(slug) as CustomClassificationRow | undefined;
}

export function createCustomClassification(input: { slug: string; label: string; parent_slug: string }): CustomClassificationRow {
  db()
    .prepare("INSERT INTO device_classifications_custom (slug, label, parent_slug) VALUES (?, ?, ?)")
    .run(input.slug, input.label, input.parent_slug);
  const row = getCustomClassificationBySlug(input.slug);
  if (!row) throw new Error("createCustomClassification: row not found after insert");
  return row;
}

export function updateCustomClassification(slug: string, patch: { label?: string; parent_slug?: string }): CustomClassificationRow | undefined {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.label !== undefined) { sets.push("label = ?"); params.push(patch.label); }
  if (patch.parent_slug !== undefined) { sets.push("parent_slug = ?"); params.push(patch.parent_slug); }
  if (sets.length === 0) return getCustomClassificationBySlug(slug);
  sets.push("updated_at = datetime('now')");
  params.push(slug);
  db().prepare(`UPDATE device_classifications_custom SET ${sets.join(", ")} WHERE slug = ?`).run(...params);
  return getCustomClassificationBySlug(slug);
}

/** Conta host + network_devices che referenziano una classification (custom o built-in).
 *  Usata per validare DELETE custom: blocca se ci sono ancora row che la referenziano. */
export function countHostsByClassification(classification: string): number {
  const hostRow = db()
    .prepare("SELECT COUNT(*) AS n FROM hosts WHERE classification = ?")
    .get(classification) as { n: number };
  const devRow = db()
    .prepare("SELECT COUNT(*) AS n FROM network_devices WHERE classification = ?")
    .get(classification) as { n: number };
  return hostRow.n + devRow.n;
}

export function deleteCustomClassification(slug: string): void {
  db().prepare("DELETE FROM device_classifications_custom WHERE slug = ?").run(slug);
}

// ─── Topologia: posizioni salvate + dati per la mappa ────────────────────────

export function getTopologyPositions(view: string): import("@/lib/topology/types").SavedPosition[] {
  const rows = db()
    .prepare("SELECT node_id, x, y, pinned FROM topology_position WHERE view = ?")
    .all(view) as Array<{ node_id: string; x: number; y: number; pinned: number }>;
  return rows.map((r) => ({ nodeId: r.node_id, x: r.x, y: r.y, pinned: r.pinned === 1 }));
}

export function upsertTopologyPositions(
  view: string,
  rows: import("@/lib/topology/types").SavedPosition[],
): void {
  const d = db();
  const ins = d.prepare(`
    INSERT INTO topology_position (view, node_id, x, y, pinned, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(view, node_id) DO UPDATE SET
      x = excluded.x, y = excluded.y, pinned = excluded.pinned, updated_at = datetime('now')
  `);
  d.transaction(() => {
    for (const r of rows) ins.run(view, r.nodeId, r.x, r.y, r.pinned ? 1 : 0);
  })();
}

export function getTopologyData(): {
  devices: import("@/lib/topology/types").DeviceRow[];
  hosts: import("@/lib/topology/types").HostRow[];
  neighbors: import("@/lib/topology/types").NeighborRow[];
  portsDown: Set<number>;
  libreStatus: Map<string, number>;
  anomalyBySeverity: Map<string, "low" | "medium" | "high">;
} {
  const d = db();
  const tableExists = (name: string): boolean =>
    !!d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

  const devices = d
    .prepare("SELECT id, name, device_type, model, host, enabled FROM network_devices")
    .all() as import("@/lib/topology/types").DeviceRow[];
  const hosts = d
    .prepare(
      "SELECT id, ip, hostname, custom_name, classification, status, last_response_time_ms, last_seen, model, network_id FROM hosts",
    )
    .all() as import("@/lib/topology/types").HostRow[];
  const neighbors = d
    .prepare(
      // Vecchia mappa /topology: solo l'ultimo giro per apparato e fonte (ADR 0008).
      `SELECT dn.device_id, dn.local_port, dn.remote_device_name, dn.remote_port, dn.protocol, dn.remote_ip
         FROM device_neighbors dn WHERE ${NEIGHBORS_LATEST_ROUND_SQL}`,
    )
    .all() as import("@/lib/topology/types").NeighborRow[];

  const downRows = d
    .prepare(
      "SELECT DISTINCT device_id FROM switch_ports WHERE status = 'down' AND trunk_neighbor_name IS NOT NULL AND trunk_neighbor_name <> ''",
    )
    .all() as Array<{ device_id: number }>;
  const portsDown = new Set(downRows.map((r) => r.device_id));

  const libreStatus = new Map<string, number>();
  if (tableExists("librenms_host_map")) {
    const libre = d
      .prepare("SELECT network_id, host_ip, last_status FROM librenms_host_map")
      .all() as Array<{ network_id: number; host_ip: string; last_status: string | null }>;
    for (const l of libre) {
      const v = libreStatusFrom(l.last_status);
      if (v !== null) libreStatus.set(`${l.network_id}|${l.host_ip}`, v);
    }
  }

  const anomalyBySeverity = new Map<string, "low" | "medium" | "high">();
  if (tableExists("anomaly_events")) {
    const anomalies = d
      .prepare("SELECT host_id, severity FROM anomaly_events WHERE acknowledged = 0 AND host_id IS NOT NULL")
      .all() as Array<{ host_id: number; severity: "low" | "medium" | "high" }>;
    const rank = { low: 1, medium: 2, high: 3 } as const;
    for (const a of anomalies) {
      const k = `host:${a.host_id}`;
      const cur = anomalyBySeverity.get(k);
      if (!cur || rank[a.severity] > rank[cur]) anomalyBySeverity.set(k, a.severity);
    }
  }

  return { devices, hosts, neighbors, portsDown, libreStatus, anomalyBySeverity };
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTROLLER DI RETE (ADR 0007) — network_controllers, network_controller_runs
// e le loro pianificazioni (scheduled_jobs di tipo unifi_sync con
// config.controller_id). La logica (segreti, pin, sincronizzazione) sta in
// src/lib/controllers/; qui solo letture e scritture.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Letture di un controller tenute nello storico, PER TIPO (apparati / client):
 * le più vecchie si potano a ogni scrittura. Per tipo perché i client si
 * leggono ogni ora: in tre giorni avrebbero spinto fuori ogni lettura degli apparati.
 */
export const CONTROLLER_RUNS_KEPT = 50;

/** Tipo di un giro dalla colonna `trigger` (i giri dei client hanno il prefisso «client:»). */
const RUN_KIND_SQL = "CASE WHEN trigger LIKE 'client:%' THEN 'client' ELSE 'apparati' END";

export function controllerRunKindOf(trigger: string): ControllerRunKind {
  return trigger.startsWith("client:") ? "client" : "apparati";
}

/** Il job unifi_sync è quello dei client (`config.cosa = "client"`); senza `cosa` è degli apparati. */
const CLIENT_JOB_SQL = "json_extract(COALESCE(NULLIF(config, ''), '{}'), '$.cosa') = 'client'";
const DEVICE_JOB_SQL = `COALESCE(json_extract(COALESCE(NULLIF(config, ''), '{}'), '$.cosa'), 'apparati') = 'apparati'`;

export function listNetworkControllers(): NetworkControllerRow[] {
  return db().prepare("SELECT * FROM network_controllers ORDER BY name COLLATE NOCASE, id").all() as NetworkControllerRow[];
}

export function getNetworkController(id: number): NetworkControllerRow | undefined {
  return db().prepare("SELECT * FROM network_controllers WHERE id = ?").get(id) as NetworkControllerRow | undefined;
}

export type NetworkControllerInsert = Pick<
  NetworkControllerRow,
  "name" | "vendor" | "kind" | "url" | "site" | "username" | "password_enc" | "api_key_enc" | "cert_pin" | "enabled" | "origin"
> & {
  /** Voce dell'archivio (tappa 2f, T23); assente = nessuna. */
  credential_id?: number | null;
};

export function insertNetworkController(input: NetworkControllerInsert): NetworkControllerRow {
  const r = db()
    .prepare(
      `INSERT INTO network_controllers (name, vendor, kind, url, site, username, password_enc, api_key_enc, cert_pin, enabled, origin, credential_id)
       VALUES (@name, @vendor, @kind, @url, @site, @username, @password_enc, @api_key_enc, @cert_pin, @enabled, @origin, @credential_id)`,
    )
    .run({ ...input, credential_id: input.credential_id ?? null });
  const row = getNetworkController(Number(r.lastInsertRowid));
  if (!row) throw new Error("controller appena inserito non trovato");
  return row;
}

export type NetworkControllerPatch = Partial<
  Pick<
    NetworkControllerRow,
    "name" | "kind" | "vendor" | "url" | "site" | "username" | "password_enc" | "api_key_enc" | "cert_pin" | "enabled" | "credential_id"
  >
>;

const CONTROLLER_PATCH_COLUMNS: ReadonlyArray<keyof NetworkControllerPatch> = [
  "name", "kind", "vendor", "url", "site", "username", "password_enc", "api_key_enc", "cert_pin", "enabled", "credential_id",
];

export function updateNetworkController(id: number, patch: NetworkControllerPatch): NetworkControllerRow | undefined {
  const cols = CONTROLLER_PATCH_COLUMNS.filter((c) => patch[c] !== undefined);
  if (cols.length > 0) {
    const set = cols.map((c) => `${c} = @${c}`).join(", ");
    const params: Record<string, unknown> = { id };
    for (const c of cols) params[c] = patch[c];
    db().prepare(`UPDATE network_controllers SET ${set}, updated_at = datetime('now') WHERE id = @id`).run(params);
  }
  return getNetworkController(id);
}

// Tappa 2f credenziali (T23): la credenziale del controller è una voce
// dell'archivio. Involucri di una riga delle funzioni `…Db` di
// `controllers/credenziale.ts`. Nessuna gemella in db.ts: i controller vivono
// solo nel DB del tenant (il vecchio ipam.db non ha `network_controllers`, e
// il facade non li espone).

/** Con che cosa entra il controller: la sua voce, o niente (dalla 2g le colonne non valgono più). Non registra. */
export function credenzialeDelController(
  row: Pick<NetworkControllerRow, "kind" | "credential_id">,
  metodo?: MetodoVoceController,
): CredenzialeController {
  return credenzialeControllerDb(db(), row, metodo);
}

/** La voce `credentialId` vale per un controller di tipo `kind` (e col metodo scelto)? */
export function voceDelController(credentialId: number, kind: ControllerKind, metodo?: MetodoVoceController): EsitoVoceController {
  return voceControllerDb(db(), credentialId, kind, metodo);
}

/** Voce «UniFi · <nome>» dai segreti nuovi del modulo. */
export function creaVoceDelController(c: ControllerDellaVoce, nuova: NuovaCredenzialeController): { id: number; nome: string } {
  return creaVoceControllerDb(db(), c, nuova);
}

/** Voce dai segreti già cifrati della configurazione vecchia dell'hub. */
export function creaVoceDelControllerCifrata(
  c: ControllerDellaVoce,
  v: { metodo: "chiave" | "utente"; encrypted_username: string | null; encrypted_password: string },
): { id: number; nome: string } {
  return creaVoceControllerCifrataDb(db(), c, v);
}

/** Nome e metodo della voce di ogni controller, in una query. */
export function listVociDeiController(): Map<number, VoceDelController> {
  return vociDeiControllerDb(db());
}

/**
 * Cancella il controller, le sue letture (cascade) e le sue pianificazioni
 * (apparati e client: tutti i job unifi_sync col suo id). Gli apparati letti restano.
 */
export function deleteNetworkController(id: number): boolean {
  return runInTenantTransaction(() => {
    db()
      .prepare("DELETE FROM scheduled_jobs WHERE job_type = 'unifi_sync' AND json_extract(config, '$.controller_id') = ?")
      .run(id);
    return db().prepare("DELETE FROM network_controllers WHERE id = ?").run(id).changes > 0;
  });
}

export interface ControllerRunInsert {
  controller_id: number;
  started_at: string;
  finished_at: string;
  trigger: ControllerRunStoredTrigger;
  triggered_by: string | null;
  ok: number;
  total: number;
  added: number;
  updated: number;
  skipped: number;
  ports: number;
  neighbors: number;
  message: string | null;
  errors_json: string;
  skipped_reasons_json: string;
  offline_json: string;
}

/**
 * Registra una lettura, aggiorna il riepilogo sulla riga del controller e pota
 * lo storico oltre `CONTROLLER_RUNS_KEPT` letture dello stesso tipo. Una lettura
 * riuscita aggiorna anche i conteggi; una fallita lascia quelli dell'ultima
 * riuscita. Una lettura dei client (trigger «client:…», topologia fase 2)
 * registra solo lo storico: il riepilogo della riga è quello degli apparati e
 * lo leggono la pagina e «Stato moduli». `summary` forza l'una o l'altra cosa.
 */
export function recordControllerRun(run: ControllerRunInsert, opts: { summary?: boolean } = {}): void {
  const kind = controllerRunKindOf(run.trigger);
  const summary = opts.summary ?? kind === "apparati";
  runInTenantTransaction(() => {
    const d = db();
    d.prepare(
      `INSERT INTO network_controller_runs
         (controller_id, started_at, finished_at, trigger, triggered_by, ok, total, added, updated, skipped,
          ports, neighbors, message, errors_json, skipped_reasons_json, offline_json)
       VALUES (@controller_id, @started_at, @finished_at, @trigger, @triggered_by, @ok, @total, @added, @updated, @skipped,
          @ports, @neighbors, @message, @errors_json, @skipped_reasons_json, @offline_json)`,
    ).run(run);
    // summary false = lettura che non è quella degli apparati (es. client
    // collegati): solo storico, il riepilogo della riga resta quello degli apparati.
    if (summary && run.ok) {
      d.prepare(
        `UPDATE network_controllers
            SET last_run_at = ?, last_ok = 1, last_message = ?, last_devices = ?, last_ports = ?, last_neighbors = ?
          WHERE id = ?`,
      ).run(run.finished_at, run.message, run.total, run.ports, run.neighbors, run.controller_id);
    } else if (summary) {
      d.prepare("UPDATE network_controllers SET last_run_at = ?, last_ok = 0, last_message = ? WHERE id = ?").run(
        run.finished_at,
        run.message,
        run.controller_id,
      );
    }
    d.prepare(
      `DELETE FROM network_controller_runs
        WHERE controller_id = ? AND ${RUN_KIND_SQL} = ?
          AND id NOT IN (SELECT id FROM network_controller_runs
                          WHERE controller_id = ? AND ${RUN_KIND_SQL} = ? ORDER BY id DESC LIMIT ?)`,
    ).run(run.controller_id, kind, run.controller_id, kind, CONTROLLER_RUNS_KEPT);
  });
}

export type ControllerRunRow = ControllerRunInsert & { id: number };

/** Ultime letture di un controller di un tipo (di default gli apparati: lo storico della pagina). */
export function listControllerRuns(controllerId: number, limit = 10, kind: ControllerRunKind = "apparati"): ControllerRunRow[] {
  return db()
    .prepare(`SELECT * FROM network_controller_runs WHERE controller_id = ? AND ${RUN_KIND_SQL} = ? ORDER BY id DESC LIMIT ?`)
    .all(controllerId, kind, Math.max(1, Math.min(limit, CONTROLLER_RUNS_KEPT))) as ControllerRunRow[];
}

/** L'ultima lettura dei client di ogni controller, in una query (niente N+1). */
export function listLastControllerClientRuns(): ControllerRunRow[] {
  return db()
    .prepare(
      `SELECT r.* FROM network_controller_runs r
         JOIN (SELECT controller_id, MAX(id) AS id FROM network_controller_runs
                WHERE trigger LIKE 'client:%' GROUP BY controller_id) last ON last.id = r.id`,
    )
    .all() as ControllerRunRow[];
}

export interface ControllerScheduleRow {
  job_id: number;
  controller_id: number | null;
  interval_minutes: number;
  enabled: number;
}

/**
 * I job unifi_sync degli apparati del tenant, col controller a cui puntano
 * (null = job vecchio, senza controller). Il job dei client non c'è: è
 * `listControllerClientScheduleJobs`.
 */
export function listControllerScheduleJobs(): ControllerScheduleRow[] {
  return db()
    .prepare(
      `SELECT id AS job_id, json_extract(config, '$.controller_id') AS controller_id, interval_minutes, enabled
         FROM scheduled_jobs WHERE job_type = 'unifi_sync' AND ${DEVICE_JOB_SQL} ORDER BY id`,
    )
    .all() as ControllerScheduleRow[];
}

/** I job unifi_sync dei client (`config.cosa = "client"`), uno per controller. */
export function listControllerClientScheduleJobs(): ControllerScheduleRow[] {
  return db()
    .prepare(
      `SELECT id AS job_id, json_extract(config, '$.controller_id') AS controller_id, interval_minutes, enabled
         FROM scheduled_jobs WHERE job_type = 'unifi_sync' AND ${CLIENT_JOB_SQL} ORDER BY id`,
    )
    .all() as ControllerScheduleRow[];
}

/** Il job dei client gira ogni ora; la finestra 7-20 la guarda il job (`inFinestraClient`). */
export const CONTROLLER_CLIENT_JOB_MINUTES = 60;

/**
 * Lettura dei client di un controller ogni ora (topologia fase 2, spec §10.5):
 * `on` = un job unifi_sync con `config.cosa = "client"` (creato se manca, uno
 * solo), `!on` = cancellato. Non tocca il job degli apparati.
 */
export function setControllerClientSchedule(controllerId: number, on: boolean): void {
  runInTenantTransaction(() => {
    const d = db();
    const existing = d
      .prepare(
        `SELECT id FROM scheduled_jobs
          WHERE job_type = 'unifi_sync' AND json_extract(config, '$.controller_id') = ? AND ${CLIENT_JOB_SQL} ORDER BY id`,
      )
      .all(controllerId) as Array<{ id: number }>;
    const [keep, ...extra] = existing;
    const drop = on ? extra : existing;
    for (const j of drop) d.prepare("DELETE FROM scheduled_jobs WHERE id = ?").run(j.id);
    if (!on) return;
    if (keep) {
      d.prepare("UPDATE scheduled_jobs SET interval_minutes = ?, enabled = 1, updated_at = datetime('now') WHERE id = ?").run(
        CONTROLLER_CLIENT_JOB_MINUTES,
        keep.id,
      );
    } else {
      d.prepare(
        "INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled, config) VALUES (NULL, 'unifi_sync', ?, 1, ?)",
      ).run(CONTROLLER_CLIENT_JOB_MINUTES, JSON.stringify({ controller_id: controllerId, cosa: "client" }));
    }
  });
}

/**
 * Pianificazione degli apparati di un controller: un solo job unifi_sync
 * (senza `cosa`) per controller; il job dei client non si tocca.
 * `minutes` null = spenta, e il job si cancella (non resta un job spento che
 * qualcuno riaccende dalla pagina dei job senza vedere il controller).
 */
export function setControllerSchedule(controllerId: number, minutes: number | null): void {
  runInTenantTransaction(() => {
    const d = db();
    const existing = d
      .prepare(
        `SELECT id FROM scheduled_jobs
          WHERE job_type = 'unifi_sync' AND json_extract(config, '$.controller_id') = ? AND ${DEVICE_JOB_SQL} ORDER BY id`,
      )
      .all(controllerId) as Array<{ id: number }>;
    if (minutes === null) {
      for (const j of existing) d.prepare("DELETE FROM scheduled_jobs WHERE id = ?").run(j.id);
      return;
    }
    const [keep, ...extra] = existing;
    for (const j of extra) d.prepare("DELETE FROM scheduled_jobs WHERE id = ?").run(j.id);
    if (keep) {
      d.prepare("UPDATE scheduled_jobs SET interval_minutes = ?, enabled = 1, updated_at = datetime('now') WHERE id = ?").run(
        minutes,
        keep.id,
      );
    } else {
      d.prepare(
        "INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled, config) VALUES (NULL, 'unifi_sync', ?, 1, ?)",
      ).run(minutes, JSON.stringify({ controller_id: controllerId }));
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// LETTURA DEGLI HYPERVISOR (topologia fase 2b): un job hypervisor_sync per
// tenant, ogni giorno, SPENTO di default. Lo accende un amministratore dalla
// pagina «Dati della mappa»; nessuna migrazione lo crea.
// ═══════════════════════════════════════════════════════════════════════════

/** Gli apparati che il job legge: hypervisor con scansione Proxmox, accesi. Solo i campi che servono. */
export function listHypervisorScanDevices(): Array<{ id: number; last_proxmox_scan_at: string | null }> {
  const rows = db()
    .prepare(
      `SELECT id, vendor, protocol, device_type, classification, scan_target, product_profile, enabled, last_proxmox_scan_at
         FROM network_devices ORDER BY id`,
    )
    .all() as Array<{
    id: number;
    vendor: string;
    protocol: string;
    device_type: string;
    classification: string | null;
    scan_target: string | null;
    product_profile: string | null;
    enabled: number;
    last_proxmox_scan_at: string | null;
  }>;
  return rows
    .filter((r) => r.enabled === 1 && isProxmoxVeDevice(r))
    .map((r) => ({ id: r.id, last_proxmox_scan_at: r.last_proxmox_scan_at }));
}

export interface HypervisorSyncState {
  /** Il job c'è ed è acceso. */
  enabled: boolean;
  jobId: number | null;
  /** Fine dell'ultimo giro del job (UTC del DB), null se non è mai girato. */
  lastRun: string | null;
  /** Quanti apparati il job leggerebbe. */
  hypervisors: number;
  /** La scansione Proxmox più recente fra quegli apparati (ISO), null se nessuna. */
  lastScanAt: string | null;
}

export function getHypervisorSyncSchedule(): HypervisorSyncState {
  const job = db()
    .prepare("SELECT id, enabled, last_run FROM scheduled_jobs WHERE job_type = 'hypervisor_sync' ORDER BY id LIMIT 1")
    .get() as { id: number; enabled: number; last_run: string | null } | undefined;
  const devices = listHypervisorScanDevices();
  const scans = devices.map((d) => d.last_proxmox_scan_at).filter((x): x is string => !!x).sort();
  return {
    enabled: !!job && job.enabled === 1,
    jobId: job?.id ?? null,
    lastRun: job?.last_run ?? null,
    hypervisors: devices.length,
    lastScanAt: scans.length > 0 ? scans[scans.length - 1] : null,
  };
}

/**
 * Accende o spegne la lettura giornaliera degli hypervisor: `on` = un job
 * hypervisor_sync (creato se manca, uno solo, config `{}`), `!on` = cancellato
 * (non resta un job spento che si riaccende dalla pagina dei job senza vedere
 * cosa fa). Chi chiama ricarica lo scheduler del tenant.
 */
export function setHypervisorSyncSchedule(on: boolean): void {
  runInTenantTransaction(() => {
    const d = db();
    const existing = d.prepare("SELECT id FROM scheduled_jobs WHERE job_type = 'hypervisor_sync' ORDER BY id").all() as Array<{ id: number }>;
    const [keep, ...extra] = existing;
    for (const j of on ? extra : existing) d.prepare("DELETE FROM scheduled_jobs WHERE id = ?").run(j.id);
    if (!on) return;
    if (keep) {
      d.prepare("UPDATE scheduled_jobs SET interval_minutes = ?, enabled = 1, updated_at = datetime('now') WHERE id = ?").run(
        HYPERVISOR_SYNC_MINUTES,
        keep.id,
      );
    } else {
      d.prepare(
        "INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled, config) VALUES (NULL, 'hypervisor_sync', ?, 1, '{}')",
      ).run(HYPERVISOR_SYNC_MINUTES);
    }
  });
}

export interface PuliziaHostState {
  /** Il job c'è ed è acceso. */
  enabled: boolean;
  jobId: number | null;
  /** Fine dell'ultimo giro del job (UTC del DB), null se non è mai girato. */
  lastRun: string | null;
}

/** La pulizia notturna degli host assenti (piano 2026-10-20, Task 5): il job pulizia_host del tenant. */
export function getPuliziaHostSchedule(): PuliziaHostState {
  const job = db()
    .prepare("SELECT id, enabled, last_run FROM scheduled_jobs WHERE job_type = 'pulizia_host' ORDER BY id LIMIT 1")
    .get() as { id: number; enabled: number; last_run: string | null } | undefined;
  return { enabled: !!job && job.enabled === 1, jobId: job?.id ?? null, lastRun: job?.last_run ?? null };
}

/**
 * Accende o spegne la pulizia notturna degli host assenti: `on` = un job
 * pulizia_host (creato se manca, uno solo, ogni giorno, config `{}`), `!on` =
 * cancellato (non resta un job spento che si riaccende dalla pagina dei job
 * senza vedere cosa fa). È l'unica strada che crea il job: nessuna migrazione e
 * nessun tenant nuovo lo hanno (decisione 4). Copia di `setHypervisorSyncSchedule`.
 * Chi chiama ricarica lo scheduler del tenant.
 */
export function setPuliziaHostSchedule(on: boolean): void {
  runInTenantTransaction(() => {
    const d = db();
    const existing = d.prepare("SELECT id FROM scheduled_jobs WHERE job_type = 'pulizia_host' ORDER BY id").all() as Array<{ id: number }>;
    const [keep, ...extra] = existing;
    for (const j of on ? extra : existing) d.prepare("DELETE FROM scheduled_jobs WHERE id = ?").run(j.id);
    if (!on) return;
    if (keep) {
      d.prepare("UPDATE scheduled_jobs SET interval_minutes = ?, enabled = 1, updated_at = datetime('now') WHERE id = ?").run(
        PULIZIA_HOST_MINUTES,
        keep.id,
      );
    } else {
      d.prepare(
        "INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled, config) VALUES (NULL, 'pulizia_host', ?, 1, '{}')",
      ).run(PULIZIA_HOST_MINUTES);
    }
  });
}

/**
 * Ogni quanto si leggono router e switch (spec §13.5.6, il dialogo delle letture in più): il router lo leggono il giro
 * ARP e le scansioni delle reti (il più frequente fra i job accesi); gli switch solo il giro ARP. null = nessun job acceso.
 */
export function cadenzaLetture(): { router: { minuti: number | null; daScansioni: boolean }; switch: number | null } {
  const righe = db().prepare(`SELECT job_type, MIN(interval_minutes) AS m FROM scheduled_jobs
     WHERE enabled = 1 AND job_type IN ('arp_poll', 'fast_scan', 'ping_sweep', 'snmp_scan', 'nmap_scan') GROUP BY job_type`).all() as Array<{ job_type: string; m: number }>;
  const arp = righe.find((r) => r.job_type === "arp_poll")?.m ?? null;
  if (righe.length === 0) return { router: { minuti: null, daScansioni: false }, switch: null };
  const min = Math.min(...righe.map((r) => r.m));
  return { router: { minuti: min, daScansioni: righe.some((r) => r.m === min && r.job_type !== "arp_poll") }, switch: arp };
}

/** Lega al controller i job unifi_sync nati prima dei controller multipli (config senza controller_id). */
export function attachOrphanUnifiJobs(controllerId: number): number {
  return db()
    .prepare(
      `UPDATE scheduled_jobs
          SET config = json_set(COALESCE(NULLIF(config, ''), '{}'), '$.controller_id', ?), updated_at = datetime('now')
        WHERE job_type = 'unifi_sync' AND json_extract(COALESCE(NULLIF(config, ''), '{}'), '$.controller_id') IS NULL`,
    )
    .run(controllerId).changes;
}

// ═══════════════════════════════════════════════════════════════════════════
// TOPOLOGIA — modello (fase 1, piano 2026-10-13): letture in blocco (no N+1)
// e le sole scritture che un admin conferma (sede, testa, subnet, correzioni).
// ═══════════════════════════════════════════════════════════════════════════

type ModelInput = import("@/lib/topology/model-types").TopologyModelInput;
type Esito = { ok: true } | { ok: false; error: string };

// Le tre letture dell'indice dei nodi, uguali per il modello e per l'ingresso leggero delle unioni (stesso testo SQL).
function apparatiDelModello(d: Database.Database): ModelInput["devices"] {
  return d.prepare(`
      SELECT nd.id, nd.name, nd.host, nd.device_type, nd.vendor, nd.model, nd.enabled, nd.host_id, nd.physical_device_id,
             nd.location_id, nd.controller_mac, nd.uplink_mac, nd.uplink_remote_port, nd.uplink_type, nd.uplink_seen_at, nd.topology_hidden,
             nd.protocol AS via, nd.topology_role,
             COALESCE(sp.n, 0) AS port_count,
             CASE WHEN nd.scan_target = 'proxmox' OR COALESCE(nd.last_proxmox_scan_result, '') <> '' THEN 1 ELSE 0 END AS proxmox_scan
        FROM network_devices nd
        LEFT JOIN (SELECT device_id, COUNT(*) AS n FROM switch_ports GROUP BY device_id) sp ON sp.device_id = nd.id
       ORDER BY nd.id`).all() as ModelInput["devices"];
}
function hostDelModello(d: Database.Database): ModelInput["hosts"] {
  return d.prepare(`
      SELECT id, network_id, ip, mac, hostname, custom_name, classification, status, physical_device_id
        FROM hosts ORDER BY id`).all() as ModelInput["hosts"];
}
function viciniDelModello(d: Database.Database): ModelInput["neighbors"] {
  return d.prepare(`
      SELECT dn.device_id, dn.local_port, dn.remote_device_name, dn.remote_port, dn.protocol, dn.remote_ip, dn.remote_mac,
             dn.remote_platform, dn.timestamp, dn.source
        FROM device_neighbors dn
       WHERE ${NEIGHBORS_MODEL_SOURCES_SQL}`).all() as ModelInput["neighbors"];
}
/** Le unioni e le separazioni attive per l'ingresso: ogni chiave SOLO se ha righe (senza, l'ingresso e le impronte di oggi). */
function scelteDelModello(): Pick<ModelInput, "unioni" | "separazioni"> {
  const r = getRigheScelte();
  return {
    ...(r.unioni.length > 0 ? { unioni: r.unioni.map(({ gruppo, membro }) => ({ gruppo, membro })) } : {}),
    ...(r.separazioni.length > 0 ? { separazioni: r.separazioni.map(({ membro, altro }) => ({ membro, altro })) } : {}),
  };
}

/** L'ingresso leggero dell'indice dei nodi (le rotte delle unioni): i quattro campi del modello e le sue righe, niente altro. */
export function getIngressoNodi(): Pick<ModelInput, "devices" | "hosts" | "knownMacs" | "neighbors" | "unioni" | "separazioni"> {
  const d = db();
  return { devices: apparatiDelModello(d), hosts: hostDelModello(d), knownMacs: getNetworkDeviceKnownMacs(), neighbors: viciniDelModello(d), ...scelteDelModello() };
}

export function getTopologyModelInput(staleDays: number, nowMs: number = Date.now()): ModelInput {
  const d = db();
  // VM e host dei cluster dalle scansioni Proxmox già salvate (spec §11.5); un JSON rovinato = nessuna VM per quell'apparato.
  const vms: ModelInput["vms"] = [];
  const scanHosts: ModelInput["scanHosts"] = [];
  const scans = d
    .prepare("SELECT id, last_proxmox_scan_result AS raw FROM network_devices WHERE last_proxmox_scan_result IS NOT NULL AND last_proxmox_scan_result <> '' ORDER BY id")
    .all() as Array<{ id: number; raw: string }>;
  for (const s of scans) {
    const p = parseProxmoxScan(s.id, s.raw);
    vms.push(...p.vms);
    scanHosts.push(...p.hosts);
  }
  return {
    devices: apparatiDelModello(d),
    hosts: hostDelModello(d),
    neighbors: viciniDelModello(d),
    uplinkPorts: d.prepare(`
      SELECT device_id, port_index, port_name FROM switch_ports WHERE is_uplink = 1 ORDER BY device_id, port_index`).all() as ModelInput["uplinkPorts"],
    locations: d.prepare("SELECT id, name, parent_id, head_device_id FROM locations ORDER BY id").all() as ModelInput["locations"],
    networks: d.prepare("SELECT id, cidr, name, gateway, location_id FROM networks ORDER BY id").all() as ModelInput["networks"],
    knownMacs: getNetworkDeviceKnownMacs(),
    overrides: d
      .prepare("SELECT id, action, a_node, a_port, b_node, b_port, medium, created_by, created_at FROM topology_link_overrides ORDER BY id")
      .all() as ModelInput["overrides"],
    macPorts: d.prepare(`
      SELECT device_id, mac, port_name, timestamp, source FROM mac_port_entries
       WHERE timestamp >= datetime('now', '-30 days') ORDER BY device_id, port_name, mac`).all() as ModelInput["macPorts"],
    primaries: listTopologyLinkPrimaries(),
    portInfo: d.prepare(`
      SELECT device_id, port_name, speed, poe_status, poe_power_mw FROM switch_ports
       WHERE COALESCE(speed, '') <> '' OR COALESCE(poe_power_mw, 0) > 0 ORDER BY device_id, port_index`).all() as ModelInput["portInfo"],
    // Spec §13.6.1: l'elenco intero delle porte, con l'indice e lo stato (anche quelle giù), per la chiave della porta.
    ports: d.prepare(`
      SELECT device_id, port_index, port_name, speed, status, stp_state FROM switch_ports ORDER BY device_id, port_index`).all() as ModelInput["ports"],
    vms,
    scanHosts,
    nowMs,
    staleDays,
    // Unioni e separazioni a mano (ADR 0021): in fondo e solo se ci sono righe, così l'ordine delle chiavi di oggi resta.
    ...scelteDelModello(),
  };
}

type IngressoCavi = import("@/lib/topology/cavi/prove").IngressoCavi;

/**
 * L'ingresso del modello per cavo (spec §13.5.7, «Chi legge che cosa»): quello del modello di oggi più le righe dei vicini di
 * TUTTE le fonti con le colonne nuove, i fatti dell'ultimo giro di ogni apparato e lettore (`seen_at` almeno pari al più
 * recente meno 5 minuti, come NEIGHBORS_LATEST_ROUND_SQL) e non più vecchi della soglia «non visto» (M5), i MAC dei lettori e
 * le schede dell'inventario (solo identità, mai `getNetworkDeviceKnownMacs`), gli uplink per indice. Senza schema, elenchi
 * vuoti e `schema: false`: la traccia lo dice.
 */
export function getIngressoCavi(staleDays: number, nowMs: number = Date.now()): IngressoCavi {
  const d = db();
  const t1 = getTopologyModelInput(staleDays, nowMs);
  const daRiga = (n: ModelInput["neighbors"][number]) => ({ ...n, remote_platform: n.remote_platform ?? null, discovered_by: null, local_port_index: null, remote_port_index: null, remote_caps: null });
  if (!schemaCaviPresente()) {
    return { t1, vicini: t1.neighbors.map(daRiga), fattiPorta: [], fattiBridge: [], macApparati: [], uplink: [], schema: false };
  }
  // L'ultimo giro è uno per apparato e lettore, il più recente fra porte e bridge (revisione del Task 6 di T2, «Scelte» 8):
  // calcolato tabella per tabella, un giro che scrive il bridge e non le porte (tabella che non ha risposto) lasciava le
  // porte del giro di prima accanto al bridge nuovo.
  const giro = `SELECT MAX(seen_at) FROM (
      SELECT seen_at FROM topology_port_facts g WHERE g.device_id = f.device_id AND g.source = f.source
      UNION ALL SELECT seen_at FROM topology_bridge_facts g WHERE g.device_id = f.device_id AND g.source = f.source)`;
  // M5 (revisione finale di T2): l'«ultimo giro» di una fonte che non si legge più resta nel DB fino alla potatura (90
  // giorni), e un `running = 0` di allora faceva «giù» un cavo che l'LLDP vede oggi. Un fatto più vecchio della soglia «non
  // visto» non entra: per il modello per cavo quella porta non è letta. Stessa soglia dei collegamenti (staleDays), calcolata
  // dall'orologio passato (`nowMs`), non da datetime('now'): la misura con `--adesso` resta coerente.
  const soglia = new Date(nowMs - staleDays * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
  const ultimoGiro = (t: string) =>
    `SELECT f.* FROM ${t} f WHERE f.seen_at >= ? AND f.seen_at >= (SELECT datetime((${giro}), '-5 minutes')) ORDER BY f.device_id, f.source`;
  return {
    t1,
    vicini: d.prepare(`SELECT device_id, local_port, remote_device_name, remote_port, protocol, remote_ip, remote_mac, remote_platform, timestamp,
        source, discovered_by, local_port_index, remote_port_index, remote_caps FROM device_neighbors`).all() as IngressoCavi["vicini"],
    fattiPorta: d.prepare(`${ultimoGiro("topology_port_facts")}, f.port_key`).all(soglia) as IngressoCavi["fattiPorta"],
    fattiBridge: d.prepare(`${ultimoGiro("topology_bridge_facts")}, f.bridge_name, f.instance`).all(soglia) as IngressoCavi["fattiBridge"],
    macApparati: d.prepare(`SELECT device_id, mac, source FROM topology_device_macs
      UNION SELECT nd.id, di.mac, 'inventario' FROM network_devices nd JOIN device_interfaces di ON di.physical_device_id = nd.physical_device_id
       WHERE di.mac IS NOT NULL AND di.mac <> '' AND di.is_virtual_mac = 0 ORDER BY 1, 2`).all() as IngressoCavi["macApparati"],
    uplink: d.prepare(`SELECT id AS device_id, uplink_local_port_idx, uplink_source FROM network_devices
      WHERE uplink_local_port_idx IS NOT NULL OR uplink_source IS NOT NULL ORDER BY id`).all() as IngressoCavi["uplink"],
    schema: true,
  };
}

/** Sede confermata di un apparato e chi l'ha scelta; null se l'apparato non esiste. */
export function getDeviceLocation(
  deviceId: number,
): { location_id: number | null; location_set_by: string | null; location_set_at: string | null } | null {
  const row = db().prepare("SELECT location_id, location_set_by, location_set_at FROM network_devices WHERE id = ?").get(deviceId) as
    | { location_id: number | null; location_set_by: string | null; location_set_at: string | null }
    | undefined;
  return row ?? null;
}

export function setDeviceLocation(deviceId: number, locationId: number | null, author: string): Esito {
  const d = db();
  if (!d.prepare("SELECT 1 FROM network_devices WHERE id = ?").get(deviceId)) return { ok: false, error: "Apparato non trovato" };
  if (locationId !== null && !d.prepare("SELECT 1 FROM locations WHERE id = ?").get(locationId)) {
    return { ok: false, error: "Ubicazione non trovata" };
  }
  d.prepare("UPDATE network_devices SET location_id = ?, location_set_by = ?, location_set_at = datetime('now') WHERE id = ?")
    .run(locationId, author, deviceId);
  return { ok: true };
}

export interface SiteTopologyRow {
  location_id: number;
  head_device_id: number | null;
  head_set_by: string | null;
  head_set_at: string | null;
  network_ids: number[];
}

export function getSiteTopology(locationId: number): SiteTopologyRow | null {
  const d = db();
  const loc = d.prepare("SELECT id, head_device_id, head_set_by, head_set_at FROM locations WHERE id = ?").get(locationId) as
    | { id: number; head_device_id: number | null; head_set_by: string | null; head_set_at: string | null }
    | undefined;
  if (!loc) return null;
  const nets = d.prepare("SELECT id FROM networks WHERE location_id = ? ORDER BY id").all(locationId) as Array<{ id: number }>;
  return { location_id: loc.id, head_device_id: loc.head_device_id, head_set_by: loc.head_set_by, head_set_at: loc.head_set_at, network_ids: nets.map((n) => n.id) };
}

/** Testa e subnet di una SEDE (ubicazione di primo livello). `networkIds` sostituisce l'elenco. */
export function setSiteTopology(locationId: number, input: { headDeviceId?: number | null; networkIds?: number[] }, author: string): Esito {
  const d = db();
  const loc = d.prepare("SELECT parent_id FROM locations WHERE id = ?").get(locationId) as { parent_id: number | null } | undefined;
  if (!loc) return { ok: false, error: "Ubicazione non trovata" };
  if (loc.parent_id !== null) return { ok: false, error: "Testa e subnet si scelgono solo per una sede (ubicazione di primo livello)" };
  if (input.headDeviceId != null && !d.prepare("SELECT 1 FROM network_devices WHERE id = ?").get(input.headDeviceId)) {
    return { ok: false, error: "Apparato di testa non trovato" };
  }
  const ids = [...new Set(input.networkIds ?? [])];
  if (ids.length > 0) {
    const found = d.prepare(`SELECT COUNT(*) AS n FROM networks WHERE id IN (${ids.map(() => "?").join(",")})`).get(...ids) as { n: number };
    if (found.n !== ids.length) return { ok: false, error: "Una delle subnet non esiste" };
  }
  d.transaction(() => {
    if (input.headDeviceId !== undefined) {
      d.prepare("UPDATE locations SET head_device_id = ?, head_set_by = ?, head_set_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
        .run(input.headDeviceId, author, locationId);
    }
    if (input.networkIds !== undefined) {
      const keep = ids.length > 0 ? `AND id NOT IN (${ids.map(() => "?").join(",")})` : "";
      d.prepare(`UPDATE networks SET location_id = NULL, location_set_by = ?, location_set_at = datetime('now') WHERE location_id = ? ${keep}`)
        .run(author, locationId, ...ids);
      if (ids.length > 0) {
        d.prepare(`UPDATE networks SET location_id = ?, location_set_by = ?, location_set_at = datetime('now') WHERE id IN (${ids.map(() => "?").join(",")})`)
          .run(locationId, author, ...ids);
      }
    }
  })();
  return { ok: true };
}

// ─── Topologia: mappe salvate («passo passo»), ritocchi con firma, «nascondi» ──
// Vista 'auto' = la mappa automatica; 'mappa:<id>' = una passo passo. Una riga di
// topology_position con pinned 0 / x 0 / y 0 è solo l'appartenenza alla mappa;
// un ritocco è pinned 1 con x, y e la firma della struttura al momento del salvataggio.

export interface TopologyMapRow {
  id: number;
  name: string;
  kind: "auto" | "passo";
  roots: string[];
  head_node: string | null;
  /** «Verticale» (`lr`, predefinito) o «Orizzontale» (`tb`), spec §12.2. */
  orientation: MapOrientation;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface TopologyMapDbRow extends Omit<TopologyMapRow, "roots" | "orientation"> {
  roots: string;
  orientation: string;
}

/** Vista di una mappa: l'automatica o una passo passo. */
export type TopologyView = "auto" | `mappa:${number}`;

// Il CHECK della colonna ammette solo 'lr' e 'tb'.
const mapOrientationOf = (v: string): MapOrientation => (v === "tb" ? "tb" : "lr");
// Un ritocco senza orientamento è nato prima della colonna, in orizzontale (spec §12.2).
const tweakOrientationOf = (v: string | null): MapOrientation => (v === "lr" ? "lr" : "tb");

function toMapRow(r: TopologyMapDbRow): TopologyMapRow {
  let roots: string[] = [];
  try {
    const p: unknown = JSON.parse(r.roots);
    if (Array.isArray(p)) roots = p.filter((x): x is string => typeof x === "string");
  } catch {
    roots = []; // JSON rovinato: la mappa si apre lo stesso, senza radici
  }
  return { ...r, roots, orientation: mapOrientationOf(r.orientation) };
}

const MAP_COLS = "id, name, kind, roots, head_node, orientation, created_by, created_at, updated_at";

export function listTopologyMaps(): TopologyMapRow[] {
  const rows = db().prepare(`SELECT ${MAP_COLS} FROM topology_maps WHERE kind = 'passo' ORDER BY name COLLATE NOCASE, id`).all() as TopologyMapDbRow[];
  return rows.map(toMapRow);
}

export function getTopologyMap(id: number): TopologyMapRow | null {
  const r = db().prepare(`SELECT ${MAP_COLS} FROM topology_maps WHERE id = ? AND kind = 'passo'`).get(id) as TopologyMapDbRow | undefined;
  return r ? toMapRow(r) : null;
}

export function getAutoMap(): TopologyMapRow | null {
  const r = db().prepare(`SELECT ${MAP_COLS} FROM topology_maps WHERE kind = 'auto'`).get() as TopologyMapDbRow | undefined;
  return r ? toMapRow(r) : null;
}

const ADD_MEMBER_SQL = `INSERT INTO topology_position (view, node_id, x, y, pinned, updated_at)
  VALUES (?, ?, 0, 0, 0, datetime('now')) ON CONFLICT(view, node_id) DO NOTHING`;

export function createTopologyMap(input: { name: string; roots: string[]; nodes: string[] }, author: string): TopologyMapRow {
  return runInTenantTransaction(() => {
    const d = db();
    const id = Number(
      d.prepare("INSERT INTO topology_maps (name, kind, roots, created_by) VALUES (?, 'passo', ?, ?)")
        .run(input.name, JSON.stringify([...new Set(input.roots)]), author).lastInsertRowid,
    );
    const ins = d.prepare(ADD_MEMBER_SQL);
    for (const n of new Set(input.nodes)) ins.run(`mappa:${id}`, n);
    return getTopologyMap(id) as TopologyMapRow;
  });
}

export function updateTopologyMap(id: number, patch: { name?: string; roots?: string[] }): Esito {
  const d = db();
  if (!getTopologyMap(id)) return { ok: false, error: "Mappa non trovata" };
  if (patch.name !== undefined && patch.name.trim() === "") return { ok: false, error: "Il nome della mappa non può essere vuoto" };
  if (patch.name !== undefined) d.prepare("UPDATE topology_maps SET name = ?, updated_at = datetime('now') WHERE id = ?").run(patch.name, id);
  if (patch.roots !== undefined) {
    d.prepare("UPDATE topology_maps SET roots = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify([...new Set(patch.roots)]), id);
  }
  return { ok: true };
}

/** Aggiungere è idempotente e non tocca un ritocco già salvato; togliere toglie il nodo anche dalle radici. */
export function setTopologyMapNodes(id: number, add: string[], remove: string[]): Esito {
  const map = getTopologyMap(id);
  if (!map) return { ok: false, error: "Mappa non trovata" };
  runInTenantTransaction(() => {
    const d = db();
    const view = `mappa:${id}`;
    const ins = d.prepare(ADD_MEMBER_SQL);
    for (const n of new Set(add)) ins.run(view, n);
    const del = d.prepare("DELETE FROM topology_position WHERE view = ? AND node_id = ?");
    for (const n of new Set(remove)) del.run(view, n);
    const gone = new Set(remove);
    const roots = map.roots.filter((r) => !gone.has(r));
    d.prepare("UPDATE topology_maps SET roots = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(roots), id);
  });
  return { ok: true };
}

export function deleteTopologyMap(id: number): boolean {
  return runInTenantTransaction(() => {
    const d = db();
    d.prepare("DELETE FROM topology_position WHERE view = ?").run(`mappa:${id}`);
    return d.prepare("DELETE FROM topology_maps WHERE id = ? AND kind = 'passo'").run(id).changes > 0;
  });
}

/**
 * Nodi della vista (anche quelli che non esistono più: li dichiara la pagina), ritocchi
 * salvati col loro orientamento (spec §12.2: un ritocco vale nell'orientamento in cui è
 * fatto; NULL = `tb`) e l'orientamento della mappa.
 */
export function getTopologyMapView(view: string): {
  nodes: string[];
  tweaks: Array<{ nodeId: string; x: number; y: number; sig: string | null; orientation: MapOrientation }>;
  orientation: MapOrientation;
} {
  const rows = db()
    .prepare("SELECT node_id, x, y, pinned, structure_sig, orientation FROM topology_position WHERE view = ? ORDER BY node_id")
    .all(view) as Array<{ node_id: string; x: number; y: number; pinned: number; structure_sig: string | null; orientation: string | null }>;
  return {
    nodes: rows.map((r) => r.node_id),
    tweaks: rows
      .filter((r) => r.pinned === 1)
      .map((r) => ({ nodeId: r.node_id, x: r.x, y: r.y, sig: r.structure_sig, orientation: tweakOrientationOf(r.orientation) })),
    orientation: getMapOrientation(asTopologyView(view)),
  };
}

function asTopologyView(view: string): TopologyView {
  if (view === "auto" || /^mappa:\d+$/.test(view)) return view as TopologyView;
  throw new Error(`Vista della mappa non valida: ${view}`);
}

/**
 * Salva i ritocchi fatti nell'orientamento `orientation`. Una riga per mappa e
 * oggetto: un ritocco nuovo sostituisce il vecchio anche se era dell'altro
 * orientamento (spec §12.2). L'appartenenza non cambia: la riga c'era già o nasce qui.
 */
export function saveTopologyTweaks(
  view: string,
  rows: Array<{ nodeId: string; x: number; y: number; sig: string }>,
  orientation: MapOrientation,
): void {
  runInTenantTransaction(() => {
    const ins = db().prepare(`
      INSERT INTO topology_position (view, node_id, x, y, pinned, structure_sig, orientation, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, datetime('now'))
      ON CONFLICT(view, node_id) DO UPDATE SET
        x = excluded.x, y = excluded.y, pinned = 1, structure_sig = excluded.structure_sig,
        orientation = excluded.orientation, updated_at = datetime('now')`);
    for (const r of rows) ins.run(view, r.nodeId, r.x, r.y, r.sig, orientation);
  });
}

/** Orientamento della mappa; senza riga (l'automatica prima della prima scelta, o una mappa che non c'è) è `lr`. */
export function getMapOrientation(view: TopologyView): MapOrientation {
  const r = (
    view === "auto"
      ? db().prepare("SELECT orientation FROM topology_maps WHERE kind = 'auto'").get()
      : db().prepare("SELECT orientation FROM topology_maps WHERE id = ? AND kind = 'passo'").get(Number(view.slice("mappa:".length)))
  ) as { orientation: string } | undefined;
  return r ? mapOrientationOf(r.orientation) : "lr";
}

/**
 * Cambia l'orientamento della mappa (spec §12.2). Per l'automatica la riga nasce
 * alla prima scelta, come per la testa; la testa e chi l'ha scelta non cambiano.
 */
export function setMapOrientation(view: TopologyView, orientation: MapOrientation, actor: string): Esito {
  return runInTenantTransaction((): Esito => {
    const d = db();
    if (view === "auto") {
      const r = d.prepare("UPDATE topology_maps SET orientation = ?, updated_at = datetime('now') WHERE kind = 'auto'").run(orientation);
      if (r.changes === 0) {
        d.prepare("INSERT INTO topology_maps (name, kind, roots, head_node, orientation, created_by) VALUES ('Tutta la rete', 'auto', '[]', NULL, ?, ?)")
          .run(orientation, actor);
      }
      return { ok: true };
    }
    const r = d
      .prepare("UPDATE topology_maps SET orientation = ?, updated_at = datetime('now') WHERE id = ? AND kind = 'passo'")
      .run(orientation, Number(view.slice("mappa:".length)));
    return r.changes > 0 ? { ok: true } : { ok: false, error: "Mappa non trovata" };
  });
}

/**
 * Riscrive gli id di una vista sull'id canonico del modello (revisione finale
 * I5): un host promosso o fuso cambia id, e la mappa salvata lo seguirebbe solo
 * in lettura. Lo chiama la pagina alla prima modifica della mappa, mai alla
 * lettura. Righe di topology_position (membri e ritocchi), partenze di una
 * passo passo e testa dell'automatica (senza cambiare chi l'ha scelta). Se il
 * nuovo id è già nella vista, la riga vecchia si toglie.
 */
export function renameTopologyNodes(view: string, renames: Array<{ from: string; to: string }>): void {
  if (renames.length === 0) return;
  runInTenantTransaction(() => {
    const d = db();
    const has = d.prepare("SELECT 1 FROM topology_position WHERE view = ? AND node_id = ?");
    const del = d.prepare("DELETE FROM topology_position WHERE view = ? AND node_id = ?");
    const upd = d.prepare("UPDATE topology_position SET node_id = ?, updated_at = datetime('now') WHERE view = ? AND node_id = ?");
    for (const { from, to } of renames) {
      if (from === to) continue;
      if (has.get(view, to)) del.run(view, from);
      else upd.run(to, view, from);
    }
    const to = new Map(renames.map((r) => [r.from, r.to]));
    const m = /^mappa:(\d+)$/.exec(view);
    if (m) {
      const map = getTopologyMap(Number(m[1]));
      if (map && map.roots.some((r) => to.has(r))) {
        const roots = [...new Set(map.roots.map((r) => to.get(r) ?? r))];
        d.prepare("UPDATE topology_maps SET roots = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(roots), map.id);
      }
    } else if (view === "auto") {
      const head = getAutoMap()?.head_node;
      const next = head ? to.get(head) : undefined;
      if (next) d.prepare("UPDATE topology_maps SET head_node = ?, updated_at = datetime('now') WHERE kind = 'auto'").run(next);
    }
  });
}

/**
 * «Riordina»: nelle passo passo i nodi restano, i ritocchi spariscono; nell'automatica non c'è
 * appartenenza, si cancella. Con `orientation` solo i ritocchi di quell'orientamento (NULL = `tb`):
 * quelli dell'altro restano da parte (spec §12.2). Senza, tutti.
 */
export function clearTopologyTweaks(view: string, orientation?: MapOrientation): void {
  const d = db();
  const only = orientation ? " AND pinned = 1 AND COALESCE(orientation, 'tb') = ?" : "";
  const args = orientation ? [view, orientation] : [view];
  if (view === "auto") d.prepare(`DELETE FROM topology_position WHERE view = ?${only}`).run(...args);
  else {
    d.prepare(
      `UPDATE topology_position SET pinned = 0, x = 0, y = 0, structure_sig = NULL, orientation = NULL, updated_at = datetime('now') WHERE view = ?${only}`,
    ).run(...args);
  }
}

/** Testa della mappa automatica; la riga «Tutta la rete» nasce alla prima scrittura. */
export function setAutoHead(nodeId: string | null, author: string): void {
  runInTenantTransaction(() => {
    const d = db();
    // Sulla riga «auto» created_by è chi ha scelto la testa per ultimo: la pagina scrive «scelta da <autore>».
    const r = d.prepare("UPDATE topology_maps SET head_node = ?, created_by = ?, updated_at = datetime('now') WHERE kind = 'auto'").run(nodeId, author);
    if (r.changes === 0) {
      d.prepare("INSERT INTO topology_maps (name, kind, roots, head_node, created_by) VALUES ('Tutta la rete', 'auto', '[]', ?, ?)").run(nodeId, author);
    }
  });
}

export function setNodeHidden(deviceId: number, hidden: boolean): Esito {
  const r = db().prepare("UPDATE network_devices SET topology_hidden = ? WHERE id = ?").run(hidden ? 1 : 0, deviceId);
  return r.changes > 0 ? { ok: true } : { ok: false, error: "Apparato non trovato" };
}

/**
 * «Ruolo nella mappa» (T1b, spec §13.8.2): '' decide il sistema, 'rete' apparato di rete, 'attaccato' foglia (server, PC);
 * da T3 (§13.9) 'core' e 'accesso', che il modello di T1 legge «rete» (`ruoloLetto`). Colonna senza CHECK: valida Zod.
 */
export function setTopologyRole(deviceId: number, role: "" | "rete" | "attaccato" | "core" | "accesso"): Esito {
  const r = db().prepare("UPDATE network_devices SET topology_role = ? WHERE id = ?").run(role, deviceId);
  return r.changes > 0 ? { ok: true } : { ok: false, error: "Apparato non trovato" };
}

// `extends` non accetta un `import(...)` diretto: passa da un alias di tipo.
type LinkOverrideRowT = import("@/lib/topology/model-types").LinkOverrideRow;

export interface LinkOverrideView extends LinkOverrideRowT {
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export function listLinkOverrides(): LinkOverrideView[] {
  return db().prepare("SELECT * FROM topology_link_overrides ORDER BY id").all() as LinkOverrideView[];
}

export function addLinkOverride(
  input: {
    action: "add" | "ignore"; a_node: string; a_port: string; b_node: string; b_port: string;
    /** Tipo del collegamento a mano (fase 2b, «tunnel» da T3); null = non indicato, sempre null per «ignore». */
    medium: LinkMedium | null;
    note: string | null;
  },
  author: string,
): number {
  const r = db().prepare(
    "INSERT INTO topology_link_overrides (action, a_node, a_port, b_node, b_port, medium, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(input.action, input.a_node, input.a_port, input.b_node, input.b_port, input.medium, input.note, author);
  return Number(r.lastInsertRowid);
}

/**
 * Modifica un collegamento aggiunto a mano (fase 2b, «Modifica porte»): cambiano
 * solo i campi presenti. Un «ignora» non si modifica (si toglie e si rifà).
 */
export function updateLinkOverride(
  id: number,
  patch: { a_port?: string; b_port?: string; medium?: LinkMedium | null; note?: string | null },
): "ok" | "assente" | "non_a_mano" {
  const d = db();
  const row = d.prepare("SELECT action FROM topology_link_overrides WHERE id = ?").get(id) as { action: string } | undefined;
  if (!row) return "assente";
  if (row.action !== "add") return "non_a_mano";
  const cols = (["a_port", "b_port", "medium", "note"] as const).filter((k) => patch[k] !== undefined);
  if (cols.length === 0) return "ok";
  d.prepare(`UPDATE topology_link_overrides SET ${cols.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...cols.map((k) => patch[k] ?? null), id);
  return "ok";
}

/**
 * Toglie una correzione. Se è un collegamento a mano, nella stessa transazione toglie anche la scelta
 * del principale fra gli stessi due oggetti (revisione finale M-3): altrimenti la riga restava, e un
 * collegamento automatico comparso dopo fra quei due diventava «★ scelto a mano» senza che nessuno
 * l'avesse scelto. Ripristinare un «ignora» non tocca i principali.
 * `perCavo` (mappa nuova accesa, T3): toglie solo la ★ con le stesse porte della correzione tolta, nei due versi
 * (ADR 0010 N-2 superato, §13.9); una ★ della coppia su altre porte resta e vale per il migliore della coppia. Le porte
 * non sono mai NULL (`NOT NULL DEFAULT ''`): una correzione senza porte toglie la ★ senza porte della coppia, che è
 * quella messa sul suo cavo (la linea senza porte scrive '' e ''); tenerla rifarebbe M-3. Porte confrontate come sono
 * scritte: una ★ che non coincide resta, mai tolta per somiglianza.
 * Senza, come oggi: ogni ★ della coppia.
 */
export function deleteLinkOverride(id: number, opz?: { perCavo?: boolean }): boolean {
  const d = db();
  return d.transaction((): boolean => {
    const row = d.prepare("SELECT action, a_node, a_port, b_node, b_port FROM topology_link_overrides WHERE id = ?").get(id) as
      | { action: string; a_node: string; a_port: string; b_node: string; b_port: string }
      | undefined;
    if (!row) return false;
    d.prepare("DELETE FROM topology_link_overrides WHERE id = ?").run(id);
    if (row.action === "add" && opz?.perCavo === true) {
      d.prepare(
        `DELETE FROM topology_link_primary
         WHERE (node_id = ? AND other_node = ? AND node_port = ? AND other_port = ?)
            OR (node_id = ? AND other_node = ? AND node_port = ? AND other_port = ?)`,
      ).run(row.a_node, row.b_node, row.a_port, row.b_port, row.b_node, row.a_node, row.b_port, row.a_port);
    } else if (row.action === "add") {
      d.prepare("DELETE FROM topology_link_primary WHERE (node_id = ? AND other_node = ?) OR (node_id = ? AND other_node = ?)")
        .run(row.a_node, row.b_node, row.b_node, row.a_node);
    }
    return true;
  })();
}

/**
 * I collegamenti principali scelti a mano (spec §11.3, «★ Rendi principale»):
 * per ogni oggetto `node_id`, il collegamento verso `other_node` su quelle porte.
 * Una lettura in blocco per il modello (tappa E); le scritture le fanno le rotte.
 */
export function listTopologyLinkPrimaries(): Array<{ node_id: string; other_node: string; node_port: string; other_port: string }> {
  return db()
    .prepare("SELECT node_id, other_node, node_port, other_port FROM topology_link_primary ORDER BY node_id")
    .all() as Array<{ node_id: string; other_node: string; node_port: string; other_port: string }>;
}

/** «★ Rendi principale» (spec §11.3): una scelta per oggetto; una nuova sostituisce quella di prima. */
export function setTopologyLinkPrimary(
  input: { node_id: string; other_node: string; node_port: string; other_port: string },
  author: string,
): void {
  db().prepare(
    `INSERT INTO topology_link_primary (node_id, other_node, node_port, other_port, set_by, set_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(node_id) DO UPDATE SET other_node = excluded.other_node, node_port = excluded.node_port,
       other_port = excluded.other_port, set_by = excluded.set_by, set_at = excluded.set_at`,
  ).run(input.node_id, input.other_node, input.node_port, input.other_port, author);
}

/** «Togli la scelta»: il principale torna a sceglierlo il sistema. true se c'era una scelta. */
export function deleteTopologyLinkPrimary(nodeId: string): boolean {
  return db().prepare("DELETE FROM topology_link_primary WHERE node_id = ?").run(nodeId).changes > 0;
}

/**
 * Porte note di un oggetto per «Collega a…» (GET /api/topology/ports): per un
 * apparato le sue porte (`switch_ports`), oppure, se non ne ha, le schede della
 * scansione Proxmox dell'host che è lui. Host e VM: nessuna porta nota (elenco
 * vuoto). null = apparato inesistente.
 */
export function getTopologyKnownPorts(nodeId: string): KnownPort[] | null {
  const m = /^dev:(\d+)$/.exec(nodeId);
  if (!m) return [];
  const d = db();
  const id = Number(m[1]);
  const dev = d.prepare("SELECT id, host, name FROM network_devices WHERE id = ?").get(id) as { id: number; host: string; name: string } | undefined;
  if (!dev) return null;
  const ports = d.prepare(
    "SELECT port_name, speed, poe_power_mw, status, is_uplink, is_trunk FROM switch_ports WHERE device_id = ? ORDER BY port_index",
  ).all(id) as SwitchPortRow[];
  if (ports.length > 0) return switchPortsToKnown(ports);
  const scans = d.prepare(
    "SELECT id, last_proxmox_scan_result AS raw FROM network_devices WHERE last_proxmox_scan_result IS NOT NULL AND last_proxmox_scan_result <> '' ORDER BY id",
  ).all() as Array<{ id: number; raw: string }>;
  return hypervisorNics({ id: dev.id, host: dev.host ?? "", name: dev.name ?? "" }, scans);
}

// ═══════════════════════════════════════════════════════════════════════════
// ACQUISIZIONE MODULARE — snapshot dei collector, scelta del caso dubbio, modifiche (piano 2026-10-21 C1-C2)
// Tabelle in DDL_ACQUISIZIONE_MODULARE (db-tenant-schema.ts). Compressione e validazione stanno in
// `acquisizione-modulare/archivio.ts`: qui solo righe.
// ═══════════════════════════════════════════════════════════════════════════

/** Impostazione del tenant: «1» = acceso; assente o altro = spento (l'opposto di `patch.choco_automatico`). */
export const CHIAVE_ACQUISIZIONE_MODULARE = "acquisizione_modulare.attiva";

export function acquisizioneModulareAccesa(): boolean {
  const r = db().prepare("SELECT value FROM tenant_settings WHERE key = ?").get(CHIAVE_ACQUISIZIONE_MODULARE) as { value: string } | undefined;
  return r?.value === "1";
}

export function impostaAcquisizioneModulare(acceso: boolean): void {
  db().prepare(
    `INSERT INTO tenant_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(CHIAVE_ACQUISIZIONE_MODULARE, acceso ? "1" : "0");
}

export interface SceltaFonteAcquisizione { scelta: string; chosen_by_name: string | null; chosen_at: string }

/** La scelta fatta a mano nel caso dubbio, o null (la fonte si ricava da sola). */
export function sceltaFonteAcquisizione(deviceId: number): SceltaFonteAcquisizione | null {
  return (db().prepare("SELECT scelta, chosen_by_name, chosen_at FROM acquisition_source_choices WHERE device_id = ?").get(deviceId) as SceltaFonteAcquisizione | undefined) ?? null;
}

export function salvaSceltaFonteAcquisizione(deviceId: number, scelta: string, utente: { id: number | null; nome: string | null } | null): void {
  db().prepare(
    `INSERT INTO acquisition_source_choices (device_id, scelta, chosen_by, chosen_by_name, chosen_at) VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(device_id) DO UPDATE SET scelta = excluded.scelta, chosen_by = excluded.chosen_by, chosen_by_name = excluded.chosen_by_name, chosen_at = excluded.chosen_at`,
  ).run(deviceId, scelta, utente?.id ?? null, utente?.nome ?? null);
}

export function togliSceltaFonteAcquisizione(deviceId: number): boolean {
  return db().prepare("DELETE FROM acquisition_source_choices WHERE device_id = ?").run(deviceId).changes > 0;
}

/** Una riga di `acquisition_snapshots` da scrivere (payload già compresso e validato da chi chiama). */
export interface SnapshotAcquisizioneIn {
  device_id: number;
  collector: string;
  collector_version: string;
  schema_version: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  status: string;
  section_status: string;
  warning_count: number;
  credenziali: string;
  requested_by: number | null;
  requested_by_name: string | null;
  trigger: string;
  payload: Buffer;
  payload_bytes: number;
  payload_gzip_bytes: number;
  sha256: string;
}

/** Colonne piccole: la lista non porta mai il payload. */
export type SnapshotAcquisizioneRiga = Omit<SnapshotAcquisizioneIn, "payload"> & { id: number; created_at: string };

const COLONNE_SNAPSHOT_PICCOLE = "id, device_id, collector, collector_version, schema_version, started_at, finished_at, duration_ms, status, section_status, warning_count, credenziali, requested_by, requested_by_name, trigger, payload_bytes, payload_gzip_bytes, sha256, created_at";

/** Snapshot da tenere per apparato (D5): gli ultimi tanti, più il primo e l'ultimo `ok`. */
export const SNAPSHOT_TENUTI = 20;

/**
 * Inserisce uno snapshot e applica la retention D5 dello stesso apparato, in una transazione: restano gli ultimi
 * `SNAPSHOT_TENUTI` per `finished_at`, più il primo e l'ultimo con stato `ok`. Un errore non spinge mai fuori l'ultimo
 * snapshot riuscito. Le modifiche (`acquisition_changes`) degli snapshot tolti vanno via a cascata.
 */
export function inserisciSnapshotAcquisizione(r: SnapshotAcquisizioneIn): number {
  const d = db();
  return d.transaction(() => {
    const id = Number(d.prepare(
      `INSERT INTO acquisition_snapshots (device_id, collector, collector_version, schema_version, started_at, finished_at, duration_ms, status,
         section_status, warning_count, credenziali, requested_by, requested_by_name, trigger, payload, payload_bytes, payload_gzip_bytes, sha256)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(r.device_id, r.collector, r.collector_version, r.schema_version, r.started_at, r.finished_at, r.duration_ms, r.status,
      r.section_status, r.warning_count, r.credenziali, r.requested_by, r.requested_by_name, r.trigger, r.payload, r.payload_bytes,
      r.payload_gzip_bytes, r.sha256).lastInsertRowid);
    d.prepare(
      `DELETE FROM acquisition_snapshots WHERE device_id = ?
         AND id NOT IN (SELECT id FROM acquisition_snapshots WHERE device_id = ? ORDER BY finished_at DESC, id DESC LIMIT ?)
         AND id NOT IN (SELECT id FROM acquisition_snapshots WHERE device_id = ? AND status = 'ok' ORDER BY finished_at ASC, id ASC LIMIT 1)
         AND id NOT IN (SELECT id FROM acquisition_snapshots WHERE device_id = ? AND status = 'ok' ORDER BY finished_at DESC, id DESC LIMIT 1)`,
    ).run(r.device_id, r.device_id, SNAPSHOT_TENUTI, r.device_id, r.device_id);
    return id;
  })();
}

/** Elenco paginato (regola 9), dal più recente, senza payload. */
export function elencoSnapshotAcquisizione(deviceId: number, limit: number, offset: number): { righe: SnapshotAcquisizioneRiga[]; totale: number } {
  const d = db();
  const righe = d.prepare(
    `SELECT ${COLONNE_SNAPSHOT_PICCOLE} FROM acquisition_snapshots WHERE device_id = ? ORDER BY finished_at DESC, id DESC LIMIT ? OFFSET ?`,
  ).all(deviceId, limit, offset) as SnapshotAcquisizioneRiga[];
  const totale = (d.prepare("SELECT COUNT(*) AS n FROM acquisition_snapshots WHERE device_id = ?").get(deviceId) as { n: number }).n;
  return { righe, totale };
}

/** Uno snapshot dell'apparato col payload compresso; null se non c'è o è di un altro apparato. */
export function leggiSnapshotAcquisizione(deviceId: number, snapshotId: number): (SnapshotAcquisizioneRiga & { payload: Buffer }) | null {
  return (db().prepare(`SELECT ${COLONNE_SNAPSHOT_PICCOLE}, payload FROM acquisition_snapshots WHERE id = ? AND device_id = ?`)
    .get(snapshotId, deviceId) as (SnapshotAcquisizioneRiga & { payload: Buffer }) | undefined) ?? null;
}

/**
 * L'ultimo snapshot non in errore dell'apparato fra quelli dei collector dati, senza payload (decisione a di fine giro 2:
 * i giri pianificati lasciano al collector le colonne che ha letto). null se non ce n'è.
 */
export function ultimoSnapshotNonInErrore(deviceId: number, collectors: readonly string[]): SnapshotAcquisizioneRiga | null {
  if (collectors.length === 0) return null;
  return (db().prepare(
    `SELECT ${COLONNE_SNAPSHOT_PICCOLE} FROM acquisition_snapshots WHERE device_id = ? AND status != 'error'
       AND collector IN (${collectors.map(() => "?").join(",")}) ORDER BY finished_at DESC, id DESC LIMIT 1`,
  ).get(deviceId, ...collectors) as SnapshotAcquisizioneRiga | undefined) ?? null;
}

/** Una modifica fatta (o rifiutata) da uno snapshot sull'apparato. `esito`: scritto, aggiunta, tolta, manuale. */
export interface ModificaAcquisizione {
  destinazione: string;
  chiave: string;
  campo: string;
  prima: string | null;
  dopo: string | null;
  esito: string;
}

export function modificheSnapshotAcquisizione(snapshotId: number, limit: number): { righe: ModificaAcquisizione[]; totale: number } {
  const d = db();
  const righe = d.prepare("SELECT destinazione, chiave, campo, prima, dopo, esito FROM acquisition_changes WHERE snapshot_id = ? ORDER BY id LIMIT ?")
    .all(snapshotId, limit) as ModificaAcquisizione[];
  const totale = (d.prepare("SELECT COUNT(*) AS n FROM acquisition_changes WHERE snapshot_id = ?").get(snapshotId) as { n: number }).n;
  return { righe, totale };
}

/** Le porte dell'apparato con i soli campi che la proiezione dei collector conosce (`acquisition/proiezioni`). */
export function portePerProiezione(deviceId: number): PortaAttuale[] {
  return db().prepare(`SELECT port_index, port_name, ${CAMPI_PORTA.join(", ")} FROM switch_ports WHERE device_id = ? ORDER BY port_index`)
    .all(deviceId) as PortaAttuale[];
}

/**
 * Scrive le porte PER CAMPO (scoperta 5 del piano, C2.2): un campo assente dalle modifiche resta com'è, `null` si scrive
 * (letto e vuoto); una porta si toglie solo se la proiezione lo dice (sezione `interfaces` con stato `ok`). Colonne da un
 * elenco chiuso (`CAMPI_PORTA`), mai dal dato. `upsertSwitchPorts`, che UniFi e SNMP usano, non cambia. Chi chiama apre la
 * transazione (l'applicazione di uno snapshot è una sola).
 */
export function scriviPortePerCampo(deviceId: number, m: ModifichePorte): void {
  const d = db();
  const ammessa = (c: string): c is CampoPorta => (CAMPI_PORTA as readonly string[]).includes(c);
  for (const u of m.aggiorna) {
    const cols = Object.keys(u.campi).filter(ammessa);
    if (cols.length === 0) continue;
    d.prepare(`UPDATE switch_ports SET ${cols.map((c) => `${c} = ?`).join(", ")}, timestamp = datetime('now') WHERE device_id = ? AND port_index = ?`)
      .run(...cols.map((c) => u.campi[c] ?? null), deviceId, u.port_index);
  }
  for (const a of m.aggiungi) {
    const cols = Object.keys(a.campi).filter(ammessa);
    d.prepare(`INSERT INTO switch_ports (device_id, port_index, port_name${cols.map((c) => `, ${c}`).join("")}) VALUES (?, ?, ?${cols.map(() => ", ?").join("")})`)
      .run(deviceId, a.port_index, a.port_name, ...cols.map((c) => a.campi[c] ?? null));
  }
  const del = d.prepare("DELETE FROM switch_ports WHERE device_id = ? AND port_index = ?");
  for (const t of m.togli) del.run(deviceId, t.port_index);
}

/** L'host abbinato all'apparato come lo trova `syncDeviceToHost` (stesso IP), coi campi che l'apparato gli passa. */
export function hostPerProiezione(deviceId: number): ({ id: number } & Record<CampoHost, string | null>) | null {
  return (db().prepare(
    `SELECT h.id, h.model, h.firmware, h.serial_number FROM network_devices nd JOIN hosts h ON h.ip = nd.host WHERE nd.id = ? ORDER BY h.id LIMIT 1`,
  ).get(deviceId) as ({ id: number } & Record<CampoHost, string | null>) | undefined) ?? null;
}

/** Campi dell'apparato o dell'host dalla proiezione dell'identità. Elenchi chiusi. */
export function scriviCampiIdentita(tabella: "network_devices" | "hosts", id: number, campi: ReadonlyArray<{ campo: string; dopo: string }>): void {
  const ammessi: readonly string[] = tabella === "network_devices" ? CAMPI_IDENTITA : CAMPI_HOST;
  const ok = campi.filter((c) => ammessi.includes(c.campo));
  if (ok.length === 0) return;
  const extra = tabella === "network_devices" ? ", last_info_update = datetime('now')" : "";
  db().prepare(`UPDATE ${tabella} SET ${ok.map((c) => `${c.campo} = ?`).join(", ")}, updated_at = datetime('now')${extra} WHERE id = ?`)
    .run(...ok.map((c) => c.dopo), id);
}

export function inserisciModificheAcquisizione(snapshotId: number, deviceId: number, righe: readonly ModificaAcquisizione[]): void {
  const ins = db().prepare("INSERT INTO acquisition_changes (snapshot_id, device_id, destinazione, chiave, campo, prima, dopo, esito) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const r of righe) ins.run(snapshotId, deviceId, r.destinazione, r.chiave, r.campo, r.prima, r.dopo, r.esito);
}

/** Le chiavi dei vicini dell'apparato già scritti, di qualunque fonte: per dire quali vicini sono nuovi. */
export function chiaviViciniApparato(deviceId: number): Set<string> {
  const righe = db().prepare("SELECT local_port, remote_device_name, remote_port FROM device_neighbors WHERE device_id = ?").all(deviceId) as Array<{ local_port: string; remote_device_name: string; remote_port: string }>;
  return new Set(righe.map((r) => `${r.local_port}\u0000${r.remote_device_name}\u0000${r.remote_port}`));
}

// ═══════════════════════════════════════════════════════════════════════════
// Scansione automatica dei device scelti (piano 2026-10-22, Task 3)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Le colonne dello stato di un apparato per il job `apparati_scelti`, in UNA query (niente N+1). Le credenziali con
 * sottoquery correlate sugli indici di `host_credentials(host_id)` e `device_credential_bindings(device_id)`.
 * `ha_snmp` è la regola di `haSnmpApparatoDb` (fonti dell'apparato: un binding SNMP non fallito con una voce di tipo
 * snmp/snmp_v3) scritta in SQL, perché `haSnmpApparato` fa tre letture per apparato e qui sarebbe un N+1 (50 apparati,
 * 150 query). Vale per gli apparati salvati (le voci provvisorie della finestra non passano di qui). Serve a
 * `leggibile` e a `vlan_switch`; il giro legge poi con le funzioni vere. La prova `apparati-scelti/__tests__/db.test.ts`
 * la confronta con `haSnmpApparato`, `vlanSwitchDaLeggere` e `resolveDeviceAcquisition`: se il motore cambia, lo dice.
 */
const COLONNE_STATO_APPARATO = `
  nd.id AS device_id, nd.name AS dev_nome, nd.enabled AS dev_enabled, nd.device_type, nd.vendor, nd.protocol,
  nd.classification, nd.snmp_credential_id, nd.scan_target, nd.product_profile, nd.use_for_arp_poll,
  h.id AS host_id, h.ip AS host_ip, COALESCE(h.custom_name, h.hostname) AS host_nome, h.classification AS host_classification,
  (SELECT COUNT(*) FROM host_credentials hc WHERE hc.host_id = h.id) AS cred_host,
  (SELECT COUNT(*) FROM host_credentials hc WHERE hc.host_id = h.id AND hc.validated = 1) AS validate_host,
  (SELECT COUNT(*) FROM device_credential_bindings b WHERE b.device_id = nd.id AND b.credential_id IS NOT NULL) AS cred_binding,
  (SELECT COUNT(*) FROM device_credential_bindings b WHERE b.device_id = nd.id AND b.test_status = 'success') AS binding_riusciti,
  EXISTS (SELECT 1 FROM device_credential_bindings b JOIN credentials c ON c.id = b.credential_id
           WHERE b.device_id = nd.id AND b.protocol_type = 'snmp' AND b.test_status != 'failed'
             AND c.credential_type IN ('snmp', 'snmp_v3')) AS ha_snmp`;

interface RigaStatoApparato {
  device_id: number | null;
  dev_nome: string | null;
  dev_enabled: number | null;
  device_type: string | null;
  vendor: string | null;
  protocol: string | null;
  classification: string | null;
  snmp_credential_id: number | null;
  scan_target: string | null;
  product_profile: string | null;
  use_for_arp_poll: number | null;
  host_id: number | null;
  host_ip: string | null;
  host_nome: string | null;
  host_classification: string | null;
  cred_host: number;
  validate_host: number;
  cred_binding: number;
  binding_riusciti: number;
  ha_snmp: number;
}

/**
 * Da una riga allo `StatoApparato` di `regole.ts`. `leggibile`, `usa_arp` e `vlan_switch` con le funzioni pure di
 * «Interroga» e del giro ARP (`resolveDeviceAcquisition`, `networkDeviceUsesArpPoll`, la regola di `vlanSwitchDaLeggere`).
 * Le credenziali memorizzate: le righe dell'host e i binding con una voce (quelli inline il motore non li legge più).
 */
function statoDaRiga(r: RigaStatoApparato): StatoApparato {
  const haSnmp = r.ha_snmp === 1;
  const conApparato = r.device_id != null && r.device_type != null;
  const dev = {
    device_type: r.device_type ?? undefined,
    vendor: r.vendor ?? undefined,
    protocol: r.protocol ?? undefined,
    classification: r.classification,
    snmp_credential_id: r.snmp_credential_id,
    scan_target: r.scan_target,
    product_profile: r.product_profile,
    use_for_arp_poll: r.use_for_arp_poll,
  };
  const sessioneSnmp = r.protocol === "snmp_v2" || r.protocol === "snmp_v3" || haSnmp;
  return {
    host_id: r.host_id,
    device_id: r.device_id,
    enabled: conApparato ? r.dev_enabled !== 0 : true,
    credenziali_memorizzate: r.cred_host + r.cred_binding,
    validate_sul_host: r.host_id != null ? r.validate_host : null,
    binding_riusciti: r.binding_riusciti,
    leggibile: conApparato ? resolveDeviceAcquisition(dev, haSnmp).implemented : false,
    tipo: {
      device_type: r.device_type ?? "",
      vendor: r.vendor,
      protocol: r.protocol,
      usa_arp: conApparato ? networkDeviceUsesArpPoll({ device_type: r.device_type as NetworkDevice["device_type"], vendor: r.vendor as NetworkDevice["vendor"], use_for_arp_poll: r.use_for_arp_poll }) : false,
      vlan_switch: r.device_type === "switch" && !(r.vendor === "mikrotik" && r.protocol === "ssh") && sessioneSnmp,
    },
  };
}

/**
 * Lo stato degli host scelti in Discovery (finestra J2), in una query. L'apparato di un host: quello collegato
 * (`network_devices.host_id`), altrimenti quello con lo stesso IP (come lo vede Discovery). Un id inesistente non compare.
 */
export function statoApparatiPerHost(hostIds: number[]): Array<StatoApparato & { host_id: number; nome: string; ip: string; tipo_scheda: string }> {
  if (hostIds.length === 0) return [];
  const righe = db().prepare(`
    SELECT ${COLONNE_STATO_APPARATO}
      FROM hosts h
      LEFT JOIN network_devices nd ON nd.id = COALESCE(
        (SELECT MIN(x.id) FROM network_devices x WHERE x.host_id = h.id),
        (SELECT MIN(x.id) FROM network_devices x WHERE x.host = h.ip))
     WHERE h.id IN (${hostIds.map(() => "?").join(",")})
     ORDER BY h.id`).all(...hostIds) as RigaStatoApparato[];
  return righe.map((r) => ({
    ...statoDaRiga(r),
    host_id: r.host_id as number,
    nome: r.dev_nome ?? r.host_nome ?? r.host_ip ?? "",
    ip: r.host_ip ?? "",
    tipo_scheda: r.device_type ?? r.host_classification ?? "unknown",
  }));
}

/**
 * Lo stato degli apparati di un job (il giro), in una query. L'host di un apparato: quello collegato, altrimenti
 * quello con lo stesso IP. Un id che non c'è più resta fuori dalla mappa: per il giro è TOLTO.
 */
export function statoApparatiPerDevice(deviceIds: number[]): Map<number, StatoApparato & { nome: string }> {
  const out = new Map<number, StatoApparato & { nome: string }>();
  if (deviceIds.length === 0) return out;
  const righe = db().prepare(`
    SELECT ${COLONNE_STATO_APPARATO}
      FROM network_devices nd
      LEFT JOIN hosts h ON h.id = COALESCE(
        (SELECT x.id FROM hosts x WHERE x.id = nd.host_id),
        (SELECT MIN(x.id) FROM hosts x WHERE x.ip = nd.host))
     WHERE nd.id IN (${deviceIds.map(() => "?").join(",")})`).all(...deviceIds) as RigaStatoApparato[];
  for (const r of righe) out.set(r.device_id as number, { ...statoDaRiga(r), nome: r.dev_nome ?? "" });
  return out;
}

/** L'ultimo giro di un job: toglie le righe del giro prima e scrive queste, in una transazione. Uno stato fuori elenco lancia. */
export function scriviEsitiGiro(
  jobId: number,
  giroIl: string,
  righe: Array<{ device_id: number; stato: StatoEsito; letture: Record<string, EsitoLettura>; motivo?: string | null }>,
): void {
  for (const r of righe) {
    if (!(STATI_ESITO as readonly string[]).includes(r.stato)) throw new Error(`Stato d'esito non previsto: ${String(r.stato)}`);
  }
  const d = db();
  d.transaction(() => {
    d.prepare("DELETE FROM job_apparati_esiti WHERE job_id = ?").run(jobId);
    const ins = d.prepare("INSERT INTO job_apparati_esiti (job_id, device_id, giro_il, stato, letture, motivo) VALUES (?, ?, ?, ?, ?, ?)");
    for (const r of righe) ins.run(jobId, r.device_id, giroIl, r.stato, JSON.stringify(r.letture), r.motivo ?? null);
  })();
}

/** Gli esiti dell'ultimo giro di un job, col nome dell'apparato (null se l'apparato è stato tolto). */
export function leggiEsitiJob(jobId: number): { giro_il: string | null; righe: Array<EsitoRiga & { nome: string | null; host_id: number | null }> } {
  const righe = db().prepare(`
    SELECT e.device_id, e.giro_il, e.stato, e.letture, e.motivo, nd.name AS nome, nd.host_id
      FROM job_apparati_esiti e
      LEFT JOIN network_devices nd ON nd.id = e.device_id
     WHERE e.job_id = ?
     ORDER BY e.device_id`).all(jobId) as Array<Omit<EsitoRiga, "letture"> & { letture: string; nome: string | null; host_id: number | null }>;
  const out = righe.map((r) => {
    let letture: Record<string, EsitoLettura> = {};
    try {
      letture = JSON.parse(r.letture) as Record<string, EsitoLettura>;
    } catch {
      // Scritte solo da scriviEsitiGiro: una riga illeggibile mostra lo stato senza il dettaglio delle letture.
      console.warn(`[apparati_scelti] job #${jobId}: letture illeggibili per l'apparato #${r.device_id}`);
    }
    return { ...r, letture };
  });
  const giro = out.reduce<string | null>((max, r) => (max == null || r.giro_il > max ? r.giro_il : max), null);
  return { giro_il: giro, righe: out };
}

/**
 * Il riassunto di J3 («✓ 3/3», «▲ 2/3 · 1 escluso») per più job, in una query, dalle righe dell'ultimo `giro_il`:
 * letti = `ok`, parziali a parte (la pastiglia li distingue). Un job che non ha mai girato non compare.
 */
export function riassuntiEsitiJobs(jobIds: number[]): Map<number, { letti: number; parziali: number; totale: number; esclusi: number; giro_il: string }> {
  const out = new Map<number, { letti: number; parziali: number; totale: number; esclusi: number; giro_il: string }>();
  if (jobIds.length === 0) return out;
  const righe = db().prepare(`
    SELECT e.job_id,
           SUM(CASE WHEN e.stato = 'ok' THEN 1 ELSE 0 END) AS letti,
           SUM(CASE WHEN e.stato = 'parziale' THEN 1 ELSE 0 END) AS parziali,
           COUNT(*) AS totale,
           SUM(CASE WHEN e.stato = 'escluso' THEN 1 ELSE 0 END) AS esclusi,
           MAX(e.giro_il) AS giro_il
      FROM job_apparati_esiti e
     WHERE e.job_id IN (${jobIds.map(() => "?").join(",")})
       AND e.giro_il = (SELECT MAX(u.giro_il) FROM job_apparati_esiti u WHERE u.job_id = e.job_id)
     GROUP BY e.job_id`).all(...jobIds) as Array<{ job_id: number; letti: number; parziali: number; totale: number; esclusi: number; giro_il: string }>;
  for (const r of righe) out.set(r.job_id, { letti: r.letti, parziali: r.parziali, totale: r.totale, esclusi: r.esclusi, giro_il: r.giro_il });
  return out;
}

/** I job `apparati_scelti` che contengono l'apparato (testata J4). Una config illeggibile non entra. */
export function jobsDelApparato(deviceId: number): Array<{ id: number; nome: string; enabled: boolean; interval_minutes: number; config: string; last_run: string | null }> {
  const righe = db().prepare(`
    SELECT sj.id, COALESCE(json_extract(sj.config, '$.nome'), 'Apparati scelti') AS nome, sj.enabled, sj.interval_minutes, sj.config, sj.last_run
      FROM scheduled_jobs sj
     WHERE sj.job_type = 'apparati_scelti'
       AND json_valid(sj.config)
       AND EXISTS (SELECT 1 FROM json_each(sj.config, '$.device_ids') j WHERE j.value = ?)
     ORDER BY sj.id`).all(deviceId) as Array<{ id: number; nome: string; enabled: number | null; interval_minutes: number; config: string; last_run: string | null }>;
  return righe.map((r) => ({ ...r, enabled: r.enabled === 1 }));
}

export function cancellaEsitiJob(jobId: number): void {
  db().prepare("DELETE FROM job_apparati_esiti WHERE job_id = ?").run(jobId);
}

/** Gli esiti dei job che non ci sono più (all'inizio di ogni giro). Restituisce le righe tolte. */
export function cancellaEsitiOrfani(): number {
  return db().prepare("DELETE FROM job_apparati_esiti WHERE job_id NOT IN (SELECT id FROM scheduled_jobs)").run().changes;
}

/**
 * «Modifica» di un job `apparati_scelti` (Task 6): intervallo e config insieme e, nella stessa transazione, gli esiti
 * degli apparati tolti dal job (J3 non deve contarli fino al giro dopo). `config` già validata dalla rotta. false = il
 * job non c'è o non è di quel tipo.
 */
export function aggiornaJobApparatiScelti(id: number, intervalMinutes: number, config: { device_ids: number[] } & Record<string, unknown>): boolean {
  const d = db();
  return d.transaction(() => {
    const cambiate = d.prepare(
      `UPDATE scheduled_jobs SET interval_minutes = ?, config = ?, next_run = datetime('now', '+' || ? || ' minutes'), updated_at = datetime('now')
        WHERE id = ? AND job_type = 'apparati_scelti'`,
    ).run(intervalMinutes, JSON.stringify(config), intervalMinutes, id).changes;
    if (cambiate === 0) return false;
    d.prepare(
      `DELETE FROM job_apparati_esiti WHERE job_id = ? AND device_id NOT IN (SELECT j.value FROM json_each(?) j)`,
    ).run(id, JSON.stringify(config.device_ids));
    return true;
  })();
}

/** L'ultimo esito di un apparato in ogni job che lo contiene (testata J4), in una query: job_id → stato e giro. */
export function esitiApparatoNeiJob(deviceId: number): Map<number, { stato: StatoEsito; giro_il: string }> {
  const righe = db().prepare(
    "SELECT job_id, stato, giro_il FROM job_apparati_esiti WHERE device_id = ?",
  ).all(deviceId) as Array<{ job_id: number; stato: StatoEsito; giro_il: string }>;
  return new Map(righe.map((r) => [r.job_id, { stato: r.stato, giro_il: r.giro_il }]));
}
