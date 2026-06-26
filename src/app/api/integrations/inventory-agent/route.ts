import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import {
  getInventoryAgentState,
  INVENTORY_AGENT_FEATURE_KEY,
} from "@/lib/inventory-agent/feature";
import { listInvAgentEndpoints } from "@/lib/inventory-agent/db";
import { getGlpiClientDownloads } from "@/lib/inventory-agent/client-downloads";
import { publicHubOrigin, publicHubUrlSource, publicIngestUrl } from "@/lib/inventory-agent/public-url";

const NO_CACHE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  return withTenantFromSession(async () => {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;
    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) {
      return NextResponse.json({ error: "Tenant non risolto" }, { status: 400 });
    }
    const state = await getInventoryAgentState(tenantCode);
    const endpoints = state.enabled ? listInvAgentEndpoints(50) : [];
    const hubOrigin = publicHubOrigin(request);
    const ingestUrl = publicIngestUrl(request);
    return NextResponse.json(
      {
        feature: INVENTORY_AGENT_FEATURE_KEY,
        ingestUrl,
        hubOrigin,
        publicUrlSource: publicHubUrlSource(request),
        installScripts: {
          linux: `${hubOrigin}/api/integrations/inventory-agent/install/linux.sh`,
          windows: `${hubOrigin}/api/integrations/inventory-agent/install/windows.ps1`,
          macos: `${hubOrigin}/api/integrations/inventory-agent/install/macos.sh`,
        },
        glpiDownloads: getGlpiClientDownloads(),
        ...state,
        endpoints,
      },
      { headers: NO_CACHE },
    );
  });
}
