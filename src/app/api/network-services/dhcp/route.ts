import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import {
  makeNetServicesClient,
  BridgeUnavailableError,
} from "@/lib/network-services/client";

/**
 * DHCP Kea SOLO LETTURA: lease attivi + reservation statiche.
 * Il bridge non espone write su DHCP (le reservation si gestiscono via DA-IPAM
 * altrove). Qui esponiamo solo lo stato per la pagina Network Services.
 */
export async function GET() {
  return withTenantFromSession(async () => {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;
    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) return NextResponse.json({ error: "Tenant non risolto" }, { status: 400 });
    try {
      const client = await makeNetServicesClient(tenantCode);
      const [leases, reservations] = await Promise.all([
        client.dhcpLeases().catch(() => null),
        client.dhcpReservations().catch(() => null),
      ]);
      return NextResponse.json({ ok: true, leases, reservations });
    } catch (e) {
      if (e instanceof BridgeUnavailableError) {
        return NextResponse.json({ ok: false, error: e.message }, { status: e.statusCode ?? 503 });
      }
      return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
    }
  });
}
