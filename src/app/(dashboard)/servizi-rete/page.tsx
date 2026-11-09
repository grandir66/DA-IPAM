import { getServerTenantCode } from "@/lib/api-tenant";
import {
  withTenant,
  allineaServiziRete,
  getServiziRetePaginati,
  getConteggiServiziRete,
  getNetworks,
  getProposteIdentita,
  getConteggiIdentita,
} from "@/lib/db-tenant";
import { statoGiro } from "@/lib/servizi-rete/giro";
import { auth } from "@/lib/auth";
import { IntestazionePagina } from "@/components/shared/console";
import { ServiziReteSchede } from "./servizi-rete-schede";

export const dynamic = "force-dynamic";

export default async function ServiziRetePage() {
  const tenantCode = await getServerTenantCode();
  const dati = withTenant(tenantCode, () => {
    // Le porte già trovate dalle scansioni entrano subito, anche prima del primo giro di sonde.
    allineaServiziRete();
    return {
      servizi: {
        ...getServiziRetePaginati({ limit: 100, offset: 0 }),
        conteggi: getConteggiServiziRete(),
        reti: getNetworks().map((n) => ({ id: n.id, nome: n.name, cidr: n.cidr })),
      },
      identita: { righe: getProposteIdentita(), conteggi: getConteggiIdentita() },
    };
  });
  const ruolo = ((await auth())?.user as { role?: string } | undefined)?.role;
  return (
    <div className="space-y-4">
      <IntestazionePagina
        titolo="Servizi di rete"
        sottotitolo="Cosa risponde su ogni porta aperta e come lo sappiamo. Due IP con la stessa impronta SSH o TLS si propongono come stesso apparato, da confermare."
      />
      <ServiziReteSchede
        servizi={{ ...dati.servizi, giro: statoGiro(tenantCode) }}
        identita={dati.identita}
        admin={ruolo === "admin" || ruolo === "superadmin"}
      />
    </div>
  );
}
