/**
 * GET /api/hosts/[id]/software-scans?limit=20&offset=0
 *
 * Lista paginated degli scan software per un host (newest first).
 */

import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getSoftwareScansForHost } from "@/lib/db-tenant";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;

    const { id } = await params;
    const hostId = Number(id);
    if (!Number.isFinite(hostId) || hostId <= 0) {
      return NextResponse.json({ error: "id host non valido" }, { status: 400 });
    }

    const url = new URL(request.url);
    const limit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
    const offset = Number.parseInt(url.searchParams.get("offset") ?? "0", 10);

    const scans = getSoftwareScansForHost(
      hostId,
      Number.isFinite(limit) ? limit : 20,
      Number.isFinite(offset) ? offset : 0
    );
    return NextResponse.json({ scans });
  });
}
