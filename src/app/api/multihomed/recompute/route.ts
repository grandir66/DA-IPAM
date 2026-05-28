/**
 * POST /api/multihomed/recompute
 *
 * Ricalcola la tabella `multihomed_links` per il tenant corrente. Usato per
 * fixare host già aggregati via `physical_device_id` (dall'identity-resolver
 * automatico o da `manualLinkHostsToPhysicalDevice`) ma per cui il recompute
 * non era ancora stato chiamato — il caso reale è host scoperti dal resolver
 * automatico PRIMA dell'introduzione del bridge physical_device → multihomed.
 *
 * Idempotente: re-eseguibile senza side-effect duplicati.
 */
import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { recomputeMultihomedLinks } from "@/lib/db-tenant";

export async function POST() {
  return withTenantFromSession(async () => {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    try {
      const result = recomputeMultihomedLinks();
      return NextResponse.json(result, {
        headers: { "Cache-Control": "no-store" },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Errore recompute";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  });
}
