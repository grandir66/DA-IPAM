import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { netServices, BridgeUnavailableError } from "@/lib/network-services/client";

export async function GET() {
  const session = await requireAuth();
  if (session instanceof NextResponse) return session;

  try {
    const [bridge, resolver, adblock] = await Promise.all([
      netServices.status(),
      netServices.resolverStatus().catch(() => null),
      netServices.adblockStats().catch(() => null),
    ]);
    return NextResponse.json({ ok: true, bridge, resolver, adblock });
  } catch (e) {
    if (e instanceof BridgeUnavailableError) {
      return NextResponse.json({ ok: false, error: e.message, configured: false }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
