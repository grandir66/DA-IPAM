/**
 * POST /api/physical-devices/unlink
 *
 * Scollega un host dal suo physical_device. Se il cluster resta vuoto, NON lo
 * eliminiamo (il chiamante può chiamare /api/physical-devices/[id] DELETE
 * separatamente — non implementato qui per sicurezza).
 *
 * Body: { host_id: number }
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { unlinkHostFromPhysicalDevice } from "@/lib/devices/physical-device-db";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

const BodySchema = z.object({
  host_id: z.number().int().positive(),
});

export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
    }
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }

    try {
      const result = unlinkHostFromPhysicalDevice(parsed.data.host_id);
      return NextResponse.json(result, { headers: NO_CACHE_HEADERS });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Errore nell'unlink";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  });
}
