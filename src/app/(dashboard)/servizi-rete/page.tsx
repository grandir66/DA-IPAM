import { getServerTenantCode } from "@/lib/api-tenant";
import { withTenant, allineaServiziRete, getNetworks, getProposteIdentita, getConteggiIdentita } from "@/lib/db-tenant";
import { elencoServiziRete } from "@/lib/servizi-rete/elenco";
import { statoGiro } from "@/lib/servizi-rete/giro";
import { auth } from "@/lib/auth";
import { ServiziReteClient } from "./servizi-rete-client";

export const dynamic = "force-dynamic";

export default async function ServiziRetePage() {
  const tenantCode = await getServerTenantCode();
  const dati = withTenant(tenantCode, () => {
    // Le porte già trovate dalle scansioni entrano subito, anche prima del primo giro di sonde.
    allineaServiziRete();
    return {
      servizi: elencoServiziRete({ limit: 100, pagina: 1 }),
      reti: getNetworks().map((n) => ({ id: n.id, nome: n.name, cidr: n.cidr })),
      identita: { righe: getProposteIdentita(), conteggi: getConteggiIdentita() },
    };
  });
  const ruolo = ((await auth())?.user as { role?: string } | undefined)?.role;
  return (
    <ServiziReteClient
      iniziale={{ ...dati.servizi, giro: statoGiro(tenantCode) }}
      reti={dati.reti}
      identita={dati.identita}
      admin={ruolo === "admin" || ruolo === "superadmin"}
    />
  );
}
