import { NextResponse } from "next/server";
import { getHostsByNetwork, getAllHosts, upsertHost } from "@/lib/db";
import { HostSchema } from "@/lib/validators";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";

export async function GET(request: Request) {
  try {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;
    const { searchParams } = new URL(request.url);
    const networkId = searchParams.get("network_id");
    const limitParam = searchParams.get("limit");

    if (networkId) {
      const hosts = getHostsByNetwork(Number(networkId));
      return NextResponse.json(hosts);
    }

    // Senza network_id: restituisce tutti gli host (per pagina Dispositivi unificata)
    const limit = limitParam ? Math.min(Math.max(1, parseInt(limitParam, 10)), 50000) : 10000;
    const hosts = getAllHosts(limit);
    return NextResponse.json(hosts);
  } catch (error) {
    console.error("Error fetching hosts:", error);
    return NextResponse.json({ error: "Errore nel recupero degli host" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const body = await request.json();
    const parsed = HostSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const host = upsertHost(parsed.data);
    return NextResponse.json(host, { status: 201 });
  } catch (error) {
    console.error("Error creating host:", error);
    return NextResponse.json({ error: "Errore nella creazione dell'host" }, { status: 500 });
  }
}
