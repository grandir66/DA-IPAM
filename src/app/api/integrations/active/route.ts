import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getIntegrationConfig } from "@/lib/integrations/config";
import { getWazuhConfig } from "@/lib/integrations/wazuh-config";

export interface ActiveIntegrationInfo {
  enabled: boolean;
  url: string;
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

  const components = ["librenms", "graylog", "loki"] as const;
  const result: Record<string, ActiveIntegrationInfo> = {};

  for (const c of components) {
    const cfg = getIntegrationConfig(c);
    result[c] = {
      enabled: cfg.mode !== "disabled" && !!cfg.url,
      url: cfg.url ?? "",
      label: c === "librenms" ? "LibreNMS" : c === "graylog" ? "Graylog" : "Loki",
    };
  }

  // Wazuh dashboard (port 443 di default). L'iframe può fallire se il browser
  // non ha mai accettato il cert self-signed: in quel caso flagghiamo
  // iframeNeedsHandshake così la UI suggerisce di aprirlo prima in nuova tab.
  const wazuh = getWazuhConfig();
  if (wazuh.enabled && wazuh.url) {
    let dashUrl = wazuh.url.replace(/:55000(\/.*)?$/, "");
    if (!/^https?:\/\//.test(dashUrl)) dashUrl = `https://${dashUrl}`;
    const isHttps = dashUrl.startsWith("https://");
    result.wazuh = {
      enabled: true,
      url: dashUrl,
      label: "Wazuh",
      iframeNeedsHandshake: isHttps && !wazuh.verifyTls,
      handshakeReason: isHttps && !wazuh.verifyTls
        ? "Wazuh usa un certificato self-signed: apri la dashboard in nuova tab almeno una volta per accettare il certificato, poi torna qui."
        : undefined,
    };
  }

  return NextResponse.json(result);
}
