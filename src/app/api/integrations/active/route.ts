import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getIntegrationConfig } from "@/lib/integrations/config";
import { getWazuhConfig } from "@/lib/integrations/wazuh-config";
import { isInternalIntegrationUrl, deriveDefaultIntegrationUiUrl } from "@/lib/integrations/public-url";
import { resolveIntegrationBrowserUrl } from "@/lib/integrations/public-url-server";
import {
  librenmsAutologinEnabled,
  resolveLibreNMSOperatorUrl,
} from "@/lib/integrations/librenms-proxy-auth";
import { listCredentials } from "@/lib/credentials-vault";
import type { IntegrationComponent } from "@/lib/integrations/types";

/**
 * Risolve un URL LAN-accessible per un kind di integrazione.
 * Preferisce `integration_*_ui_url`, launchpad Dashboard, env (:7443 nginx).
 */
function resolveLanUrl(kind: IntegrationComponent, fallback: string): string {
  const resolved = resolveIntegrationBrowserUrl(kind, fallback);
  if (resolved && !isInternalIntegrationUrl(resolved)) return resolved;
  const derived = deriveDefaultIntegrationUiUrl(kind);
  if (derived && !isInternalIntegrationUrl(derived)) return derived.replace(/\/+$/, "");
  return "";
}

function isInternalUrl(url: string | null | undefined): boolean {
  return isInternalIntegrationUrl(url);
}

/** Wazuh dashboard URL dal vault (kind wazuh, label Dashboard). */
function resolveWazuhDashboardUrl(fallback: string): string {
  try {
    const match = listCredentials().find(
      (c) =>
        c.kind === "wazuh" &&
        c.url &&
        /dashboard/i.test(c.label) &&
        !isInternalIntegrationUrl(c.url),
    );
    return match?.url?.replace(/\/+$/, "") ?? fallback;
  } catch {
    return fallback;
  }
}

export interface ActiveIntegrationInfo {
  enabled: boolean;
  /** URL effettivo da caricare nell'iframe. Punta al reverse proxy DA-IPAM
   *  per LibreNMS e Wazuh (per bypassare cert self-signed + X-Frame-Options).
   *  Per le altre integrazioni resta l'URL diretto. */
  url: string;
  /** URL diretto dell'upstream — usato per "Apri in nuova scheda". */
  directUrl: string;
  label: string;
  /** true se il browser dell'utente potrebbe avere problemi a caricare
   *  l'iframe (cert self-signed da accettare manualmente, o session cookie
   *  cross-origin). UI mostra un banner che invita ad aprire la URL in
   *  una nuova tab almeno una volta. */
  iframeNeedsHandshake?: boolean;
  handshakeReason?: string;
  /** false → UI mostra una landing con shortcut esterni invece dell'iframe.
   *  Usato per Wazuh (SPA OpenSearch Dashboards che non funziona sotto
   *  sub-path proxy senza nginx davanti — vedi
   *  docs/playbooks/wazuh-integration.md). */
  iframeSupported?: boolean;
  /** Shortcut esterni mostrati nella landing quando iframeSupported=false. */
  shortcuts?: Array<{ label: string; url: string; description?: string }>;
}

export async function GET() {
  const authError = await requireAuth();
  if (isAuthError(authError)) return authError;

  const result: Record<string, ActiveIntegrationInfo> = {};

  // LibreNMS — SSO same-origin poi redirect :7443 (evita login ripetuto; proxy rompe CSS).
  const librenms = getIntegrationConfig("librenms");
  if (librenms.mode !== "disabled" && librenms.url) {
    const browserBase = resolveLanUrl("librenms", librenms.url);
    const openUrl = browserBase ? resolveLibreNMSOperatorUrl(browserBase) : "";
    result.librenms = {
      enabled: true,
      url: openUrl || browserBase,
      directUrl: browserBase,
      label: "LibreNMS",
      iframeNeedsHandshake: browserBase.startsWith("https://"),
      ...(browserBase.startsWith("https://") && !librenmsAutologinEnabled() && {
        handshakeReason:
          "Accetta il certificato self-signed su :7443 al primo accesso.",
      }),
      ...(librenmsAutologinEnabled() && {
        handshakeReason: "Accesso automatico con credenziali appliance (SSO).",
      }),
    };
  } else {
    result.librenms = { enabled: false, url: "", directUrl: "", label: "LibreNMS" };
  }

  // Graylog / Loki — niente proxy per ora. Risolviamo URL LAN-accessible per
  // "Apri in nuova scheda". Se l'URL salvato è solo internal e non risolto,
  // disabilitiamo l'iframe (landing con avviso).
  for (const c of ["graylog", "loki"] as const) {
    const cfg = getIntegrationConfig(c);
    const resolved = resolveLanUrl(c, cfg.url ?? "");
    const internalOnly = isInternalUrl(cfg.url) && resolved === cfg.url;
    result[c] = {
      enabled: cfg.mode !== "disabled" && !!cfg.url,
      url: internalOnly ? "" : resolved,
      directUrl: resolved,
      label: c === "graylog" ? "Graylog" : "Loki",
      iframeSupported: !internalOnly,
      ...(internalOnly && {
        shortcuts: [
          {
            label: `URL backend interno (${cfg.url})`,
            url: cfg.url ?? "",
            description:
              "Questo è l'URL di sync usato dal backend DA-IPAM (Docker network). Non è accessibile dal browser. Configura il reverse proxy nginx LAN o aggiungi una entry Dashboard nel launchpad per l'accesso browser.",
          },
        ],
      }),
    };
  }

  // Wazuh — l'iframe della SPA OpenSearch Dashboards non funziona sotto
  // sub-path proxy senza nginx davanti (vedi docs/playbooks/wazuh-integration.md).
  // Mostriamo una landing con shortcut diretti invece di tentare l'iframe.
  const wazuh = getWazuhConfig();
  if (wazuh.enabled && wazuh.url) {
    let dashUrl = wazuh.url.replace(/:55000(\/.*)?$/, "");
    if (!/^https?:\/\//.test(dashUrl)) dashUrl = `https://${dashUrl}`;
    // Risolvi URL Dashboard LAN-accessible (es. https://192.168.99.51:8443/)
    // dal launchpad. Il default dashUrl punta all'IP interno /28 (10.255.255.3)
    // NON raggiungibile dal browser → shortcut rotti.
    dashUrl = resolveWazuhDashboardUrl(dashUrl).replace(/\/$/, "");
    result.wazuh = {
      enabled: true,
      url: dashUrl,
      directUrl: dashUrl,
      label: "Wazuh",
      iframeSupported: false,
      shortcuts: [
        { label: "Dashboard Wazuh", url: dashUrl, description: "Home del dashboard SIEM/HIDS." },
        { label: "Agenti", url: `${dashUrl}/app/endpoints-summary`, description: "Lista agent Wazuh con stato e ultimo keep-alive." },
        { label: "Vulnerabilità (CVE)", url: `${dashUrl}/app/vulnerability-detection`, description: "Dashboard CVE su tutti gli agent." },
        { label: "Inventario", url: `${dashUrl}/app/it-hygiene`, description: "Software inventory + CIS hardening." },
        { label: "Threat hunting", url: `${dashUrl}/app/threat-hunting`, description: "Eventi e regole di detection." },
      ],
    };
  }

  // v0.2.642 audit perf UI7: cache 60s + SWR 5min — chiamato da varie pagine
  // dashboard al mount (badge LibreNMS/Wazuh sull'host).
  return NextResponse.json(result, {
    headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" },
  });
}
