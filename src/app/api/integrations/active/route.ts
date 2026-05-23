import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getIntegrationConfig } from "@/lib/integrations/config";
import { getWazuhConfig } from "@/lib/integrations/wazuh-config";

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
}

export async function GET() {
  const authError = await requireAuth();
  if (isAuthError(authError)) return authError;

  const result: Record<string, ActiveIntegrationInfo> = {};

  // LibreNMS — sempre via reverse proxy quando configurato, così l'iframe
  // funziona anche con `frame_options = "DENY"` (default LibreNMS).
  const librenms = getIntegrationConfig("librenms");
  if (librenms.mode !== "disabled" && librenms.url) {
    result.librenms = {
      enabled: true,
      url: "/api/integrations/proxy/librenms/",
      directUrl: librenms.url,
      label: "LibreNMS",
    };
  } else {
    result.librenms = { enabled: false, url: "", directUrl: "", label: "LibreNMS" };
  }

  // Graylog / Loki — niente proxy per ora, lasciamo il flusso esistente.
  for (const c of ["graylog", "loki"] as const) {
    const cfg = getIntegrationConfig(c);
    result[c] = {
      enabled: cfg.mode !== "disabled" && !!cfg.url,
      url: cfg.url ?? "",
      directUrl: cfg.url ?? "",
      label: c === "graylog" ? "Graylog" : "Loki",
    };
  }

  // Wazuh — via reverse proxy DA-IPAM per accettare cert self-signed e
  // strippare X-Frame-Options sulla dashboard OpenSearch.
  const wazuh = getWazuhConfig();
  if (wazuh.enabled && wazuh.url) {
    let dashUrl = wazuh.url.replace(/:55000(\/.*)?$/, "");
    if (!/^https?:\/\//.test(dashUrl)) dashUrl = `https://${dashUrl}`;
    result.wazuh = {
      enabled: true,
      url: "/api/integrations/proxy/wazuh/",
      directUrl: dashUrl,
      label: "Wazuh",
      iframeNeedsHandshake: false,
    };
  }

  return NextResponse.json(result);
}
