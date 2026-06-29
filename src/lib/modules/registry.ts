/**
 * Registry unico dei moduli base dell'appliance Domarc.
 *
 * Normalizza i 6 moduli eterogenei (storage hub/tenant diversi) in un unico
 * `ModuleState[]`. È la sorgente di verità per le 3 superfici UI:
 *   - pagina di configurazione unica (settings tab "moduli")
 *   - launchpad (unico punto di accesso)
 *   - widget "Stato Moduli" in dashboard
 *
 * Lo stato di SALUTE (raggiungibilità live) NON è qui: vive in
 * src/lib/modules/health.ts (layer cachato 60s) per tenere il registry veloce.
 *
 * Accesso:
 *   - "native"   → UI gestita dentro DA-IPAM (route interna). Mai aprire pagina esterna.
 *   - "external" → dashboard esterna lanciata (nuova tab / iframe).
 *
 * Nota edge: l'appliance Scanner-Edge esiste anche standalone (integrazione con
 * DA-Vul-can). Dentro DA-IPAM la gestione è nativa (/vulnerabilities); la
 * connessione all'appliance è solo configurazione (tenant `vuln_scanners`).
 */
import { listCredentials } from "@/lib/credentials-vault";
import { resolveIntegrationBrowserUrl } from "@/lib/integrations/public-url-server";
import { resolveLibreNMSOperatorUrl } from "@/lib/integrations/librenms-proxy-auth";
import { getIntegrationConfig } from "@/lib/integrations/config";
import { getWazuhConfig } from "@/lib/integrations/wazuh-config";
import { getNetServicesState } from "@/lib/network-services/feature";
import { getFeatureStatus } from "@/lib/patch/feature";
import { getTenantDb } from "@/lib/db-tenant";
import { deriveEdgeUiBase } from "@/lib/integrations/edge-ui-url";

export type ModuleKey =
  | "edge"
  | "patch_management"
  | "network_services"
  | "librenms"
  | "graylog"
  | "wazuh";

export type ModuleCategory = "va" | "patch" | "network" | "nms" | "logs" | "siem";

export interface ModuleDescriptor {
  key: ModuleKey;
  label: string;
  category: ModuleCategory;
  description: string;
  /** Nome icona lucide-react (risolto lato client). */
  icon: string;
  /** native = UI dentro DA-IPAM; external = dashboard esterna. */
  access: "native" | "external";
  /** Deep-link alla card di configurazione nel tab "moduli". */
  configHref: string;
}

export interface ModuleState extends ModuleDescriptor {
  /** Modulo rilevato/presente (anche se disabilitato). */
  installed: boolean;
  /** Config minima presente per funzionare. */
  configured: boolean;
  /** Attivo adesso (non auto-disabled / mode != disabled). */
  enabled: boolean;
  /** Target di "Apri": route interna (native) o URL esterno (external). null se non lanciabile. */
  uiUrl: string | null;
  uiIsInternal: boolean;
  /**
   * URL esterno opzionale alla UI completa del modulo, in aggiunta a `uiUrl`.
   * Usato dai moduli ad accesso nativo (uiUrl interno) che però espongono
   * anche una propria interfaccia web autonoma — es. Scanner-Edge: findings
   * nativi in /vulnerabilities + UI edge completa su :6443. null = nessuna.
   */
  externalUiUrl?: string | null;
  /** Suggerimento operativo quando non installato. */
  note?: string;
}

interface SystemCredentialLite {
  id: number;
  kind: string;
  label: string;
  url: string | null;
}

/**
 * Cerca nel vault launchpad la entry lanciabile (URL http/https) per un modulo.
 * Helper condiviso per risolvere l'URL di launch di un modulo dal vault.
 */
