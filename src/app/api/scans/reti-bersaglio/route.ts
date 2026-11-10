/**
 * GET /api/scans/reti-bersaglio — conteggi servizi e host per rete (checkbox Segmentazione).
 */
import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { conteggiRetiBersaglio } from "@/lib/segmentazione/bersagli";

export async function GET() {
  const sessione = await requireAuth();
  if (isAuthError(sessione)) return sessione;
  return withTenantFromSession(() => {
    const tenant = getCurrentTenantCode();
    if (!tenant) return NextResponse.json({ error: "Nessun tenant scelto" }, { status: 400 });
    return NextResponse.json({ reti: conteggiRetiBersaglio(getTenantDb(tenant)) });
  });
}
