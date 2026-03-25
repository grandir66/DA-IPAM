import { getNetworks, getRouters } from "@/lib/db";
import { NetworksListClient } from "./networks-list-client";
import { getServerTenantCode } from "@/lib/api-tenant";
import { withTenant } from "@/lib/db-tenant";

export default async function NetworksPage() {
  const tenantCode = await getServerTenantCode();
  const networks = withTenant(tenantCode, () => getNetworks()) ?? [];
  const routers = withTenant(tenantCode, () => getRouters()) ?? [];
  return <NetworksListClient initialNetworks={networks} routers={routers} />;
}
