import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import {
  makeNetServicesClient,
  BridgeUnavailableError,
} from "@/lib/network-services/client";

const RuleSchema = z.object({
  rule: z.string().min(1).max(500),
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
      return NextResponse.json({ ok: true, ...(await client.adblockRules()) });
    } catch (e) {
      if (e instanceof BridgeUnavailableError) return NextResponse.json({ ok: false, error: e.message }, { status: e.statusCode ?? 503 });
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
    const parsed = RuleSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    try {
      const client = await makeNetServicesClient(t.tenantCode);
      return NextResponse.json(await client.addAdblockRule(parsed.data.rule));
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
    const parsed = RuleSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    try {
      const client = await makeNetServicesClient(t.tenantCode);
      return NextResponse.json(await client.removeAdblockRule(parsed.data.rule));
    } catch (e) {
      if (e instanceof BridgeUnavailableError) return NextResponse.json({ error: e.message }, { status: e.statusCode ?? 503 });
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  });
}
