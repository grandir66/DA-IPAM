import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCredentialCoverageByCategory } from "@/lib/db-tenant";

/**
 * Vista di copertura credenziali (Fase 4b Task 4, spec §7.6): per ogni
 * categoria attribuita con un protocollo pertinente noto (network.* → snmp,
 * compute.workstation → winrm, compute.server/hypervisor → winrm/ssh/redfish,
 * av.camera → onvif, storage.* → ssh/snmp), quanti host totali e quanti hanno
 * almeno una credenziale validata sul protocollo giusto. Sola lettura,
 * nessun side-effect — GET con requireAuth (dato tenant-sensibile ma non
 * di mutazione).
 */
export async function GET() {
  return withTenantFromSession(async () => {
    try {
      const authCheck = await requireAuth();
      if (isAuthError(authCheck)) return authCheck;

      const coverage = getCredentialCoverageByCategory();
      return NextResponse.json({ coverage });
    } catch (error) {
      console.error("Error fetching credential coverage:", error);
      return NextResponse.json({ error: "Errore nel recupero della copertura credenziali" }, { status: 500 });
    }
  });
}
