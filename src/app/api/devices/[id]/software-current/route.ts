/**
 * GET /api/devices/[id]/software-current
 *
 * Inventario dell'ultimo scan `status='ok'` per il device. Ritorna null se non
 * esiste alcuno scan ok.
 */

import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import {
  getLatestOkSoftwareScanForDevice,
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
    const deviceId = Number(id);
    if (!Number.isFinite(deviceId) || deviceId <= 0) {
      return NextResponse.json({ error: "id device non valido" }, { status: 400 });
    }

    const scan = getLatestOkSoftwareScanForDevice(deviceId);
    if (!scan) {
      return NextResponse.json({ scan: null, inventory: [] });
    }
    const inventory = getSoftwareInventoryForScan(scan.id);
    return NextResponse.json({ scan, inventory });
  });
}
