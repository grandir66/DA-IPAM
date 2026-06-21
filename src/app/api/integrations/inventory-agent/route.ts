import { NextResponse } from "next/server";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import {
  getInventoryAgentState,
  INVENTORY_AGENT_FEATURE_KEY,
} from "@/lib/inventory-agent/feature";
import { listInvAgentEndpoints } from "@/lib/inventory-agent/db";

const NO_CACHE = { "Cache-Control": "no-store" };

function publicIngestUrl(request: Request): string {
  const env = process.env.DA_IPAM_PUBLIC_URL?.trim();
  if (env) return `${env.replace(/\/$/, "")}/api/inventory/ingest`;
  try {
    const u = new URL(request.url);
    return `${u.origin}/api/inventory/ingest`;
  } catch {
    return "/api/inventory/ingest";
  }
}

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
    return NextResponse.json(
      {
        feature: INVENTORY_AGENT_FEATURE_KEY,
        ingestUrl: publicIngestUrl(request),
        ...state,
        endpoints,
      },
      { headers: NO_CACHE },
    );
  });
}
