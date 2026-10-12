import { NextRequest, NextResponse } from "next/server";
import { getStatusOverTime } from "@/lib/db";
import { withTenantFromSession } from "@/lib/api-tenant";
import { requireAuth, isAuthError } from "@/lib/api-auth";

/**
 * Stato host nel tempo (online/offline/unknown + Health%).
 * Query: ?hours=24|168|720 (default 24, max 720 = 30gg).
 */
export async function GET(request: NextRequest) {
  return withTenantFromSession(async () => {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;
    const h = Number(request.nextUrl.searchParams.get("hours") || "24");
    const hours = Number.isFinite(h) ? Math.min(Math.max(Math.round(h), 1), 720) : 24;
    const data = getStatusOverTime(hours);
    return NextResponse.json(data);
  });
}
