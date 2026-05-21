import { NextResponse } from "next/server";
import { syncInventoryAssetsBulk } from "@/lib/db-tenant";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { z } from "zod";

const BodySchema = z.object({
  asset_ids: z.array(z.coerce.number().int().positive()).min(1, "Lista asset_ids vuota"),
  force: z.boolean().optional(),
});

/**
 * POST /api/inventory/sync-discovery-bulk
 *
 * Body: { asset_ids: number[], force?: boolean }
 *
 * Esegue sync da discovery su una lista di asset. Ritorna i risultati per ogni
 * asset (campi aggiornati, source, eventuale motivo di skip).
 */
export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    const authCheck = await requireAdmin();
    if (isAuthError(authCheck)) return authCheck;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
    }
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Body non valido" }, { status: 400 });
    }

    try {
      const result = syncInventoryAssetsBulk(parsed.data.asset_ids, { force: parsed.data.force });
      return NextResponse.json(result);
    } catch (e) {
      console.error("[sync-discovery-bulk] error:", e);
      return NextResponse.json({ error: "Errore nel sync bulk" }, { status: 500 });
    }
  });
}
