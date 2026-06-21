import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import {
  makeNetServicesClient,
  BridgeUnavailableError,
} from "@/lib/network-services/client";

const PatchSchema = z.object({
  subnet: z.string().min(1).optional(),
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

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;
    const t = tenantOrError();
    if (t instanceof NextResponse) return t;
    const { id } = await ctx.params;
    const subnetId = Number(id);
    if (!Number.isFinite(subnetId) || subnetId <= 0) {
      return NextResponse.json({ error: "subnet id invalido" }, { status: 400 });
    }
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    try {
      const client = await makeNetServicesClient(t.tenantCode);
      return NextResponse.json(await client.updateDhcpSubnet(subnetId, parsed.data));
    } catch (e) {
      if (e instanceof BridgeUnavailableError) {
        return NextResponse.json({ ok: false, error: e.message }, { status: e.statusCode ?? 503 });
      }
      return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
    }
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;
    const t = tenantOrError();
    if (t instanceof NextResponse) return t;
    const { id } = await ctx.params;
    const subnetId = Number(id);
    if (!Number.isFinite(subnetId) || subnetId <= 0) {
      return NextResponse.json({ error: "subnet id invalido" }, { status: 400 });
    }
    try {
      const client = await makeNetServicesClient(t.tenantCode);
      return NextResponse.json(await client.deleteDhcpSubnet(subnetId));
    } catch (e) {
      if (e instanceof BridgeUnavailableError) {
        return NextResponse.json({ ok: false, error: e.message }, { status: e.statusCode ?? 503 });
      }
      return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
    }
  });
}
