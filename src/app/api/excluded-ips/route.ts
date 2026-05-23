import { NextResponse } from "next/server";
import { getExcludedIps } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";

export async function GET() {
  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;
    return NextResponse.json({ excluded_ips: getExcludedIps() });
  });
}
