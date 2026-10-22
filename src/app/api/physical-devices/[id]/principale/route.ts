/**
 * PUT /api/physical-devices/[id]/principale
 *
 * «Scegli come principale» (piano 2026-10-22 accorpamento, Task 6): quale IP del cluster porta la riga in Discovery.
 * Solo admin. 400 se l'host non è del cluster, 409 se il cluster ha un apparato gestito (il principale è il suo IP).
 *
 * Body: { host_id: number }
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { scegliPrincipale } from "@/lib/devices/physical-device-db";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

const BodySchema = z.object({ host_id: z.number().int().positive() });

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    const { id } = await context.params;
    const physicalDeviceId = Number(id);
    if (!Number.isInteger(physicalDeviceId) || physicalDeviceId <= 0) {
      return NextResponse.json({ error: "ID non valido" }, { status: 400 });
    }

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

    const esito = scegliPrincipale(physicalDeviceId, parsed.data.host_id);
    if (!esito.ok) return NextResponse.json({ error: esito.error }, { status: esito.status, headers: NO_CACHE_HEADERS });
    return NextResponse.json({ ok: true }, { headers: NO_CACHE_HEADERS });
  });
}
