import { NextResponse } from "next/server";
import { updateHost } from "@/lib/db";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { z } from "zod";
import { DEVICE_CLASSIFICATIONS } from "@/lib/device-classifications";

const classificationSchema = z.enum(DEVICE_CLASSIFICATIONS as unknown as [string, ...string[]]);

const BulkHostUpdateSchema = z.object({
  host_ids: z.array(z.coerce.number().int().positive()).min(1, "Selezionare almeno un host"),
  classification: classificationSchema.optional(),
  known_host: z.union([z.literal(0), z.literal(1)]).optional(),
  notes: z.string().max(2000).optional().nullable(),
});

/**
 * PATCH /api/hosts/bulk-update
 * Aggiorna campi comuni su più host (cross-network).
 */
export async function PATCH(request: Request) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;

      const body = await request.json();
      const parsed = BulkHostUpdateSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message ?? "Dati non validi" },
          { status: 400 },
        );
      }

      const { host_ids, classification, known_host, notes } = parsed.data;

      const hasField = classification !== undefined || known_host !== undefined || notes !== undefined;
      if (!hasField) {
        return NextResponse.json(
          { error: "Specificare almeno un campo da aggiornare" },
          { status: 400 },
        );
      }

      let updated = 0;
      for (const id of host_ids) {
        const update: Record<string, unknown> = {};
        if (classification !== undefined) update.classification = classification;
        if (known_host !== undefined) update.known_host = known_host;
        if (notes !== undefined) update.notes = notes;
        const result = updateHost(id, update as Parameters<typeof updateHost>[1]);
        if (result) updated++;
      }

      return NextResponse.json({
        success: true,
        updated,
        message: `${updated} host aggiornato${updated !== 1 ? "i" : ""}`,
      });
    } catch (error) {
      console.error("Bulk host update error:", error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Errore nell'aggiornamento" },
        { status: 500 },
      );
    }
  });
}
