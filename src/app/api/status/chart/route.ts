import { NextRequest, NextResponse } from "next/server";
import { getOnlineCountsOverTime } from "@/lib/db";
import { withTenantFromSession } from "@/lib/api-tenant";

export async function GET(request: NextRequest) {
  return withTenantFromSession(async () => {
    const hours = Number(request.nextUrl.searchParams.get("hours") || "24");
    const data = getOnlineCountsOverTime(Math.min(hours, 720));
    return NextResponse.json(data);
  });
}
