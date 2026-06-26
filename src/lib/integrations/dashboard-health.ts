/**
 * Overview dello stato di salute delle integrazioni configurate per il
 * tenant corrente. Usato dal widget "Integrazioni" in /dashboard.
 *
 * Solo lettura: nessun side effect, nessun health check live. I dati
 * vengono dalle tabelle già popolate dai sync job. Lo stato "error"
 * è autoritativo (auto_disabled_at su scanner, last_sync_status su AD,
 * ecc.) — niente probe HTTP qui per non pesare sulla dashboard.
 */
import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";
import { isWazuhConfigured, isWazuhIndexerConfigured } from "./wazuh-config";
import { getIntegrationConfig } from "./config";

export type IntegrationStatus = "ok" | "warning" | "error" | "stale" | "never";

export interface IntegrationHealth {
  key: string;
  label: string;
  status: IntegrationStatus;
  lastSync: string | null;
  message: string | null;
  href: string;
}

interface ScheduledJobRow {
  id: number;
  job_type: string;
  enabled: number;
  last_run: string | null;
  interval_minutes: number;
}

interface VulnScannerRow {
  id: number;
  name: string;
  enabled: number;
  last_sync_at: string | null;
  last_error: string | null;
  auto_disabled_at: string | null;
  consecutive_errors: number;
}

interface AdRow {
  id: number;
  name: string;
  enabled: number;
  last_sync_at: string | null;
  last_sync_status: string | null;
}

/** "stale" = ultima sync più vecchia di 2× l'intervallo previsto. */
function classifyStaleness(lastRun: string | null, intervalMinutes: number): IntegrationStatus {
  if (!lastRun) return "never";
  const ageMs = Date.now() - new Date(lastRun).getTime();
  if (Number.isNaN(ageMs)) return "never";
  const thresholdMs = Math.max(intervalMinutes * 2, 60) * 60_000;
  return ageMs > thresholdMs ? "stale" : "ok";
}

export function getIntegrationsOverview(): IntegrationHealth[] {
  const code = getCurrentTenantCode();
  if (!code) return [];
  const db = getTenantDb(code);
  const out: IntegrationHealth[] = [];

  // ── Scanner-edge (vuln_sync) ──────────────────────────────────────
  const scanner = db
    .prepare(
      `SELECT id, name, enabled, last_sync_at, last_error, auto_disabled_at,
              COALESCE(consecutive_errors, 0) AS consecutive_errors
         FROM vuln_scanners ORDER BY id LIMIT 1`,
    )
    .get() as VulnScannerRow | undefined;
  if (scanner) {
    const job = db
      .prepare(
        "SELECT interval_minutes FROM scheduled_jobs WHERE job_type='vuln_sync' AND network_id IS NULL LIMIT 1",
      )
      .get() as { interval_minutes: number } | undefined;
    let status: IntegrationStatus;
    let message: string | null = null;
    if (scanner.auto_disabled_at) {
      status = "error";
      message = `Auto-disabilitato dopo ${scanner.consecutive_errors} errori`;
    } else if (scanner.enabled !== 1) {
      status = "warning";
      message = "Disabilitato manualmente";
    } else if (scanner.last_error) {
      status = "warning";
      message = scanner.last_error.slice(0, 120);
    } else {
      status = classifyStaleness(scanner.last_sync_at, job?.interval_minutes ?? 30);
    }
    out.push({
      key: "scanner_edge",
      label: scanner.name || "Scanner-Edge",
      status,
      lastSync: scanner.last_sync_at,
      message,
      href: "/settings?tab=moduli#module-edge",
    });
  }

  // ── Wazuh Manager (hub-level config + tenant job last_run) ────────
  if (isWazuhConfigured()) {
    const job = db
      .prepare(
        "SELECT enabled, last_run, interval_minutes FROM scheduled_jobs WHERE job_type='wazuh_sync' LIMIT 1",
      )
      .get() as ScheduledJobRow | undefined;
    const status: IntegrationStatus = !job?.enabled
      ? "warning"
      : classifyStaleness(job.last_run ?? null, job.interval_minutes ?? 60);
    out.push({
      key: "wazuh_manager",
      label: "Wazuh Manager",
      status,
      lastSync: job?.last_run ?? null,
      message: !job?.enabled ? "Sync disabilitata" : null,
      href: "/settings?tab=moduli#module-wazuh",
    });
  }

  // ── Wazuh Indexer (OpenSearch) ────────────────────────────────────
  if (isWazuhIndexerConfigured()) {
    // L'Indexer è interrogato dentro la stessa wazuh_sync job; non ha
    // contatori separati. Riusiamo last_run del wazuh_sync come proxy.
    const job = db
      .prepare(
        "SELECT enabled, last_run, interval_minutes FROM scheduled_jobs WHERE job_type='wazuh_sync' LIMIT 1",
      )
      .get() as ScheduledJobRow | undefined;
    const status: IntegrationStatus = !job?.enabled
      ? "warning"
      : classifyStaleness(job.last_run ?? null, job.interval_minutes ?? 60);
    out.push({
      key: "wazuh_indexer",
      label: "Wazuh Indexer (CVE)",
      status,
      lastSync: job?.last_run ?? null,
      message: null,
      href: "/settings?tab=moduli#module-wazuh",
    });
  }

  // ── LibreNMS ──────────────────────────────────────────────────────
  const lnms = getIntegrationConfig("librenms");
  if (lnms.mode !== "disabled" && lnms.url) {
    const job = db
      .prepare(
        "SELECT enabled, last_run, interval_minutes FROM scheduled_jobs WHERE job_type='librenms_sync' LIMIT 1",
      )
      .get() as ScheduledJobRow | undefined;
    const status: IntegrationStatus = !job
      ? "never"
      : !job.enabled
      ? "warning"
      : classifyStaleness(job.last_run ?? null, job.interval_minutes ?? 60);
    out.push({
      key: "librenms",
      label: "LibreNMS",
      status,
      lastSync: job?.last_run ?? null,
      message: !job ? "Job sync non schedulato" : null,
      href: "/settings?tab=moduli#module-librenms",
    });
  }

  // ── Active Directory ──────────────────────────────────────────────
  const adRows = db
    .prepare(
      `SELECT id, name, enabled, last_sync_at, last_sync_status
         FROM ad_integrations ORDER BY id`,
    )
    .all() as AdRow[];
  for (const ad of adRows) {
    let status: IntegrationStatus;
    let message: string | null = null;
    if (!ad.enabled) {
      status = "warning";
      message = "Disabilitata";
    } else if (ad.last_sync_status && ad.last_sync_status.toLowerCase().startsWith("err")) {
      status = "error";
      message = ad.last_sync_status.slice(0, 120);
    } else {
      const job = db
        .prepare(
          "SELECT interval_minutes FROM scheduled_jobs WHERE job_type='ad_sync' LIMIT 1",
        )
        .get() as { interval_minutes: number } | undefined;
      status = classifyStaleness(ad.last_sync_at, job?.interval_minutes ?? 360);
    }
    out.push({
      key: `ad_${ad.id}`,
      label: `Active Directory: ${ad.name}`,
      status,
      lastSync: ad.last_sync_at,
      message,
      href: "/active-directory",
    });
  }

  return out;
}
