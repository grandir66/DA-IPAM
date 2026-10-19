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
import {
  resolveEdgeBrowserUrl,
  resolveIntegrationBrowserUrl,
  resolveWazuhBrowserUrl,
} from "@/lib/integrations/public-url-server";
import { resolveLibreNMSOperatorUrl } from "@/lib/integrations/librenms-proxy-auth";
import { getIntegrationConfig } from "@/lib/integrations/config";
import { listControllerViews } from "@/lib/controllers/service";
import { withTenant } from "@/lib/db-tenant";
import { getWazuhConfig } from "@/lib/integrations/wazuh-config";
import { getNetServicesState } from "@/lib/network-services/feature";
import { getFeatureStatus } from "@/lib/patch/feature";
import { getMeshConfig } from "@/lib/integrations/meshcentral/config";
import { getTenantDb, getTenantSetting } from "@/lib/db-tenant";
import { getMdmConfig } from "@/lib/integrations/mdm-config";
import { OFFERTA_MODULO, type Offerta } from "./offerta";

export type ModuleKey =
  | "edge"
  | "patch_management"
  | "network_services"
  | "librenms"
  | "graylog"
  | "wazuh"
  | "meshcentral"
  | "inventory_agent"
  | "nis2_inventory"
  | "unifi"
  | "mdm"
  | "appliance";

