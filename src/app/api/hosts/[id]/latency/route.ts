import { NextRequest, NextResponse } from "next/server";
import { getHostLatencyHistory } from "@/lib/db";
import { withTenantFromSession } from "@/lib/api-tenant";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const { id } = await params;
      const hours = parseInt(request.nextUrl.searchParams.get("hours") || "24");
      const clampedHours = Math.min(Math.max(hours, 1), 168); // 1h to 7d
      const data = getHostLatencyHistory(Number(id), clampedHours);
      return NextResponse.json(data);
    } catch (error) {
      console.error("Error fetching latency history:", error);
      return NextResponse.json({ error: "Errore nel recupero della latenza" }, { status: 500 });
    }
  });
}
