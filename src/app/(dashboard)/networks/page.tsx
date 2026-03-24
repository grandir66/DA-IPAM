import { getNetworks, getRouters } from "@/lib/db";
import { NetworksListClient } from "./networks-list-client";

export default function NetworksPage() {
  const networks = getNetworks() ?? [];
  const routers = getRouters() ?? [];
  return <NetworksListClient initialNetworks={networks} routers={routers} />;
}
