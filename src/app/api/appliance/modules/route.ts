import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { listCredentials } from "@/lib/credentials-vault";
import { getIntegrationConfig } from "@/lib/integrations/config";
import { getWazuhConfig } from "@/lib/integrations/wazuh-config";
import { getNetServicesState } from "@/lib/network-services/feature";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";

/**
 * Catalog statico dei moduli ufficiali dell'appliance Domarc.
 * Ogni modulo dichiara come va rilevato (detector) + URL UI canonico.
 *
 * `status` viene calcolato a runtime joinando system_credentials
 * (popolato dal bootstrap launchpad) + le integration config esistenti.
 */
export interface ApplianceModuleInfo {
  key: string;
  label: string;
  category: "core" | "siem" | "logs" | "nms" | "network" | "va";
  description: string;
  installed: boolean;
  /** URL UI accessibile dal browser cliente (LAN). null se modulo non installato. */
  uiUrl: string | null;
  /** URL API interno (Docker network o /28). Solo info: NON cliccabile dal browser. */
  apiUrl: string | null;
  /** Versione modulo (se nota). */
  version: string | null;
  /** Note operative (recovery, install command, ecc). */
  note?: string;
}

interface SystemCredentialLite {
  id: number;
  kind: string;
  label: string;
  url: string | null;
}

function findLaunchpadEntry(
  creds: SystemCredentialLite[],
  kind: string,
  labelContains: string,
): SystemCredentialLite | null {
  return (
    creds.find(
      (c) =>
        c.kind === kind &&
        c.url &&
        /^https?:\/\//.test(c.url) &&
        c.label.toLowerCase().includes(labelContains.toLowerCase()),
    ) ?? null
  );
}

export async function GET() {
  return withTenantFromSession(async () => {
    const authErr = await requireAuth();
    if (isAuthError(authErr)) return authErr;
    const tenantCode = getCurrentTenantCode() ?? "DEFAULT";

    const creds = listCredentials() as SystemCredentialLite[];

    const modules: ApplianceModuleInfo[] = [];

    // --- DA-IPAM (core, sempre installato — questo è DA-IPAM stesso)
    const ipamEntry = findLaunchpadEntry(creds, "other", "DA-IPAM");
    modules.push({
      key: "da-ipam",
      label: "DA-IPAM",
      category: "core",
      description: "Hub UI cliente, asset/network mgmt, DB SQLite, integrations adapter",
      installed: true,
      uiUrl: ipamEntry?.url ?? "/",
      apiUrl: "http://appliance-ipam:3001",
      version: process.env.npm_package_version ?? null,
    });

    // --- Scanner-Edge
    const edgeEntry = findLaunchpadEntry(creds, "edge", "Scanner-Edge");
    modules.push({
      key: "scanner-edge",
      label: "Scanner-Edge",
      category: "va",
      description: "FastAPI + Greenbone CE container — vulnerability scanning + nuclei modules",
      installed: !!edgeEntry,
      uiUrl: edgeEntry?.url ?? null,
      apiUrl: "http://host.docker.internal:8080",
      version: null,
      note: edgeEntry
        ? undefined
        : "Modulo edge non rilevato nel launchpad. Verifica install_edge in config.yaml + ./deploy.sh connect",
    });

    // --- Wazuh
    const wazuh = getWazuhConfig();
    const wazuhEntry = findLaunchpadEntry(creds, "wazuh", "Wazuh");
    modules.push({
      key: "wazuh",
      label: "Wazuh SIEM",
      category: "siem",
      description: "Wazuh Manager + Indexer (OpenSearch) + Dashboard SIEM",
      installed: wazuh.enabled || !!wazuhEntry,
      uiUrl: wazuhEntry?.url ?? null,
      apiUrl: wazuh.url ?? "https://10.255.255.3:55000",
      version: null,
    });

    // --- Graylog
    const graylog = getIntegrationConfig("graylog");
    const graylogEntry = findLaunchpadEntry(creds, "graylog", "Graylog");
    modules.push({
      key: "graylog",
      label: "Graylog",
      category: "logs",
      description: "Log management + OpenSearch standalone + MongoDB",
      installed: graylog.mode !== "disabled" || !!graylogEntry,
      uiUrl: graylogEntry?.url ?? null,
      apiUrl: graylog.url ?? null,
      version: null,
    });

    // --- LibreNMS
    const librenms = getIntegrationConfig("librenms");
    const librenmsEntry = findLaunchpadEntry(creds, "librenms", "LibreNMS");
    modules.push({
      key: "librenms",
      label: "LibreNMS",
      category: "nms",
      description: "NMS SNMP polling + MariaDB + Redis + Dispatcher",
      installed: librenms.mode !== "disabled" || !!librenmsEntry,
      uiUrl: librenmsEntry?.url ?? null,
      apiUrl: librenms.url ?? null,
      version: null,
    });

    // --- Net-Services
    const netState = await getNetServicesState(tenantCode);
    const netEntry = findLaunchpadEntry(creds, "other", "Net-Services");
    modules.push({
      key: "network-services",
      label: "Network Services",
      category: "network",
      description: "Bridge FastAPI + Unbound + AdGuard + PowerDNS + Kea (4 servizi opt-in)",
      installed: netState.enabled,
      uiUrl: "/network-services",
      apiUrl: netState.apiUrl || netEntry?.url || null,
      version: null,
      note: netState.enabled
        ? undefined
        : "Modulo non installato. Provisiona la VM 107 (install_net_services=local) + ./deploy.sh connect",
    });

    return NextResponse.json({
      ok: true,
      modules,
    });
  });
}
