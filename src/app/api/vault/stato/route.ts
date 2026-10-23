import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { mostraPasswordAttiva } from "@/lib/vault/mostra";
import { statoVault } from "@/lib/vault/appliance";

/**
 * Stato del vault (piano da-vault 2026-10-23): interruttori, sblocco, slot dell'archivio, OpenBao, pausa delle
 * scansioni. Mai la chiave né un valore. Con gli interruttori spenti dice solo «spento».
 */
export async function GET() {
  return withTenantFromSession(async () => {
    const s = await requireAuth();
    if (isAuthError(s)) return s;
    return NextResponse.json({ ...statoVault(), mostraPassword: mostraPasswordAttiva() }, { headers: { "Cache-Control": "no-store" } });
  });
}
