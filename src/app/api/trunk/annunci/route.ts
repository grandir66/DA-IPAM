/**
 * GET /api/trunk/annunci — chi si presenta da solo sul trunk (MNDP, Ubiquiti, CDP, LLDP), una riga
 * per apparato, con lo stato rispetto a DA-IPAM. Sola lettura.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getAnnunciTrunk } from "@/lib/trunk/annunci";

export async function GET() {
  const session = await requireAuth();
  if (session instanceof NextResponse) return session;
  return withTenantFromSession(() => {
    try {
      return NextResponse.json({ apparati: getAnnunciTrunk() });
    } catch (e) {
      console.error("[trunk] elenco degli annunci:", e);
      return NextResponse.json({ error: "Errore nella lettura degli annunci del trunk" }, { status: 500 });
    }
  });
}
