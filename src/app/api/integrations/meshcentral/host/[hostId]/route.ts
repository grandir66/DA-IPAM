/**
 * GET /api/integrations/meshcentral/host/[hostId]
 * Stato Mesh del singolo host (per la card "Controllo remoto"). Lettura → requireAuth.
 */
import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getMeshStatusForHost } from "@/lib/integrations/meshcentral/db";

function parseHostId(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export async function GET(_req: Request, ctx: { params: Promise<{ hostId: string }> }) {
  const { hostId: hostIdRaw } = await ctx.params;
  const hostId = parseHostId(hostIdRaw);
  if (hostId === null) {
    return NextResponse.json({ error: "hostId non valido" }, { status: 400 });
  }
  return withTenantFromSession(async () => {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;
    return NextResponse.json({ mesh: getMeshStatusForHost(hostId) });
  });
}
