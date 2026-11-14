import { notFound } from "next/navigation";
import {
  getNetworkById,
  getHostsByNetworkWithDevices,
  getNetworkRouterId,
  getArpSourceDevices,
  getNetworkCredentials,
  getNetworksWithCredentials,
  getHostValidatedProtocolsByNetwork,
} from "@/lib/db";
import { NetworkDetailClient } from "./network-detail-client";
import { getServerTenantCode } from "@/lib/api-tenant";
import { withTenant } from "@/lib/db-tenant";
import { auth } from "@/lib/auth";
import { reteSenzaSegreti, ruoloAdmin } from "@/lib/networks/senza-segreti";

export default async function NetworkDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenantCode = await getServerTenantCode();
  const grezza = withTenant(tenantCode, () => getNetworkById(Number(id)));

  if (!grezza) {
    notFound();
  }
  // La community SNMP non arriva al browser di chi non è admin (P0-1, 14/11).
  const ruolo = ((await auth())?.user as { role?: string } | undefined)?.role;
  const network = reteSenzaSegreti(grezza as unknown as Record<string, unknown>, ruoloAdmin(ruolo)) as unknown as typeof grezza;

  const nid = Number(id);
  const hosts = withTenant(tenantCode, () => getHostsByNetworkWithDevices(nid));
  const routerId = withTenant(tenantCode, () => getNetworkRouterId(nid));
  const routers = withTenant(tenantCode, () => getArpSourceDevices());
  // v2: lista unificata credenziali subnet
  const networkCredentials = withTenant(tenantCode, () => getNetworkCredentials(nid));
  const initialCredentialIds = networkCredentials.map((c) => c.credential_id);
  const availableSources = withTenant(tenantCode, () => getNetworksWithCredentials()).filter((n) => n.id !== nid);

  // Badge: protocolli validati per host
  const validatedMap = withTenant(tenantCode, () => getHostValidatedProtocolsByNetwork(nid));
  const hostValidatedProtocols: Record<number, string[]> = {};
  for (const [hostId, protocols] of validatedMap) {
    hostValidatedProtocols[hostId] = protocols;
  }

  return (
    <NetworkDetailClient
      network={network}
      initialHosts={hosts}
      routerId={routerId}
      routers={routers}
      initialCredentialIds={initialCredentialIds}
      initialAvailableSources={availableSources}
      initialHostValidatedProtocols={hostValidatedProtocols}
    />
  );
}
