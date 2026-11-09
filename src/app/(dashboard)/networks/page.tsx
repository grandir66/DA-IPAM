import { getNetworks, getArpSourceDevices } from "@/lib/db";
import { NetworksListClient } from "./networks-list-client";
import { RetiProposte } from "./reti-proposte";
import { getServerTenantCode } from "@/lib/api-tenant";
import { withTenant } from "@/lib/db-tenant";
import { retiProposte, type ReteProposta } from "@/lib/trunk/reti-proposte";
import { auth } from "@/lib/auth";

export default async function NetworksPage() {
  const tenantCode = await getServerTenantCode();
  const networks = withTenant(tenantCode, () => getNetworks()) ?? [];
  const routers = withTenant(tenantCode, () => getArpSourceDevices()) ?? [];
  // Le proposte non devono mai impedire di vedere le subnet: un guasto del sensore = nessuna proposta.
  let proposte: ReteProposta[] = [];
  try {
    proposte = withTenant(tenantCode, () => retiProposte(networks.map((n) => n.cidr)));
  } catch (e) {
    console.error("[subnet] reti proposte dal trunk:", e);
  }
  const ruolo = ((await auth())?.user as { role?: string } | undefined)?.role;
  return (
    <NetworksListClient
      initialNetworks={networks}
      routers={routers}
      sottoIntestazione={<RetiProposte proposte={proposte} admin={ruolo === "admin" || ruolo === "superadmin"} />}
    />
  );
}
