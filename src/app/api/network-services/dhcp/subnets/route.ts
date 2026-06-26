import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import {
  makeNetServicesClient,
  BridgeUnavailableError,
} from "@/lib/network-services/client";

const SubnetSchema = z.object({
  id: z.number().int().positive(),
  subnet: z.string().min(1),
  pool_start: z.string().optional(),
  pool_end: z.string().optional(),
  routers: z.string().optional(),
  domain_name_servers: z.union([z.string(), z.array(z.string())]).optional(),
  domain_name: z.string().optional(),
  "valid-lifetime": z.number().int().positive().optional(),
  "renew-timer": z.number().int().positive().optional(),
  "rebind-timer": z.number().int().positive().optional(),
});

function tenantOrError(): { tenantCode: string } | NextResponse {
  const tenantCode = getCurrentTenantCode();
  if (!tenantCode) return NextResponse.json({ error: "Tenant non risolto" }, { status: 400 });
  return { tenantCode };
}

export async function GET() {
  return withTenantFromSession(async () => {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;
    const t = tenantOrError();
    if (t instanceof NextResponse) return t;
    try {
      const client = await makeNetServicesClient(t.tenantCode);
      const data = await client.dhcpSubnets();
      return NextResponse.json({ ok: true, ...data });
    } catch (e) {
      if (e instanceof BridgeUnavailableError) {
        return NextResponse.json({ ok: false, error: e.message }, { status: e.statusCode ?? 503 });
      }
      return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
    }
  });
}

export async function POST(req: Request) {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;
    const t = tenantOrError();
    if (t instanceof NextResponse) return t;
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = SubnetSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    if (!parsed.data.pool_start || !parsed.data.pool_end) {
      return NextResponse.json({ error: "pool_start e pool_end obbligatori" }, { status: 400 });
    }
    try {
      const client = await makeNetServicesClient(t.tenantCode);
      return NextResponse.json(await client.addDhcpSubnet(parsed.data));
    } catch (e) {
      if (e instanceof BridgeUnavailableError) {
        return NextResponse.json({ ok: false, error: e.message }, { status: e.statusCode ?? 503 });
      }
      return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
    }
  });
}
