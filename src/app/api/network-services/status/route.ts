import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import {
  makeNetServicesClient,
  BridgeUnavailableError,
} from "@/lib/network-services/client";
import { getNetServicesState } from "@/lib/network-services/feature";

export async function GET() {
  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;
    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) {
      return NextResponse.json({ error: "Tenant non risolto" }, { status: 400 });
    }

    const state = await getNetServicesState(tenantCode);
    if (!state.enabled) {
      return NextResponse.json({
        ok: false,
        installed: false,
        configured: false,
        message: "Modulo Network Services non installato per questo tenant",
      });
    }
    if (!state.configured) {
      return NextResponse.json({
        ok: false,
        installed: true,
        configured: false,
        message: "Modulo installato ma config mancante",
      });
    }

    try {
      const client = await makeNetServicesClient(tenantCode);
      const [bridge, resolver, adblock] = await Promise.all([
        client.status(),
        client.resolverStatus().catch(() => null),
        client.adblockStats().catch(() => null),
      ]);
      return NextResponse.json({
        ok: true,
        installed: true,
        configured: true,
        bridge,
        resolver,
        adblock,
      });
    } catch (e) {
      if (e instanceof BridgeUnavailableError) {
        return NextResponse.json(
          { ok: false, installed: true, configured: true, error: e.message },
          { status: 503 },
        );
      }
      return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
    }
  });
}
