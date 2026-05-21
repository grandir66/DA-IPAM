import { NextResponse } from "next/server";
import { getInventoryAssets } from "@/lib/db";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { buildAssetGapReports, summarizeGaps } from "@/lib/inventory/nis2-gaps";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

/**
 * GET /api/inventory/gaps
 *
 * Restituisce l'elenco dei gap NIS2 per ogni asset in scope, più un riepilogo
 * aggregato per dashboard (severità, categorie, score medio).
 *
 * Query param `?only_with_gaps=1` filtra gli asset privi di non-conformità.
 */
export async function GET(request: Request) {
  return withTenantFromSession(async () => {
    try {
      const authCheck = await requireAdmin();
      if (isAuthError(authCheck)) return authCheck;

      const { searchParams } = new URL(request.url);
      const onlyWithGaps = searchParams.get("only_with_gaps") === "1";

      const assets = getInventoryAssets({ in_scope_nis2: 1, limit: 1000 });
      const reports = buildAssetGapReports(assets);
      const summary = summarizeGaps(reports);
      const data = onlyWithGaps ? reports.filter((r) => r.gaps.length > 0) : reports;

      return NextResponse.json({ summary, reports: data }, { headers: NO_CACHE_HEADERS });
    } catch (error) {
      console.error("[inventory/gaps] error:", error);
      return NextResponse.json({ error: "Errore nel calcolo dei gap NIS2" }, { status: 500 });
    }
  });
}
