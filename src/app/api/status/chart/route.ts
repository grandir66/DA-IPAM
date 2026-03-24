import { NextRequest, NextResponse } from "next/server";
import { getOnlineCountsOverTime } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;
  const hours = Number(request.nextUrl.searchParams.get("hours") || "24");
  const data = getOnlineCountsOverTime(Math.min(hours, 720));
  return NextResponse.json(data);
}
