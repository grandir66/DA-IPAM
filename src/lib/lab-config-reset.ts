/**
 * Reset configurazione di rete/lab per demo o pre-consegna cliente.
 * Svuota dati operativi del tenant (reti, ARP, DHCP, host, AD, inventario…)
 * ma preserva integrazioni appliance (vuln_scanners, moduli hub) e utenti hub.
 */
import { setSetting, setTenantOnboardingCompleted } from "./db-hub";
import { getTenantDb, resetConfiguration, withTenant } from "./db-tenant";
import { invalidateModulesHealth } from "./modules/health";
import type Database from "better-sqlite3";

/** Tabelle tenant aggiuntive oltre a resetConfiguration() — DELETE IF EXISTS. */
const EXTRA_TENANT_TABLES = [
  "scan_jobs",
  "scan_results",
  "job_runs",
  "snmp_profiles",
  "excluded_ips",
  "anomalies",
  "analytics_events",
  "services",
  "service_asset_dependencies",
  "software_inventory",
  "host_software",
  "vulnerability_findings",
  "patch_deployments",
  "patch_packages",
  "dns_zones",
  "dns_records",
] as const;

export interface LabConfigResetResult {
  tenantCode: string;
  clearedTables: string[];
  onboardingReset: true;
}

function tableExists(db: Database.Database, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function clearTableIfNonEmpty(db: Database.Database, table: string, cleared: string[]): void {
  if (!tableExists(db, table)) return;
  const n = (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;
  if (n === 0) return;
  db.prepare(`DELETE FROM "${table}"`).run();
  cleared.push(`${table}(${n})`);
}

/**
 * Azzera config rete/discovery del tenant e riapre il wizard onboarding.
 * Preserva: vuln_scanners, integrazioni hub, admin, vault, nmap_profiles, fingerprint rules.
 */
export function resetLabNetworkConfig(tenantCode: string): LabConfigResetResult {
  const cleared: string[] = [];

  withTenant(tenantCode, () => {
    resetConfiguration();
    cleared.push("core_network_data");

    const db = getTenantDb(tenantCode);
    for (const table of EXTRA_TENANT_TABLES) {
      clearTableIfNonEmpty(db, table, cleared);
    }

    if (tableExists(db, "settings")) {
      db.prepare(
        "INSERT INTO settings (key, value) VALUES ('onboarding_completed', '0') ON CONFLICT(key) DO UPDATE SET value='0'",
      ).run();
    }
  });

  setTenantOnboardingCompleted(tenantCode, false);
  setSetting("onboarding_completed", "0");
  invalidateModulesHealth(tenantCode);

  return {
    tenantCode,
    clearedTables: cleared,
    onboardingReset: true,
  };
}
