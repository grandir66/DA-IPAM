import { getServerTenantCode } from "@/lib/api-tenant";
import { withTenant } from "@/lib/db-tenant";
import { getNetworks } from "@/lib/db";
import { getTrunkOsservazioniPaginated, getTrunkVlan, trunkLetturaAttiva } from "@/lib/trunk/sensore-trunk";
import { TrunkClient } from "./trunk-client";

export default async function TrunkPage() {
  const tenantCode = await getServerTenantCode();
  const dati = withTenant(tenantCode, () => ({
    attiva: trunkLetturaAttiva(),
    vlan: getTrunkVlan(),
    ...getTrunkOsservazioniPaginated({ limit: 100 }),
    retiIpam: getNetworks().map((n) => n.cidr),
  }));
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">VLAN viste sul trunk</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Quello che il sensore trunk vede sulla porta collegata a tutte le VLAN del cliente: utile dove il router non
          è leggibile. Le scansioni restano sull&apos;IP ufficiale dell&apos;appliance.
        </p>
      </div>
      <TrunkClient iniziale={dati} />
    </div>
  );
}
