import { NextResponse } from "next/server";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { syncNetworkToLibreNMS, syncAllNetworksToLibreNMS } from "@/lib/integrations/librenms-sync";
import { z } from "zod";

const SyncSchema = z.object({
  network_id: z.number().int().positive().optional(),
});

/** POST /api/integrations/librenms/sync — avvia sync manuale */
export async function POST(req: Request) {
  return withTenantFromSession(async () => {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    let body: unknown = {};
    try {
      body = await req.json();
    } catch { /* body vuoto */ }

    const parsed = SyncSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dati non validi" }, { status: 400 });
    }

    try {
      if (parsed.data.network_id) {
        const result = await syncNetworkToLibreNMS(parsed.data.network_id);
        return NextResponse.json(result);
      } else {
        const results = await syncAllNetworksToLibreNMS();
        return NextResponse.json(results);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  });
}

/** GET /api/integrations/librenms/sync?network_id=X — stato mapping per una rete */
export async function GET(req: Request) {
  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;

    const url = new URL(req.url);
    const networkId = url.searchParams.get("network_id");

    if (!networkId) {
      return NextResponse.json({ error: "network_id richiesto" }, { status: 400 });
    }

    const { getLibreNMSMapForNetwork } = await import("@/lib/integrations/librenms-db");
    const maps = getLibreNMSMapForNetwork(Number(networkId));
    return NextResponse.json(maps);
  });
}
