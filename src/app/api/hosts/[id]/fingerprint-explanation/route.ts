import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getHostById } from "@/lib/db-tenant";
import { buildFingerprintExplanation } from "@/lib/analytics/fingerprint-explain";
import type { DeviceFingerprintSnapshot } from "@/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth();
  if (isAuthError(session)) return session;

  const { id } = await params;
  const hostId = Number(id);
  if (isNaN(hostId)) return NextResponse.json({ error: "ID non valido" }, { status: 400 });

  return withTenantFromSession(async () => {
    const host = getHostById(hostId);
    if (!host) return NextResponse.json({ error: "Host non trovato" }, { status: 404 });

    const detectionJson = (host as unknown as { detection_json?: string | null }).detection_json;
    if (!detectionJson) {
      return NextResponse.json({
        final_device: null,
        final_confidence: 0,
        classification: host.classification ?? "unknown",
        features: [],
        unmatched_signals: [],
      });
    }

    let snap: DeviceFingerprintSnapshot;
    try {
      snap = JSON.parse(detectionJson) as DeviceFingerprintSnapshot;
    } catch {
      return NextResponse.json({ error: "detection_json non valido" }, { status: 500 });
    }

    const explanation = buildFingerprintExplanation(
      snap,
      host.classification ?? "unknown",
      (host as unknown as { vendor?: string | null }).vendor ?? null
    );

    return NextResponse.json(explanation);
  });
}
