import { NextResponse } from "next/server";
import { getServicesByAsset } from "@/lib/db-tenant";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";

/** GET /api/inventory/[id]/services → servizi che dipendono dall'asset. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;
    const { id } = await params;
    return NextResponse.json(getServicesByAsset(Number(id)));
  });
}
