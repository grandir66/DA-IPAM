import { NextResponse } from "next/server";
import { withTenantFromSession } from "@/lib/api-tenant";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { adDelHost } from "@/lib/devices/server-scheda";

/**
 * GET: sola lettura. Il computer dell'host in Active Directory (OU, sistema, ultimo logon) e, solo se il server
 * è un domain controller, i rilievi dell'ultimo controllo AD riuscito. `rilievi: null` = non è DC o non c'è un
 * controllo; `[]` = controllato e pulito. Per la tab «Active Directory» della scheda dei server Windows.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const guardia = await requireAuth();
      if (isAuthError(guardia)) return guardia;
      const hostId = parseInt((await params).id, 10);
      if (isNaN(hostId)) return NextResponse.json({ error: "ID non valido" }, { status: 400 });
      const r = adDelHost(hostId);
      if (!r) return NextResponse.json({ error: "Host non trovato" }, { status: 404 });
      return NextResponse.json(r);
    } catch (error) {
      console.error("AD dell'host error:", error);
      return NextResponse.json({ error: "Errore nella lettura di Active Directory" }, { status: 500 });
    }
  });
}
