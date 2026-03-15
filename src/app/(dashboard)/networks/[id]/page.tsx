import { notFound } from "next/navigation";
import { getNetworkById, getHostsByNetwork, getNmapProfiles, getNetworkRouterId, getRouters } from "@/lib/db";
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

  const hosts = getHostsByNetwork(Number(id));
  const profiles = getNmapProfiles();
  const routerId = getNetworkRouterId(Number(id));
  const routers = getRouters();

  return (
    <NetworkDetailClient
      network={network}
      initialHosts={hosts}
      routerId={routerId}
      routers={routers}
      nmapProfiles={profiles.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        args: p.args,
        is_default: p.is_default,
      }))}
    />
  );
}
