import { netServices, BridgeUnavailableError } from "@/lib/network-services/client";
import { getNetServicesConfig } from "@/lib/network-services/config";
import { NetworkServicesClient } from "./network-services-client";

/**
 * Network Services — UI per gestione DNS+DHCP+AdBlock+Resolver erogati dalla
 * VM dedicata (ADR-0007). Tutti i 4 servizi sono opt-in: l'admin li attiva
 * dal toggle in questa pagina.
 */
export const dynamic = "force-dynamic";

export default async function NetworkServicesPage() {
  const cfg = getNetServicesConfig();
  if (!cfg.enabled) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="text-2xl font-semibold mb-3">Network Services</h1>
        <div className="rounded border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-900">
          <p className="font-medium">Modulo non configurato</p>
          <p className="mt-1">
            Per attivare la gestione DNS / DHCP / AdBlock / Resolver popolare le env vars{" "}
            <code className="px-1 rounded bg-yellow-100">NET_SERVICES_API_URL</code> e{" "}
            <code className="px-1 rounded bg-yellow-100">NET_SERVICES_API_TOKEN</code> in{" "}
            <code className="px-1 rounded bg-yellow-100">.env.local</code> (vedi ADR-0007 nel repo
            DA-Vul-can).
          </p>
        </div>
      </div>
    );
  }

  let initialError: string | null = null;
  let bridge: Awaited<ReturnType<typeof netServices.status>> | null = null;
  let resolver: Awaited<ReturnType<typeof netServices.resolverStatus>> | null = null;
  let adblock: Awaited<ReturnType<typeof netServices.adblockStats>> | null = null;
  try {
    [bridge, resolver, adblock] = await Promise.all([
      netServices.status(),
      netServices.resolverStatus().catch(() => null),
      netServices.adblockStats().catch(() => null),
    ]);
  } catch (e) {
    initialError =
      e instanceof BridgeUnavailableError
        ? `Bridge non raggiungibile: ${e.message}`
        : String(e);
  }

  return (
    <NetworkServicesClient
      apiBase={cfg.apiUrl}
      initialBridge={bridge}
      initialResolver={resolver}
      initialAdblock={adblock}
      initialError={initialError}
    />
  );
}
