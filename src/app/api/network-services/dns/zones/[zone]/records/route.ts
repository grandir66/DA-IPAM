import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import {
  makeNetServicesClient,
  BridgeUnavailableError,
} from "@/lib/network-services/client";

const ZoneRE = /^[a-zA-Z0-9._-]+$/;
const NameRE = /^[@a-zA-Z0-9._*-]+$/;
const TypeRE = /^[A-Z0-9]+$/;

const AddSchema = z.object({
  name: z.string().regex(NameRE, "name invalido").max(253),
  type: z.string().regex(TypeRE, "type invalido").max(16),
  contents: z.array(z.string().min(1).max(512)).min(1).max(16),
  ttl: z.number().int().min(0).max(2147483647).default(3600),
});

const DeleteSchema = z.object({
  name: z.string().regex(NameRE).max(253),
  type: z.string().regex(TypeRE).max(16),
});

function tenantOrError(): { tenantCode: string } | NextResponse {
  const tenantCode = getCurrentTenantCode();
  if (!tenantCode) return NextResponse.json({ error: "Tenant non risolto" }, { status: 400 });
  return { tenantCode };
}

function validZone(zone: string): boolean {
  return ZoneRE.test(zone) && zone.length <= 253;
}

export async function GET(_req: Request, ctx: { params: Promise<{ zone: string }> }) {
  return withTenantFromSession(async () => {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;
    const t = tenantOrError();
    if (t instanceof NextResponse) return t;
    const { zone } = await ctx.params;
    if (!validZone(zone)) return NextResponse.json({ error: "zone invalida" }, { status: 400 });
    try {
      const client = await makeNetServicesClient(t.tenantCode);
      return NextResponse.json({ ok: true, ...(await client.dnsRecords(zone)) });
    } catch (e) {
      if (e instanceof BridgeUnavailableError) {
        return NextResponse.json({ ok: false, error: e.message }, { status: e.statusCode ?? 503 });
      }
      return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
    }
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ zone: string }> }) {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;
    const t = tenantOrError();
    if (t instanceof NextResponse) return t;
    const { zone } = await ctx.params;
    if (!validZone(zone)) return NextResponse.json({ error: "zone invalida" }, { status: 400 });
    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = AddSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    try {
      const client = await makeNetServicesClient(t.tenantCode);
      const { name, type, contents, ttl } = parsed.data;
      return NextResponse.json(await client.addDnsRecord(zone, name, type, contents, ttl));
    } catch (e) {
      if (e instanceof BridgeUnavailableError) return NextResponse.json({ error: e.message }, { status: e.statusCode ?? 503 });
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ zone: string }> }) {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;
    const t = tenantOrError();
    if (t instanceof NextResponse) return t;
    const { zone } = await ctx.params;
    if (!validZone(zone)) return NextResponse.json({ error: "zone invalida" }, { status: 400 });
    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = DeleteSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    try {
      const client = await makeNetServicesClient(t.tenantCode);
      return NextResponse.json(await client.removeDnsRecord(zone, parsed.data.name, parsed.data.type));
    } catch (e) {
      if (e instanceof BridgeUnavailableError) return NextResponse.json({ error: e.message }, { status: e.statusCode ?? 503 });
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  });
}
