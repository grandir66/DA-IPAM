import { getNetworks, getArpSourceDevices } from "@/lib/db";
import { NetworksListClient } from "./networks-list-client";
import { RetiProposte } from "./reti-proposte";
import { getServerTenantCode } from "@/lib/api-tenant";
import { withTenant } from "@/lib/db-tenant";
import { retiProposte, type ReteProposta } from "@/lib/trunk/reti-proposte";
import { auth } from "@/lib/auth";
import { reteSenzaSegreti, ruoloAdmin } from "@/lib/networks/senza-segreti";

export default async function NetworksPage() {
  const tenantCode = await getServerTenantCode();
  const ruolo = ((await auth())?.user as { role?: string } | undefined)?.role;
  // La community SNMP non arriva al browser di chi non è admin (P0-1, 14/11).
  const networks = (withTenant(tenantCode, () => getNetworks()) ?? []).map(
    (n) => reteSenzaSegreti(n as unknown as Record<string, unknown>, ruoloAdmin(ruolo)) as unknown as typeof n,
  );
  const routers = withTenant(tenantCode, () => getArpSourceDevices()) ?? [];
  // Le proposte non devono mai impedire di vedere le subnet: un guasto del sensore = nessuna proposta.
  let proposte: ReteProposta[] = [];
  try {
    proposte = withTenant(tenantCode, () => retiProposte(networks.map((n) => n.cidr)));
  } catch (e) {
    console.error("[subnet] reti proposte dal trunk:", e);
  }
  return (
    <NetworksListClient
      initialNetworks={networks}
      routers={routers}
      sottoIntestazione={<RetiProposte proposte={proposte} admin={ruoloAdmin(ruolo)} />}
    />
  );
}
