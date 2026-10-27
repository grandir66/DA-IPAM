/** Reti viste sul trunk nel tempo (2026-10-24): IP per subnet e serie giornaliera. Sola lettura. */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getTrunkMatrice } from "@/lib/trunk/sensore-trunk";

export async function GET(request: Request) {
  const session = await requireAuth();
  if (session instanceof NextResponse) return session;
  return withTenantFromSession(() => {
    const giorni = Number(new URL(request.url).searchParams.get("giorni")) || 14;
    return NextResponse.json(getTrunkMatrice(giorni));
  });
}