export function findLaunchpadEntry(
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

/** Metadati statici dei 6 moduli base (ordine = ordine di rendering). */
export const MODULE_DESCRIPTORS: ReadonlyArray<ModuleDescriptor> = [
  {
    key: "edge",
    label: "Scanner-Edge",
    category: "va",
    description:
      "Vulnerability scanning (Greenbone CE + nuclei). Gestione findings nativa in DA-IPAM.",
    icon: "ShieldAlert",
    access: "native",
    configHref: "/settings?tab=moduli#module-edge",
  },
  {
    key: "patch_management",
    label: "Patch Management",
    category: "patch",
    description:
      "Patching Windows CVE-driven via Chocolatey. UI nativa in DA-IPAM.",
    icon: "PackageCheck",
    access: "native",
    configHref: "/settings?tab=moduli#module-patch_management",
  },
  {
    key: "network_services",
    label: "Network Services",
    category: "network",
    description:
      "DNS / DHCP / AdGuard / Unbound via bridge. Gestione nativa in DA-IPAM.",
    icon: "ServerCog",
    access: "native",
    configHref: "/settings?tab=moduli#module-network_services",
  },
  {
    key: "librenms",
    label: "LibreNMS",
    category: "nms",
    description:
      "NMS SNMP polling. Grafici embeddati nelle pagine device + dashboard completa esterna.",
    icon: "Activity",
    access: "external",
    configHref: "/settings?tab=moduli#module-librenms",
  },
  {
    key: "graylog",
    label: "Graylog",
    category: "logs",
    description: "Log management enterprise (OpenSearch + MongoDB).",
    icon: "ScrollText",
    access: "external",
    configHref: "/settings?tab=moduli#module-graylog",
  },
  {
    key: "wazuh",
    label: "Wazuh SIEM",
    category: "siem",
    description: "XDR/SIEM (Manager + Indexer + Dashboard).",
    icon: "Radar",
    access: "external",
    configHref: "/settings?tab=moduli#module-wazuh",
  },
];

interface VulnScannerLite {
  base_url: string;
  enabled: number;
  auto_disabled_at: string | null;
}

/**
 * Risolve lo stato dei 6 moduli per il tenant. Va invocata dentro un contesto
 * con `tenantCode` valido (le route lo forniscono via withTenantFromSession +
 * getCurrentTenantCode). I getter hub (wazuh/integration) sono globali; edge
 * usa il DB tenant esplicito; net_services/patch prendono tenantCode in arg.
 */
export async function resolveModules(tenantCode: string): Promise<ModuleState[]> {
  const desc = (key: ModuleKey): ModuleDescriptor =>
    MODULE_DESCRIPTORS.find((d) => d.key === key)!;
  const creds = listCredentials() as SystemCredentialLite[];
  const out: ModuleState[] = [];

  // ── edge (tenant DB vuln_scanners) — accesso nativo /vulnerabilities ──
  {
    let scanner: VulnScannerLite | undefined;
    try {
      scanner = getTenantDb(tenantCode)
        .prepare(
          "SELECT base_url, enabled, auto_disabled_at FROM vuln_scanners ORDER BY id LIMIT 1",
        )
        .get() as VulnScannerLite | undefined;
    } catch {
      scanner = undefined;
    }
    const installed = !!scanner;
    const configured = !!scanner?.base_url;
    const enabled = scanner?.enabled === 1 && !scanner?.auto_disabled_at;
    out.push({
      ...desc("edge"),
      installed,
      configured,
      enabled,
      uiUrl: "/vulnerabilities",
      uiIsInternal: true,
      // UI edge completa (Greenbone/scan/reti) su :6443, in aggiunta ai
      // findings nativi in /vulnerabilities. null se host non browser-reachable.
      externalUiUrl: scanner?.base_url ? deriveEdgeUiBase(scanner.base_url) : null,
      note: installed
        ? undefined
        : "Scanner-Edge non configurato. Importa il JSON dell'installer o compila la card edge.",
    });
  }

  // ── patch_management (hub tenant_features) — accesso nativo /patch-management ──
  {
    const status = await getFeatureStatus(tenantCode, "patch_management");
    out.push({
      ...desc("patch_management"),
      installed: status.enabled,
      configured: status.enabled,
      enabled: status.enabled,
      uiUrl: "/patch-management",
      uiIsInternal: true,
      note: status.enabled
        ? undefined
        : "Modulo non installato. Installalo dalla card o importa il JSON dell'installer.",
    });
  }

  // ── network_services (hub tenant_features.config_json) — nativo /network-services ──
  {
    const net = await getNetServicesState(tenantCode);
    out.push({
      ...desc("network_services"),
      installed: net.enabled,
      configured: net.configured,
      enabled: net.enabled && net.configured,
      uiUrl: "/network-services",
      uiIsInternal: true,
      note: net.enabled
        ? undefined
        : "Modulo non installato. Provisiona la VM bridge + importa il JSON dell'installer.",
    });
  }

  // ── librenms (hub settings) — esterno (grafici device già embeddati) ──
  {
    const cfg = getIntegrationConfig("librenms");
    const entry = findLaunchpadEntry(creds, "librenms", "LibreNMS");
    const browserUrl = resolveIntegrationBrowserUrl("librenms", cfg.url);
    const launchUrl = browserUrl ? resolveLibreNMSOperatorUrl(browserUrl) : null;
    const installed = cfg.mode !== "disabled" || !!entry;
    const configured = cfg.mode !== "disabled" && !!cfg.url;
    out.push({
      ...desc("librenms"),
      installed,
      configured,
      enabled: configured,
      uiUrl: launchUrl || entry?.url || null,
      uiIsInternal: false,
      note: installed ? undefined : "Non configurato. Importa il JSON dell'installer LibreNMS.",
    });
  }

  // ── graylog (hub settings) — esterno ──
  {
    const cfg = getIntegrationConfig("graylog");
    const entry = findLaunchpadEntry(creds, "graylog", "Graylog");
    const installed = cfg.mode !== "disabled" || !!entry;
    const configured = cfg.mode !== "disabled" && !!cfg.url;
    out.push({
      ...desc("graylog"),
      installed,
      configured,
      enabled: configured,
      uiUrl: entry?.url ?? null,
      uiIsInternal: false,
      note: installed ? undefined : "Non configurato. Importa il JSON dell'installer Graylog.",
    });
  }

  // ── wazuh (hub settings) — esterno ──
  {
    const cfg = getWazuhConfig();
    // Preferisci la entry "Dashboard" (login UI) rispetto al Manager (API:55000).
    const entry =
      findLaunchpadEntry(creds, "wazuh", "Dashboard") ??
      findLaunchpadEntry(creds, "wazuh", "Wazuh");
    const configured = Boolean(cfg.enabled && cfg.url && cfg.username && cfg.password);
    const installed = cfg.enabled || !!entry;
    out.push({
      ...desc("wazuh"),
      installed,
      configured,
      enabled: configured,
      uiUrl: entry?.url ?? null,
      uiIsInternal: false,
      note: installed ? undefined : "Non configurato. Importa il JSON dell'installer Wazuh.",
    });
  }

  return out;
}
