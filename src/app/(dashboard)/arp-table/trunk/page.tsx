import { getServerTenantCode } from "@/lib/api-tenant";
import { withTenant } from "@/lib/db-tenant";
import { getNetworks } from "@/lib/db";
import { getTrunkMatrice, getTrunkOsservazioniPaginated, getTrunkVlan, getTrunkUltimoEsito, getTrunkVlanProtocolli, statoSonda, trunkLetturaAttiva, trunkRiepilogo } from "@/lib/trunk/sensore-trunk";
import { TrunkClient } from "./trunk-client";

export default async function TrunkPage() {
  const tenantCode = await getServerTenantCode();
  const dati = withTenant(tenantCode, () => ({
    attiva: trunkLetturaAttiva(),
    vlan: getTrunkVlan(),
    matrice: getTrunkMatrice(14),
    riepilogo: trunkRiepilogo(),
    vlanProtocolli: getTrunkVlanProtocolli(),
    ...getTrunkOsservazioniPaginated({ limit: 100 }),
    retiIpam: getNetworks().map((n) => n.cidr),
    ultimoEsito: getTrunkUltimoEsito(),
  }));
  // Lo stato vero della sonda, chiesto adesso (pochi secondi al massimo): non basta l'interruttore in Opzioni.
  const sonda = await withTenant(tenantCode, () => statoSonda());
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reti dal trunk</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Quello che il sensore trunk vede sulla porta collegata a tutte le VLAN del cliente: utile dove il router non
          è leggibile. Le scansioni restano sull&apos;IP ufficiale dell&apos;appliance.
        </p>
      </div>
      <TrunkClient iniziale={{ ...dati, sonda }} />
    </div>
  );
}
