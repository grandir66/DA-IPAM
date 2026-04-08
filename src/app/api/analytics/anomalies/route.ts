import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getAnomalyEvents, countAnomalyEvents, countUnacknowledgedAnomalies } from "@/lib/analytics/anomaly-db";
import type { AnomalyType } from "@/types";

export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (isAuthError(session)) return session;

  return withTenantFromSession(async () => {
    const p = req.nextUrl.searchParams;
    const network_id = p.get("network_id") ? Number(p.get("network_id")) : undefined;
    const anomaly_type = (p.get("type") as AnomalyType) || undefined;
    const acknowledged = p.has("acknowledged") ? p.get("acknowledged") === "true" : undefined;
    const limit = Math.min(Number(p.get("limit") ?? 100), 500);
    const offset = Number(p.get("offset") ?? 0);

    const events = getAnomalyEvents({ network_id, anomaly_type, acknowledged, limit, offset });
    const total = countAnomalyEvents({ network_id, anomaly_type, acknowledged });
    const unacked = countUnacknowledgedAnomalies(network_id);

    return NextResponse.json({ events, total, unacked });
  });
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (isAuthError(session)) return session;

  return withTenantFromSession(async () => {
    const { runAnomalyCheckManual } = await import("@/lib/analytics/anomaly-run");
    const body = (await req.json()) as { network_id?: number };
    const created = await runAnomalyCheckManual(body.network_id ?? null);
    return NextResponse.json({ created });
  });
}
