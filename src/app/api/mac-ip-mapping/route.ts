import { NextResponse } from "next/server";
import { getMacIpMappings } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/api-auth";

export async function GET(request: Request) {
  try {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;
    const { searchParams } = new URL(request.url);
    const networkId = searchParams.get("network_id");
    const source = searchParams.get("source") as "arp" | "dhcp" | "host" | "switch" | null;
    const q = searchParams.get("q");
    const limit = searchParams.get("limit");

    const mappings = getMacIpMappings({
      ...(networkId && { network_id: Number(networkId) }),
      ...(source && ["arp", "dhcp", "host", "switch"].includes(source) && { source }),
      ...(q && { q }),
      ...(limit && { limit: Math.min(Number(limit) || 500, 1000) }),
    });
    return NextResponse.json(mappings);
  } catch (error) {
    console.error("Error fetching MAC-IP mappings:", error);
    return NextResponse.json({ error: "Errore nel recupero della tabella ARP" }, { status: 500 });
  }
}
