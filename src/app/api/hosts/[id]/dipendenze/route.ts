import { NextResponse } from "next/server";
import { withTenantFromSession } from "@/lib/api-tenant";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { dipendenzeDelHost } from "@/lib/devices/server-scheda";

/**
 * GET: sola lettura. I servizi NIS2 che dipendono da questo host (host → asset di inventario →
 * `service_asset_dependencies` → `services`), per la tab «Dipendenze» della scheda dei server.
 * Un host senza asset risponde `{ servizi: [] }`, non un errore.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const guardia = await requireAuth();
      if (isAuthError(guardia)) return guardia;
      const hostId = parseInt((await params).id, 10);
      if (isNaN(hostId)) return NextResponse.json({ error: "ID non valido" }, { status: 400 });
      const r = dipendenzeDelHost(hostId);
      if (!r) return NextResponse.json({ error: "Host non trovato" }, { status: 404 });
      return NextResponse.json(r);
    } catch (error) {
      console.error("Dipendenze dell'host error:", error);
      return NextResponse.json({ error: "Errore nella lettura delle dipendenze" }, { status: 500 });
    }
  });
}
