import { NextResponse } from "next/server";
import { getTopologyData, getTopologyPositions } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { buildTopologyGraph } from "@/lib/topology/graph";
import { computeStatusByNode } from "@/lib/topology/status-map";

export async function GET(request: Request) {
  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;
    try {
      const { searchParams } = new URL(request.url);
      const view = searchParams.get("view") || "default";
      const data = getTopologyData();
      const statusByNode = new Map(Object.entries(computeStatusByNode(data, Date.now())));

      const graph = buildTopologyGraph({
        devices: data.devices,
        hosts: data.hosts,
        neighbors: data.neighbors,
        statusByNode,
      });
      const positions = getTopologyPositions(view);
      return NextResponse.json({ graph, positions });
    } catch (error) {
      console.error("Error building topology:", error);
      return NextResponse.json({ error: "Errore nel calcolo della topologia" }, { status: 500 });
    }
  });
}
