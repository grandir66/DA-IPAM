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

export default async function NetworkDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const network = getNetworkById(Number(id));

  if (!network) {
    notFound();
  }

  const nid = Number(id);
  const hosts = getHostsByNetworkWithDevices(nid);
  const routerId = getNetworkRouterId(nid);
  const routers = getRouters();
  const initialCredentialChains = {
    windows: getNetworkHostCredentialIds(nid, "windows"),
    linux: getNetworkHostCredentialIds(nid, "linux"),
    ssh: getNetworkHostCredentialIds(nid, "ssh"),
    snmp: getNetworkHostCredentialIds(nid, "snmp"),
  };

  // v2: lista unificata credenziali subnet
  const networkCredentials = getNetworkCredentials(nid);
  const initialCredentialIds = networkCredentials.map((c) => c.credential_id);
  const availableSources = getNetworksWithCredentials().filter((n) => n.id !== nid);

  // Badge: protocolli validati per host
  const validatedMap = getHostValidatedProtocolsByNetwork(nid);
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
