import { NextRequest, NextResponse } from "next/server";
import { getRecentStatusChanges } from "@/lib/db";
import { withTenantFromSession } from "@/lib/api-tenant";
import { requireAuth, isAuthError } from "@/lib/api-auth";

/**
 * Recenti transizioni di stato (online↔offline) sui host monitorati.
 * Query: ?limit=10&hours=24 (default 10, max 100; hours default 24, max 168).
 */
export async function GET(request: NextRequest) {
  return withTenantFromSession(async () => {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit") || "10"), 1), 100);
    const hours = Math.min(Math.max(Number(request.nextUrl.searchParams.get("hours") || "24"), 1), 168);
    const data = getRecentStatusChanges(limit, hours);
    return NextResponse.json(data);
  });
}
