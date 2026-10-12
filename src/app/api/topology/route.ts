import { NextResponse } from "next/server";
import { getTopologyData, getTopologyPositions } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { buildTopologyGraph } from "@/lib/topology/graph";
import { deriveNodeStatus } from "@/lib/topology/status";
import type { TopologyStatus } from "@/lib/topology/types";

export async function GET(request: Request) {
  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;
    try {
      const { searchParams } = new URL(request.url);
      const view = searchParams.get("view") || "default";
      const data = getTopologyData();
      const now = Date.now();

      const statusByNode = new Map<string, TopologyStatus>();
      for (const h of data.hosts) {
        const id = `host:${h.id}`;
        statusByNode.set(
          id,
          deriveNodeStatus({
            hostStatus: (h.status as "online" | "offline" | "unknown" | null) ?? null,
            latencyMs: h.last_response_time_ms,
            lastSeen: h.last_seen,
            libreStatus: data.libreStatus.get(`${h.network_id}|${h.ip}`) ?? null,
            anomalySeverity: data.anomalyBySeverity.get(id) ?? null,
            nowMs: now,
          }),
        );
      }
      for (const d of data.devices) {
        const id = `dev:${d.id}`;
        statusByNode.set(
          id,
          deriveNodeStatus({ deviceEnabled: d.enabled === 1, uplinkDown: data.portsDown.has(d.id), nowMs: now }),
        );
      }

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
