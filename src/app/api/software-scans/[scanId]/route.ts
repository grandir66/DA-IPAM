/**
 * GET /api/software-scans/[scanId]?withLogs=true
 *
 * Dettaglio scan + inventory list. Opzionale: log strutturato del run.
 */

import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import {
  getSoftwareInventoryForScan,
  getSoftwareScanById,
  getSoftwareScanLogs,
} from "@/lib/db-tenant";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ scanId: string }> }
) {
  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;

    const { scanId: scanIdRaw } = await params;
    const scanId = Number(scanIdRaw);
    if (!Number.isFinite(scanId) || scanId <= 0) {
      return NextResponse.json({ error: "scanId non valido" }, { status: 400 });
    }

    const scan = getSoftwareScanById(scanId);
    if (!scan) {
      return NextResponse.json({ error: "Scan non trovato" }, { status: 404 });
    }

    const inventory = getSoftwareInventoryForScan(scanId);

    const url = new URL(request.url);
    const withLogs = url.searchParams.get("withLogs") === "true";
    const logs = withLogs ? getSoftwareScanLogs(scanId) : undefined;

    return NextResponse.json({ scan, inventory, logs });
  });
}
