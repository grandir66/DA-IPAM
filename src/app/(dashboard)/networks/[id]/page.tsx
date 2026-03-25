import { notFound } from "next/navigation";
import {
  getNetworkById,
  getHostsByNetworkWithDevices,
  getNetworkRouterId,
  getRouters,
  getNetworkHostCredentialIds,
  getNetworkCredentials,
  getNetworksWithCredentials,
  getHostValidatedProtocolsByNetwork,
} from "@/lib/db";
import { NetworkDetailClient } from "./network-detail-client";
import { getServerTenantCode } from "@/lib/api-tenant";
import { withTenant } from "@/lib/db-tenant";

export default async function NetworkDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenantCode = await getServerTenantCode();
  const network = withTenant(tenantCode, () => getNetworkById(Number(id)));

  if (!network) {
    notFound();
  }

  const nid = Number(id);
  const hosts = withTenant(tenantCode, () => getHostsByNetworkWithDevices(nid));
  const routerId = withTenant(tenantCode, () => getNetworkRouterId(nid));
  const routers = withTenant(tenantCode, () => getRouters());
  const initialCredentialChains = withTenant(tenantCode, () => ({
    windows: getNetworkHostCredentialIds(nid, "windows"),
    linux: getNetworkHostCredentialIds(nid, "linux"),
    ssh: getNetworkHostCredentialIds(nid, "ssh"),
    snmp: getNetworkHostCredentialIds(nid, "snmp"),
  }));

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
      initialCredentialChains={initialCredentialChains}
      initialCredentialIds={initialCredentialIds}
      initialAvailableSources={availableSources}
      initialHostValidatedProtocols={hostValidatedProtocols}
    />
  );
}
