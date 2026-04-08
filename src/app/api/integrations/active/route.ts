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

  return NextResponse.json(result);
}
