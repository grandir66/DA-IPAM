/**
 * POST /api/physical-devices/link
 *
 * Collega manualmente N host allo stesso physical_device. Usato quando
 * l'identity-resolver automatico non riesce ad aggregare host che l'utente sa
 * essere lo stesso device fisico (es. interfacce su VLAN diverse senza SNMP
 * visibile, o NIC senza MAC condiviso esposto).
 *
 * Body:
 *   {
 *     host_ids: number[],                     // ≥1, host che diventano lo stesso device
 *     target_physical_device_id?: number      // opzionale: forza il cluster di destinazione
 *   }
 *
 * Risposta: ManualLinkResult (vedi physical-device-db.ts)
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { manualLinkHostsToPhysicalDevice } from "@/lib/devices/physical-device-db";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

const BodySchema = z.object({
  host_ids: z.array(z.number().int().positive()).min(1, "Almeno un host richiesto"),
  target_physical_device_id: z.number().int().positive().nullable().optional(),
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
      const result = manualLinkHostsToPhysicalDevice(
        parsed.data.host_ids,
        parsed.data.target_physical_device_id ?? null,
      );
      return NextResponse.json(result, { headers: NO_CACHE_HEADERS });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Errore nel link manuale";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  });
}
