import { notFound } from "next/navigation";
import {
  getNetworkById,
  getHostsByNetworkWithDevices,
  getNetworkRouterId,
  getRouters,
  getNetworkHostCredentialIds,
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

  return (
    <NetworkDetailClient
      network={network}
      initialHosts={hosts}
      routerId={routerId}
      routers={routers}
      initialCredentialChains={initialCredentialChains}
    />
  );
}
