/**
 * POST /api/inventory/bulk-from-hosts
 *
 * Crea (idempotente) un inventory_asset NIS2 per ogni host_id in lista, riusando
 * la funzione `ensureInventoryAssetForHost` esistente. Se l'asset c'è già, viene
 * skippato. Se `categoria_nis2`/`criticita_nis2` sono passati, vengono applicati
 * a tutti gli asset (creati o esistenti).
 *
 * Body:
 *   { host_ids: number[], categoria_nis2?: string, criticita_nis2?: string }
 *
 * Ritorna: { created: number, skipped: number, updated_nis2: number, errors: string[] }
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import {
  bulkUpdateInventoryAssetByHostId,
  ensureInventoryAssetForHost,
  getHostById,
  getInventoryAssetByHost,
} from "@/lib/db-tenant";

const Body = z.object({
  host_ids: z.array(z.coerce.number().int().positive()).min(1, "host_ids vuoto"),
  categoria_nis2: z.string().max(64).optional(),
  criticita_nis2: z.string().max(32).optional(),
});

export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Body non valido (JSON atteso)" },
        { status: 400 }
      );
    }
    const parsed = Body.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Body non valido" },
        { status: 400 }
      );
    }

    const { host_ids, categoria_nis2, criticita_nis2 } = parsed.data;
    const fields: Record<string, unknown> = {};
    if (categoria_nis2 !== undefined) fields.categoria_nis2 = categoria_nis2;
    if (criticita_nis2 !== undefined) fields.criticita_nis2 = criticita_nis2;

    let created = 0;
    let skipped = 0;
    let updatedNis2 = 0;
    const errors: string[] = [];

    for (const hostId of host_ids) {
      const host = getHostById(hostId);
      if (!host) {
        errors.push(`host ${hostId} non trovato`);
        continue;
      }
      const before = getInventoryAssetByHost(hostId);
      try {
        ensureInventoryAssetForHost(host);
        if (before) skipped++;
        else created++;
      } catch (e) {
        errors.push(`host ${hostId}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      // Applica i campi NIS2 (su asset appena creato o già esistente)
      if (Object.keys(fields).length > 0) {
        try {
          const changes = bulkUpdateInventoryAssetByHostId(hostId, fields);
          if (changes > 0) updatedNis2++;
        } catch {
          // skip silently
        }
      }
    }

    return NextResponse.json({
      created,
      skipped,
      updated_nis2: updatedNis2,
      errors,
      message: `Asset NIS2: ${created} creati, ${skipped} già esistenti${updatedNis2 > 0 ? `, ${updatedNis2} aggiornati con campi NIS2` : ""}`,
    });
  });
}
