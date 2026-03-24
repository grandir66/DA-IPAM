import { NextResponse } from "next/server";
import { getHostsByNetwork, getAllHosts, upsertHost } from "@/lib/db";
import { HostSchema } from "@/lib/validators";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { getTenantMode, withTenantFromSession } from "@/lib/api-tenant";
import { queryAllTenants } from "@/lib/db-tenant";

export async function GET(request: Request) {
  const mode = await getTenantMode();
  if (mode.mode === "unauthenticated") {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  if (mode.mode === "all") {
    try {
      const { searchParams } = new URL(request.url);
      const networkId = searchParams.get("network_id");
      const limitParam = searchParams.get("limit");

      const allHosts = queryAllTenants(() => {
        if (networkId) {
          return getHostsByNetwork(Number(networkId)) as unknown as Record<string, unknown>[];
        }
        const limit = limitParam ? Math.min(Math.max(1, parseInt(limitParam, 10)), 50000) : 10000;
        return getAllHosts(limit) as unknown as Record<string, unknown>[];
      });
      return NextResponse.json(allHosts);
    } catch (error) {
      console.error("Error fetching hosts (all tenants):", error);
      return NextResponse.json({ error: "Errore nel recupero degli host" }, { status: 500 });
    }
  }

  return withTenantFromSession(async () => {
    try {
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
  });
}

export async function POST(request: Request) {
  return withTenantFromSession(async () => {
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
  });
}
