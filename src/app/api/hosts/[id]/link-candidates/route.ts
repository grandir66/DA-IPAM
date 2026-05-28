/**
 * GET /api/hosts/[id]/link-candidates?limit=20
 *
 * Ritorna i host candidati per essere linkati allo stesso physical_device
 * dell'host indicato, ordinati per affinity score (rete, vendor, manufacturer,
 * OS family, OUI MAC, prefisso hostname).
 *
 * Usato dal modale "Collega altro IP a questo device" in /objects/[id]
 * e dal bulk-action in /discovery.
 */

import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getLinkCandidatesForHost } from "@/lib/devices/physical-device-db";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;

    const { id } = await context.params;
    const hostId = Number(id);
    if (!Number.isFinite(hostId) || hostId <= 0) {
      return NextResponse.json({ error: "ID host non valido" }, { status: 400 });
    }

    const url = new URL(request.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || "20")));

    const candidates = getLinkCandidatesForHost(hostId, limit);
    return NextResponse.json({ candidates }, { headers: NO_CACHE_HEADERS });
  });
}
