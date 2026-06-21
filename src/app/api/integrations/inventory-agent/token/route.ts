import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { generateInventoryIngestToken } from "@/lib/inventory-agent/feature";

export async function POST() {
  return withTenantFromSession(async () => {
    const admin = await requireAdmin();
    if (isAuthError(admin)) return admin;
    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) {
      return NextResponse.json({ error: "Tenant non risolto" }, { status: 400 });
    }
    try {
      const token = generateInventoryIngestToken(tenantCode);
      return NextResponse.json({
        token,
        created_at: new Date().toISOString(),
        hint: "Conserva il token: non sarà più mostrato. Usalo come Bearer su POST /api/inventory/ingest.",
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Errore generazione token" },
        { status: 500 },
      );
    }
  });
}
