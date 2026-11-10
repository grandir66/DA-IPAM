import Link from "next/link";
import { notFound } from "next/navigation";
import { IntestazionePagina, Pannello, Vuoto } from "@/components/shared/console";
import { Button } from "@/components/ui/button";
import { getServerTenantCode } from "@/lib/api-tenant";
import { getNetworkById, withTenant } from "@/lib/db-tenant";

export default async function NetworkChangesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const reteId = Number(id);
  if (!Number.isSafeInteger(reteId) || reteId <= 0) notFound();

  const tenant = await getServerTenantCode();
  const rete = withTenant(tenant, () => getNetworkById(reteId));
  if (!rete) notFound();

  return (
    <div className="space-y-4">
      <IntestazionePagina
        titolo="Network Changes"
        sottotitolo={`${rete.name} · ${rete.cidr}`}
        azioni={
          <Button variant="outline" nativeButton={false} render={<Link href={`/networks/${reteId}`} />}>
            Torna alla subnet
          </Button>
        }
      />
      <Pannello titolo="Confronto tra giri">
        <Vuoto
          titolo="Confronto non ancora disponibile"
          testo="La raccolta delle differenze da Discovery è in preparazione. Qui vedrai i cambiamenti tra due giri comparabili."
        />
      </Pannello>
    </div>
  );
}
