import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getIntegrationConfig } from "@/lib/integrations/config";
import { getWazuhConfig } from "@/lib/integrations/wazuh-config";

export async function GET() {
  const authError = await requireAuth();
  if (isAuthError(authError)) return authError;

  const components = ["librenms", "graylog", "loki"] as const;
  const result: Record<string, { enabled: boolean; url: string; label: string }> = {};

  for (const c of components) {
    const cfg = getIntegrationConfig(c);
    result[c] = {
      enabled: cfg.mode !== "disabled" && !!cfg.url,
      url: cfg.url ?? "",
      label: c === "librenms" ? "LibreNMS" : c === "graylog" ? "Graylog" : "Loki",
    };
  }

  // Wazuh: iframe verso la dashboard (porta 443 di default, non l'API 55000).
  const wazuh = getWazuhConfig();
  if (wazuh.enabled && wazuh.url) {
    // Deriva URL dashboard rimuovendo la porta API.
    let dashUrl = wazuh.url.replace(/:55000(\/.*)?$/, "");
    if (!/^https?:\/\//.test(dashUrl)) dashUrl = `https://${dashUrl}`;
    result.wazuh = { enabled: true, url: dashUrl, label: "Wazuh" };
  } else {
    result.wazuh = { enabled: false, url: "", label: "Wazuh" };
  }

  return NextResponse.json(result);
}
