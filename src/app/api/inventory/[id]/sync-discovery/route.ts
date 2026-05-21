import { NextResponse } from "next/server";
import { syncInventoryAssetFromDiscovery } from "@/lib/db-tenant";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";

/**
 * POST /api/inventory/[id]/sync-discovery?force=1
 *
 * Sincronizza un singolo asset di inventario con i dati di discovery del
 * host/network_device collegato. Per default sovrascrive solo i campi vuoti
 * (idempotente). Con `?force=1` sovrascrive anche valori già impostati.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withTenantFromSession(async () => {
    const authCheck = await requireAdmin();
    if (isAuthError(authCheck)) return authCheck;

    const { id } = await params;
    const assetId = Number(id);
    if (!Number.isFinite(assetId) || assetId <= 0) {
      return NextResponse.json({ error: "ID asset non valido" }, { status: 400 });
    }
    const { searchParams } = new URL(request.url);
    const force = searchParams.get("force") === "1";

    try {
      const result = syncInventoryAssetFromDiscovery(assetId, { force });
      return NextResponse.json(result);
    } catch (e) {
      console.error("[sync-discovery] error:", e);
      return NextResponse.json({ error: "Errore nel sync da discovery" }, { status: 500 });
    }
  });
}
