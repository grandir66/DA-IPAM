import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getIntegrationConfig } from "@/lib/integrations/config";

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

  // Wazuh non viene aggiunto all'iframe page: il dashboard Wazuh blocca
  // l'embedding via X-Frame-Options=DENY (default SIEM). La configurazione
  // e i dati vivono in Settings → Integrazioni → card Wazuh, e nella
  // scheda host (HostWazuhCard). Per aprire la dashboard nativa l'utente
  // usa il link diretto a https://da-wazuh.domarc.it in nuova tab.

  return NextResponse.json(result);
}
