import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import {
  makeNetServicesClient,
  BridgeUnavailableError,
} from "@/lib/network-services/client";

const TargetRE = /^[a-fA-F0-9:.]+(@\d{1,5})?$/;
const ZoneRE = /^[a-zA-Z0-9._-]+$/;

const AddSchema = z.object({
  zone: z.string().regex(ZoneRE, "zone must match [a-zA-Z0-9._-]+"),
  targets: z.array(z.string().regex(TargetRE)).min(1).max(8),
});

const DeleteSchema = z.object({
  zone: z.string().regex(ZoneRE),
});

async function tenantOrError(): Promise<{ tenantCode: string } | NextResponse> {
  const tenantCode = getCurrentTenantCode();
  if (!tenantCode) {
    return NextResponse.json({ error: "Tenant non risolto" }, { status: 400 });
  }
  return { tenantCode };
}

export async function GET() {
  return withTenantFromSession(async () => {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;
    const t = await tenantOrError();
    if (t instanceof NextResponse) return t;
    try {
      const client = await makeNetServicesClient(t.tenantCode);
      const res = await client.resolverStatus();
      return NextResponse.json({ ok: true, status: res });
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
    const t = await tenantOrError();
    if (t instanceof NextResponse) return t;
    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = AddSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    try {
      const client = await makeNetServicesClient(t.tenantCode);
      return NextResponse.json(await client.addForwardZone(parsed.data.zone, parsed.data.targets));
    } catch (e) {
      if (e instanceof BridgeUnavailableError) return NextResponse.json({ error: e.message }, { status: e.statusCode ?? 503 });
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  });
}

export async function DELETE(req: Request) {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;
    const t = await tenantOrError();
    if (t instanceof NextResponse) return t;
    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = DeleteSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    try {
      const client = await makeNetServicesClient(t.tenantCode);
      return NextResponse.json(await client.removeForwardZone(parsed.data.zone));
    } catch (e) {
      if (e instanceof BridgeUnavailableError) return NextResponse.json({ error: e.message }, { status: e.statusCode ?? 503 });
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  });
}
