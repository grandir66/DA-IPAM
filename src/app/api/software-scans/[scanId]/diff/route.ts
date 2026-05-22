/**
 * GET /api/software-scans/[scanId]/diff?against=<otherScanId>
 *
 * Diff fra due scan dello stesso host: `before = against`, `after = scanId`.
 * Restituisce { added, removed, upgraded, unchangedCount }.
 */

import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import {
  getSoftwareInventoryForScan,
  getSoftwareScanById,
} from "@/lib/db-tenant";
import { computeSoftwareDiff } from "@/lib/probes/software-diff";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ scanId: string }> }
) {
  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;

    const { scanId: scanIdRaw } = await params;
    const scanId = Number(scanIdRaw);
    const url = new URL(request.url);
    const againstId = Number(url.searchParams.get("against") ?? "");

    if (!Number.isFinite(scanId) || scanId <= 0) {
      return NextResponse.json({ error: "scanId non valido" }, { status: 400 });
    }
    if (!Number.isFinite(againstId) || againstId <= 0) {
      return NextResponse.json(
        { error: "Parametro `against` (scanId) obbligatorio" },
        { status: 400 }
      );
    }
    if (scanId === againstId) {
      return NextResponse.json(
        { error: "I due scan da confrontare devono essere diversi" },
        { status: 400 }
      );
    }

    const scan = getSoftwareScanById(scanId);
    const against = getSoftwareScanById(againstId);
    if (!scan || !against) {
      return NextResponse.json({ error: "Scan non trovato" }, { status: 404 });
    }
    if (scan.host_id !== against.host_id) {
      return NextResponse.json(
        { error: "Gli scan devono riferirsi allo stesso host" },
        { status: 400 }
      );
    }

    const before = getSoftwareInventoryForScan(againstId);
    const after = getSoftwareInventoryForScan(scanId);
    const diff = computeSoftwareDiff(before, after);

    return NextResponse.json({
      scan: { id: scan.id, started_at: scan.started_at, apps_count: scan.apps_count },
      against: {
        id: against.id,
        started_at: against.started_at,
        apps_count: against.apps_count,
      },
      diff,
    });
  });
}
