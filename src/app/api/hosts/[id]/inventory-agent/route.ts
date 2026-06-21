import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { getHostById } from "@/lib/db";
import { getCurrentInvAgentSoftware } from "@/lib/inventory-agent/db";
import { isInventoryAgentEnabled } from "@/lib/inventory-agent/feature";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;
    const tenantCode = getCurrentTenantCode();
    if (!tenantCode || !(await isInventoryAgentEnabled(tenantCode))) {
      return NextResponse.json({ enabled: false, endpoint: null, software: [] });
    }
    const { id } = await params;
    const hostId = Number(id);
    const host = getHostById(hostId);
    if (!host) {
      return NextResponse.json({ error: "Host non trovato" }, { status: 404 });
    }
    const data = getCurrentInvAgentSoftware(hostId);
    return NextResponse.json({ enabled: true, ...data });
  });
}