export type ModuleCategory = "va" | "patch" | "network" | "nms" | "logs" | "siem" | "rmm" | "inventory" | "sistema";

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
  /**
   * Offerta commerciale (passo 4c, 16/10): `base` = compreso nel prodotto,
   * `opzione` = modulo opzionale, potenzialmente a pagamento. Solo
   * presentazione: oggi non blocca niente (vedi `offerta.ts`).
   */
  offerta: Offerta;
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
    offerta: OFFERTA_MODULO.edge,
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
    offerta: OFFERTA_MODULO.patch_management,
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
    offerta: OFFERTA_MODULO.network_services,
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
    offerta: OFFERTA_MODULO.librenms,
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
    offerta: OFFERTA_MODULO.graylog,
    label: "Graylog",
    category: "logs",
    description: "Log management enterprise (OpenSearch + MongoDB).",
    icon: "ScrollText",
    access: "external",
    configHref: "/settings?tab=moduli#module-graylog",
  },
  {
    key: "wazuh",
    offerta: OFFERTA_MODULO.wazuh,
    label: "Wazuh SIEM",
    category: "siem",
    description: "XDR/SIEM (Manager + Indexer + Dashboard).",
    icon: "Radar",
    access: "external",
    configHref: "/settings?tab=moduli#module-wazuh",
  },
  {
    key: "meshcentral",
    offerta: OFFERTA_MODULO.meshcentral,
    label: "MeshCentral (Controllo remoto)",
    category: "rmm",
    description:
      "Controllo remoto endpoint via MeshCentral co-locato (launch-out SSO). UI nativa /rmm + console esterna.",
    icon: "MonitorSmartphone",
    access: "native",
    configHref: "/settings?tab=moduli#module-meshcentral",
  },
  {
    key: "inventory_agent",
    offerta: OFFERTA_MODULO.inventory_agent,
    label: "Inventory Agent (GLPI)",
    category: "inventory",
    description:
      "Inventario software push da GLPI Agent (Windows/Linux/macOS) via JSON. Nessun server GLPI né Wazuh.",
    icon: "PackageSearch",
    access: "native",
    configHref: "/settings?tab=moduli#module-inventory_agent",
  },
  {
    key: "nis2_inventory",
    offerta: OFFERTA_MODULO.nis2_inventory,
    label: "Inventario NIS2",
    category: "inventory",
    description: "Servizi/asset NIS2 (anagrafica, criticità). Modulo nativo opzionale.",
    icon: "Workflow",
    access: "native",
    configHref: "/settings?tab=moduli#module-nis2_inventory",
  },
  {
    // Fonte di dati, non dashboard: switch e AP del controller del cliente
    // finiscono in DA-IPAM (apparati, porte, vicini LLDP). La console del
    // controller resta raggiungibile come interfaccia esterna.
    key: "unifi",
    offerta: OFFERTA_MODULO.unifi,
    label: "Controller UniFi",
    category: "network",
    description:
      "Switch e access point letti dai controller UniFi in sola lettura: apparati, porte e vicini LLDP nella mappa di rete.",
    icon: "Network",
    access: "native",
    configHref: "/controllers",
  },
  {
    // Analisi del 19/10 (F11, approvato da Riccardo): l'MDM stava solo in
    // Impostazioni → Sistema, fuori da salute e Launchpad. I telefoni diventano
    // host; la console è quella di Headwind (esterna).
    key: "mdm",
    offerta: OFFERTA_MODULO.mdm,
    label: "MDM (Headwind)",
    category: "inventory",
    description: "Telefoni Android gestiti da Headwind MDM, importati come host con il loro inventario.",
    icon: "Smartphone",
    access: "external",
    configHref: "/settings/mdm",
  },
  {
    // Non è un'integrazione ma la macchina che le ospita tutte: disco root e
    // demone Docker. Due appliance si sono fermate sul campo per disco pieno
    // (cliente A 2026-07-28, PX-NAS 2026-07-30) senza che questa griglia desse
    // alcun segnale — questa voce esiste per non ripetere quell'incidente.
    key: "appliance",
    offerta: OFFERTA_MODULO.appliance,
    label: "Sistema appliance",
    category: "sistema",
    description: "Salute della macchina che ospita DA-IPAM: spazio disco e demone Docker.",
    icon: "HardDrive",
    access: "native",
    configHref: "/settings?tab=moduli",
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
export async function resolveModules(tenantCode: string, ruolo: unknown): Promise<ModuleState[]> {
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
      // findings nativi in /vulnerabilities: dal nodo che serve davvero la 6443
      // (nginx sul nodo di DA-IPAM), non dall'host di base_url (passo 4b).
      externalUiUrl: scanner?.base_url ? resolveEdgeBrowserUrl(scanner.base_url) : null,
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
    // Accesso automatico solo per chi è almeno admin (T3-26).
    const launchUrl = browserUrl ? resolveLibreNMSOperatorUrl(browserUrl, ruolo) : null;
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
    // Stessa fonte del viewer (`/api/integrations/active`): passo 4b, 16/10.
    const browserUrl = resolveIntegrationBrowserUrl("graylog", cfg.url);
    const installed = cfg.mode !== "disabled" || !!entry;
    const configured = cfg.mode !== "disabled" && !!cfg.url;
    out.push({
      ...desc("graylog"),
      installed,
      configured,
      enabled: configured,
      uiUrl: browserUrl || entry?.url || null,
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
    // Stessa fonte del viewer (`/api/integrations/active`): passo 4b, 16/10.
    const browserUrl = resolveWazuhBrowserUrl();
    const configured = Boolean(cfg.enabled && cfg.url && cfg.username && cfg.password);
    const installed = cfg.enabled || !!entry;
    out.push({
      ...desc("wazuh"),
      installed,
      configured,
      enabled: configured,
      uiUrl: browserUrl || null,
      uiIsInternal: false,
      note: installed ? undefined : "Non configurato. Importa il JSON dell'installer Wazuh.",
    });
  }

  // ── meshcentral (hub tenant_features + mc_config tenant) — nativo /rmm + console esterna ──
  {
    const status = await getFeatureStatus(tenantCode, "meshcentral");
    const cfg = getMeshConfig();
    out.push({
      ...desc("meshcentral"),
      installed: status.enabled,
      configured: !!cfg?.present,
      enabled: status.enabled && !!cfg?.present,
      uiUrl: "/rmm",
      uiIsInternal: true,
      externalUiUrl: cfg?.serverUrl || null,
      note: status.enabled
        ? cfg?.present
          ? undefined
          : "Modulo installato ma non configurato (URL/MeshID/credenziali)."
        : "Modulo non installato. Installalo dalla card MeshCentral.",
    });
  }

  // ── inventory_agent (hub tenant_features) — GLPI push, gestione nativa (card + host detail) ──
  {
    const status = await getFeatureStatus(tenantCode, "inventory_agent");
    out.push({
      ...desc("inventory_agent"),
      installed: status.enabled,
      configured: status.enabled,
      enabled: status.enabled,
      // Ingest in background: nessuna pagina dedicata propria (dati nel dettaglio host
      // + card settings). uiUrl null = catalogato ma non "lanciabile".
      uiUrl: null,
      uiIsInternal: true,
      note: status.enabled
        ? undefined
        : "Modulo non installato. Installalo dalla card Inventory Agent.",
    });
  }

  // ── nis2_inventory (toggle nativo via tenant_settings) — nativo /services ──
  {
    // Default ON: preserva la visibilità storica di /services; disattivabile.
    const raw = getTenantSetting("nis2_inventory_enabled");
    const enabled = raw === null ? true : raw === "1" || raw === "true";
    out.push({
      ...desc("nis2_inventory"),
      installed: true,
      configured: true,
      enabled,
      uiUrl: "/services",
      uiIsInternal: true,
      note: enabled ? undefined : "Disattivato. Attivalo da Impostazioni → Moduli.",
    });
  }

  // ── mdm: Headwind, configurazione nel DB del tenant (mdm_config) — console esterna ──
  {
    let cfg: ReturnType<typeof getMdmConfig> | null = null;
    let readError: string | null = null;
    try {
      cfg = withTenant(tenantCode, () => getMdmConfig());
    } catch (e) {
      readError = e instanceof Error ? e.message : String(e);
    }
    const configured = !!cfg?.base_url && !!cfg?.username;
    out.push({
      ...desc("mdm"),
      installed: !!cfg?.base_url,
      configured,
      enabled: configured && !!cfg?.enabled,
      // Nel Launchpad solo con la console configurata (Riccardo, 19/10).
      uiUrl: configured ? cfg!.base_url : null,
      uiIsInternal: false,
      note: readError
        ? `Configurazione MDM non leggibile: ${readError}`
        : !configured
          ? "Non configurato: indirizzo e utente della console Headwind in Impostazioni → Moduli → MDM."
          : cfg?.auto_disabled
            ? "Spento da solo dopo errori di sincronizzazione: controlla la configurazione."
            : !cfg?.enabled
              ? "Configurato ma spento."
              : undefined,
    });
  }

  // ── unifi: controller di rete del tenant (ADR 0007) — dati nativi (/topology) + console del controller ──
  {
    let controllers: ReturnType<typeof listControllerViews> = [];
    let readError: string | null = null;
    try {
      controllers = withTenant(tenantCode, () => listControllerViews());
    } catch (e) {
      readError = e instanceof Error ? e.message : String(e);
    }
    const on = controllers.filter((c) => c.enabled && c.kind !== "omada");
    out.push({
      ...desc("unifi"),
      installed: controllers.length > 0,
      configured: on.length > 0,
      enabled: on.length > 0,
      uiUrl: "/topology",
      uiIsInternal: true,
      externalUiUrl: on[0]?.url ?? null,
      note: readError
        ? `Controller non leggibili dal database: ${readError}`
        : controllers.length === 0
          ? "Nessun controller. Aggiungilo da Applicativi → Controller di rete."
          : on.length === 0
            ? "Controller presenti ma spenti: accendili da Applicativi → Controller di rete."
            : undefined,
    });
  }

  return out;
}
