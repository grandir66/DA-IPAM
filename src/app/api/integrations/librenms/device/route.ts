import { NextResponse } from "next/server";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { addSingleNetworkDeviceToLibreNMS } from "@/lib/integrations/librenms-sync";
import { z } from "zod";

const Schema = z.object({
  device_id: z.number().int().positive(),
});

/** POST /api/integrations/librenms/device — aggiunge/aggiorna un NetworkDevice in LibreNMS */
export async function POST(req: Request) {
  return withTenantFromSession(async () => {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    let body: unknown = {};
    try { body = await req.json(); } catch { /* body vuoto */ }

    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dati non validi" }, { status: 400 });
    }

    try {
      const result = await addSingleNetworkDeviceToLibreNMS(parsed.data.device_id);
      return NextResponse.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: 422 });
    }
  });
}

/** GET /api/integrations/librenms/device — restituisce il mapping IP → device_id per tutti i NetworkDevice */
export async function GET() {
  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;

    const { getLibreNMSMapForNetworkDevices } = await import("@/lib/integrations/librenms-db");
    const maps = getLibreNMSMapForNetworkDevices();
    return NextResponse.json(maps);
  });
}
