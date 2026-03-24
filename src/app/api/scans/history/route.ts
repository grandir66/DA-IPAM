import { NextResponse } from "next/server";
import { getScanHistory } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/api-auth";

export async function GET(request: Request) {
  try {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;
    const { searchParams } = new URL(request.url);
    const hostId = searchParams.get("host_id");
    const networkId = searchParams.get("network_id");
    const limit = searchParams.get("limit");

    const history = getScanHistory({
      host_id: hostId ? Number(hostId) : undefined,
      network_id: networkId ? Number(networkId) : undefined,
      limit: limit ? Number(limit) : 100,
    });

    return NextResponse.json(history);
  } catch (error) {
    console.error("Error fetching scan history:", error);
    return NextResponse.json({ error: "Errore nel recupero dello storico" }, { status: 500 });
  }
}
