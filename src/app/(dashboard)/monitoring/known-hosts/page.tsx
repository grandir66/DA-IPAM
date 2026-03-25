import { getKnownHostsWithNetwork } from "@/lib/db";
import { KnownHostsClient } from "./known-hosts-client";
import { getServerTenantCode } from "@/lib/api-tenant";
import { withTenant } from "@/lib/db-tenant";

export default async function KnownHostsMonitoringPage() {
  const tenantCode = await getServerTenantCode();
  const rows = withTenant(tenantCode, () => getKnownHostsWithNetwork());
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Monitoraggio host conosciuti</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Host segnati come conosciuti (monitoraggio continuo). Gli host offline sono irraggiungibili all&apos;ultimo controllo.
        </p>
      </div>
      <KnownHostsClient initialRows={rows} />
    </div>
  );
}
