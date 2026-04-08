import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getIntegrationConfig } from "@/lib/integrations/config";
import type { IntegrationComponent } from "@/lib/integrations/types";

const VALID_COMPONENTS: IntegrationComponent[] = ["librenms", "loki", "graylog"];

function parseComponent(raw: string): IntegrationComponent | null {
  return VALID_COMPONENTS.includes(raw as IntegrationComponent)
    ? (raw as IntegrationComponent)
    : null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ component: string }> }
) {
  const authError = await requireAuth();
  if (isAuthError(authError)) return authError;

  const { component: raw } = await params;
  const component = parseComponent(raw);
  if (!component) return NextResponse.json({ error: "Componente non valido" }, { status: 400 });

  const cfg = getIntegrationConfig(component);
  if (!cfg.url) {
    return NextResponse.json({ reachable: false, error: "URL non configurato" });
  }

  try {
    let testUrl = cfg.url.replace(/\/$/, "");
    if (component === "librenms") testUrl += "/api/v0/devices?limit=1";
    else if (component === "loki") testUrl += "/ready";
    else if (component === "graylog") testUrl += "/api/";

    const res = await fetch(testUrl, {
      signal: AbortSignal.timeout(5000),
      headers: component === "librenms" && cfg.apiToken
        ? { "X-Auth-Token": cfg.apiToken }
        : {},
    });

    const reachable = res.status < 500;
    return NextResponse.json({ reachable, statusCode: res.status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ reachable: false, error: msg });
  }
}
