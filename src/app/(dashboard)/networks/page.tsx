import { getNetworks } from "@/lib/db";
import { NetworksListClient } from "./networks-list-client";

export default function NetworksPage() {
  const networks = getNetworks();
  return <NetworksListClient initialNetworks={networks} />;
}
