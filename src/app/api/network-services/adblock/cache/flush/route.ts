import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { makeNetServicesClient, BridgeUnavailableError } from "@/lib/network-services/client";

export async function POST() {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;
    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) return NextResponse.json({ error: "Tenant non risolto" }, { status: 400 });
    try {
      const client = await makeNetServicesClient(tenantCode);
      return NextResponse.json(await client.adblockFlushCache());
    } catch (e) {
      if (e instanceof BridgeUnavailableError) {
        return NextResponse.json({ error: e.message }, { status: e.statusCode ?? 503 });
      }
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  });
}
