import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { syncUnifiForTenant, unifiSyncFailure } from "@/lib/integrations/unifi-sync";

/**
 * POST /api/integrations/unifi/sync — sincronizzazione manuale del controller
 * UniFi nel tenant della sessione.
 *
 * Legge il controller in sola lettura e scrive solo nel DB del tenant
 * (apparati, porte, vicini LLDP): è una scrittura, quindi admin, controllato
 * per primo. Risponde sempre col resoconto della sync (`errors[]` compreso);
 * `ok` è false quando non si è letto o scritto niente (`unifiSyncFailure`).
 * A integrazione spenta non legge e lo dice in `errors[]`.
 */
export async function POST() {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;

  return withTenantFromSession(async () => {
    const result = await syncUnifiForTenant();
    return NextResponse.json({ ok: unifiSyncFailure(result) === null, ...result });
  });
}
