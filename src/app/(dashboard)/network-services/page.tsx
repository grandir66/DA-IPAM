import { getCurrentTenantCode } from "@/lib/db-tenant";
import { withTenantFromSession } from "@/lib/api-tenant";
import { auth } from "@/lib/auth";
import {
  makeNetServicesClient,
  BridgeUnavailableError,
} from "@/lib/network-services/client";
import { getNetServicesState } from "@/lib/network-services/feature";
import { NetworkServicesSetup } from "./network-services-setup";
import { NetworkServicesClient } from "./network-services-client";

/**
 * Network Services — UI per gestione DNS+DHCP+AdBlock+Resolver erogati dalla
 * VM dedicata (ADR-0007).
 *
 * Pattern Patch Management:
 * - se feature non installata per il tenant → mostra setup wizard (form apiUrl+token)
 * - se installata e configurata → dashboard 4 cards + CRUD forward zones + adblock rules
 *
 * Tutti i 4 servizi sottostanti sono opt-in: l'admin li attiva dal toggle in dashboard.
 */
export const dynamic = "force-dynamic";

export default async function NetworkServicesPage() {
  return withTenantFromSession(async () => {
    const session = await auth();
    const role = (session?.user as { role?: string } | undefined)?.role;
    const isAdmin = role === "admin" || role === "superadmin";

    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) {
      return (
        <div className="container mx-auto p-6">
          <h1 className="text-2xl font-semibold mb-3">Network Services</h1>
          <div className="rounded border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-900">
            Tenant non risolto dalla sessione.
          </div>
        </div>
      );
    }

    const state = await getNetServicesState(tenantCode);

    // Stato 1: feature non installata → setup wizard (solo admin)
    if (!state.enabled) {
      return <NetworkServicesSetup isAdmin={isAdmin} initialApiUrl="" hasToken={false} />;
    }

    // Stato 2: installata ma config mancante → ri-mostra setup (rare edge case)
    if (!state.configured) {
      return (
        <NetworkServicesSetup
          isAdmin={isAdmin}
          initialApiUrl={state.apiUrl}
          hasToken={false}
          installedButMissingConfig
        />
      );
    }

    // Stato 3: installata + configurata → dashboard
    let initialError: string | null = null;
    let bridge: Awaited<ReturnType<Awaited<ReturnType<typeof makeNetServicesClient>>["status"]>> | null = null;
    let resolver: Awaited<ReturnType<Awaited<ReturnType<typeof makeNetServicesClient>>["resolverStatus"]>> | null = null;
    let adblock: Awaited<ReturnType<Awaited<ReturnType<typeof makeNetServicesClient>>["adblockStats"]>> | null = null;
    try {
      const client = await makeNetServicesClient(tenantCode);
      [bridge, resolver, adblock] = await Promise.all([
        client.status(),
        client.resolverStatus().catch(() => null),
        client.adblockStats().catch(() => null),
      ]);
    } catch (e) {
      initialError =
        e instanceof BridgeUnavailableError
          ? `Bridge non raggiungibile: ${e.message}`
          : String(e);
    }

    return (
      <NetworkServicesClient
        apiBase={state.apiUrl}
        initialBridge={bridge}
        initialResolver={resolver}
        initialAdblock={adblock}
        initialError={initialError}
        isAdmin={isAdmin}
      />
    );
  });
}
