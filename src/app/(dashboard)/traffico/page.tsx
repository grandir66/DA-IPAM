import { getServerTenantCode } from "@/lib/api-tenant";
import { withTenant } from "@/lib/db-tenant";
import { auth } from "@/lib/auth";
import { IntestazionePagina } from "@/components/shared/console";
import { elencoAnomalie } from "@/lib/traffico/anomalie";
import { dbTraffico } from "@/lib/traffico/lettura";
import { nomiDegliIp, quadroTraffico } from "@/lib/traffico/quadro";
import { TrafficoClient } from "./traffico-client";

export const dynamic = "force-dynamic";

export default async function TrafficoPage() {
  const tenantCode = await getServerTenantCode();
  const iniziale = withTenant(tenantCode, () => {
    const elenco = elencoAnomalie(dbTraffico(), { stato: "nuova", pagina: 1 });
    return { ...elenco, nomi: nomiDegliIp(elenco.anomalie.flatMap((a) => [a.client, a.server])), quadro: quadroTraffico() };
  });
  const ruolo = ((await auth())?.user as { role?: string } | undefined)?.role;
  return (
    <div className="space-y-4">
      <IntestazionePagina
        titolo="Traffico"
        sottotitolo="Chi parla con chi, visto dai collector: quello che esce dall'abitudine o passa in chiaro."
      />
      <TrafficoClient iniziale={iniziale} admin={ruolo === "admin" || ruolo === "superadmin"} />
    </div>
  );
}
