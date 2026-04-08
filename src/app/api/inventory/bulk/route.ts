import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getInventoryAssetById, updateInventoryAsset } from "@/lib/db";
import { InventoryBulkUpdateSchema } from "@/lib/validators";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";

/**
 * PATCH /api/inventory/bulk
 * Aggiorna campi comuni su più asset di inventario.
 */
export async function PATCH(request: Request) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;

      const body = await request.json();
      const parsed = InventoryBulkUpdateSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message ?? "Dati non validi" },
          { status: 400 },
        );
      }

      const { asset_ids, ...fields } = parsed.data;

      // Filtra solo i campi effettivamente presenti nel payload (non undefined)
      const updateFields: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) updateFields[key] = value;
      }

      if (Object.keys(updateFields).length === 0) {
        return NextResponse.json(
          { error: "Specificare almeno un campo da aggiornare" },
          { status: 400 },
        );
      }

      const session = await auth();
      const auditUserId = session?.user?.id ? Number(session.user.id) : null;

      let updated = 0;
      const notFound: number[] = [];

      for (const id of asset_ids) {
        const asset = getInventoryAssetById(id);
        if (!asset) {
          notFound.push(id);
          continue;
        }
        updateInventoryAsset(id, updateFields as Parameters<typeof updateInventoryAsset>[1], auditUserId);
        updated++;
      }

      const message = `${updated} asset aggiornato${updated !== 1 ? "i" : ""}${notFound.length > 0 ? `, ${notFound.length} non trovati` : ""}`;
      return NextResponse.json({ success: true, updated, not_found: notFound, message });
    } catch (error) {
      console.error("Bulk inventory update error:", error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Errore nell'aggiornamento" },
        { status: 500 },
      );
    }
  });
}
