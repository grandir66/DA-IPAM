#!/usr/bin/env npx tsx
/**
 * Reset onboarding demo: tenant DEFAULT vuoto (no reti/device) ma integrazioni
 * appliance (edge/librenms/net-services), admin e vault credenziali intatti.
 *
 * Uso (container appliance-ipam):
 *   npx tsx scripts/reset-demo-onboarding.ts
 *   DA_IPAM_DATA=/opt/da-ipam/data npx tsx scripts/reset-demo-onboarding.ts
 */
import Database from "better-sqlite3";
import path from "path";

const DATA_DIR = process.env.DA_IPAM_DATA?.trim() || path.join(process.cwd(), "data");
const HUB = path.join(DATA_DIR, "hub.db");
const DEFAULT = path.join(DATA_DIR, "tenants", "DEFAULT.db");
const TENANT = "DEFAULT";

/** Tabelle tenant da svuotare (dati operativi / wizard onboarding). */
const TENANT_TABLES_TO_CLEAR = [
  "networks",
  "network_devices",
  "devices",
  "device_credentials",
  "device_services",
  "device_software",
  "device_ports",
  "arp_entries",
  "dhcp_leases",
  "dhcp_reservations",
  "dns_zones",
  "dns_records",
  "ad_domains",
  "ad_users",
  "ad_computers",
  "ad_groups",
  "scan_jobs",
  "scan_results",
  "scheduled_jobs",
  "job_runs",
  "credentials",
  "snmp_profiles",
  "excluded_ips",
  "anomalies",
  "analytics_events",
  "inventory_assets",
  "inventory_assignees",
  "inventory_locations",
  "inventory_licenses",
  "inventory_software",
  "services_nis2",
  "patch_deployments",
  "patch_packages",
];

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
  return !!row;
}

function main(): void {
  const hub = new Database(HUB);
  const tenant = new Database(DEFAULT);

  hub.pragma("journal_mode = WAL");
  tenant.pragma("journal_mode = WAL");

  const beforeOnb = hub
    .prepare("SELECT key, value FROM settings WHERE key LIKE 'onboarding%'")
    .all() as Array<{ key: string; value: string }>;

  hub.prepare("UPDATE settings SET value = '0' WHERE key = 'onboarding_completed'").run();
  hub.prepare(
    "INSERT INTO settings (key, value) VALUES ('onboarding_completed', '0') ON CONFLICT(key) DO UPDATE SET value='0'",
  ).run();
  hub.prepare(
    "INSERT INTO settings (key, value) VALUES (?, '0') ON CONFLICT(key) DO UPDATE SET value='0'",
  ).run(`onboarding_completed:${TENANT}`);

  const cleared: string[] = [];
  for (const table of TENANT_TABLES_TO_CLEAR) {
    if (!tableExists(tenant, table)) continue;
    const n = (tenant.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;
    if (n === 0) continue;
    tenant.prepare(`DELETE FROM "${table}"`).run();
    cleared.push(`${table}(${n})`);
  }

  // Flag onboarding nel tenant DB (se presente)
  if (tableExists(tenant, "settings")) {
    tenant
      .prepare(
        "INSERT INTO settings (key, value) VALUES ('onboarding_completed', '0') ON CONFLICT(key) DO UPDATE SET value='0'",
      )
      .run();
  }

  hub.close();
  tenant.close();

  console.log("[reset-demo-onboarding] OK");
  console.log("  hub:", HUB);
  console.log("  tenant:", DEFAULT);
  console.log("  onboarding prima:", beforeOnb);
  console.log("  tabelle svuotate:", cleared.length ? cleared.join(", ") : "(nessuna — già vuote)");
  console.log("  integrazioni hub + admin + vuln_scanners: preservati");
}

main();
