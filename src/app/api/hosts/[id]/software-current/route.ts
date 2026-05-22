/**
 * GET /api/hosts/[id]/software-current
 *
 * Inventario dell'ultimo scan `status='ok'` per l'host. Ritorna null se non
 * esiste alcuno scan ok.
 */

import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import {
  getLatestOkSoftwareScanForHost,
  getSoftwareInventoryForScan,
} from "@/lib/db-tenant";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;

    const { id } = await params;
    const hostId = Number(id);
    if (!Number.isFinite(hostId) || hostId <= 0) {
      return NextResponse.json({ error: "id host non valido" }, { status: 400 });
    }

    const scan = getLatestOkSoftwareScanForHost(hostId);
    if (!scan) {
      return NextResponse.json({ scan: null, inventory: [] });
    }
    const inventory = getSoftwareInventoryForScan(scan.id);
    return NextResponse.json({ scan, inventory });
  });
}
