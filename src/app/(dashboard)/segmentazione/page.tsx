import { getServerTenantCode } from "@/lib/api-tenant";
import { withTenant, getCelleMatrice, getConteggiSegmentazione, getVistaServizioMatrice } from "@/lib/db-tenant";
import { statoGiroSeg } from "@/lib/segmentazione/giro";
import { auth } from "@/lib/auth";
import { SegmentazioneClient } from "./segmentazione-client";

export const dynamic = "force-dynamic";

export default async function SegmentazionePage() {
  const tenantCode = await getServerTenantCode();
  const dati = withTenant(tenantCode, () => ({
    celle: getCelleMatrice(),
    conteggi: getConteggiSegmentazione(),
    servizi: getVistaServizioMatrice(),
  }));
  const ruolo = ((await auth())?.user as { role?: string } | undefined)?.role;
  return (
    <div className="space-y-4">
      <h1 className="sr-only">Chi raggiunge cosa</h1>
      <SegmentazioneClient
        iniziale={{ ...dati, giro: statoGiroSeg(tenantCode) }}
        admin={ruolo === "admin" || ruolo === "superadmin"}
      />
    </div>
  );
}
