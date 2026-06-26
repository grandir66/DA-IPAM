import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { makeNetServicesClient, BridgeUnavailableError } from "@/lib/network-services/client";

const TargetRE = /^[a-fA-F0-9:.]+(@\d{1,5})?$/;
const UpstreamSchema = z.object({
  targets: z.array(z.string().regex(TargetRE)).min(1).max(8),
});

export async function GET() {
  return withTenantFromSession(async () => {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;
    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) return NextResponse.json({ error: "Tenant non risolto" }, { status: 400 });
    try {
      const client = await makeNetServicesClient(tenantCode);
      return NextResponse.json({ ok: true, ...(await client.resolverGetUpstream()) });
    } catch (e) {
      if (e instanceof BridgeUnavailableError) {
        return NextResponse.json({ ok: false, error: e.message }, { status: e.statusCode ?? 503 });
      }
      return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
    }
  });
}

export async function PUT(req: Request) {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;
    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) return NextResponse.json({ error: "Tenant non risolto" }, { status: 400 });
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = UpstreamSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    try {
      const client = await makeNetServicesClient(tenantCode);
      return NextResponse.json(await client.resolverSetUpstream(parsed.data.targets));
    } catch (e) {
      if (e instanceof BridgeUnavailableError) {
        return NextResponse.json({ error: e.message }, { status: e.statusCode ?? 503 });
      }
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  });
}
