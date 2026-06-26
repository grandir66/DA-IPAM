import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import {
  makeNetServicesClient,
  BridgeUnavailableError,
} from "@/lib/network-services/client";

const ReservationSchema = z.object({
  ip_address: z.string().min(1),
  hw_address: z.string().optional(),
  client_id: z.string().optional(),
  hostname: z.string().optional(),
  subnet_id: z.number().int().positive().optional(),
});

const DeleteSchema = z.object({
  ip_address: z.string().optional(),
  hw_address: z.string().optional(),
  client_id: z.string().optional(),
  subnet_id: z.number().int().positive().optional(),
});

function tenantOrError(): { tenantCode: string } | NextResponse {
  const tenantCode = getCurrentTenantCode();
  if (!tenantCode) return NextResponse.json({ error: "Tenant non risolto" }, { status: 400 });
  return { tenantCode };
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
    const parsed = ReservationSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    if (!parsed.data.hw_address && !parsed.data.client_id) {
      return NextResponse.json({ error: "hw_address o client_id obbligatorio" }, { status: 400 });
    }
    try {
      const client = await makeNetServicesClient(t.tenantCode);
      return NextResponse.json(await client.addDhcpReservation(parsed.data));
    } catch (e) {
      if (e instanceof BridgeUnavailableError) {
        return NextResponse.json({ ok: false, error: e.message }, { status: e.statusCode ?? 503 });
      }
      return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
    }
  });
}

export async function DELETE(req: Request) {
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
    const parsed = DeleteSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    if (!parsed.data.ip_address && !parsed.data.hw_address && !parsed.data.client_id) {
      return NextResponse.json({ error: "Specificare ip_address o identifier" }, { status: 400 });
    }
    try {
      const client = await makeNetServicesClient(t.tenantCode);
      return NextResponse.json(await client.deleteDhcpReservation(parsed.data));
    } catch (e) {
      if (e instanceof BridgeUnavailableError) {
        return NextResponse.json({ ok: false, error: e.message }, { status: e.statusCode ?? 503 });
      }
      return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
    }
  });
}

export async function GET() {
  return withTenantFromSession(async () => {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;
    const t = tenantOrError();
    if (t instanceof NextResponse) return t;
    try {
      const client = await makeNetServicesClient(t.tenantCode);
      const reservations = await client.dhcpReservations();
      return NextResponse.json({ ok: true, ...reservations });
    } catch (e) {
      if (e instanceof BridgeUnavailableError) {
        return NextResponse.json({ ok: false, error: e.message }, { status: e.statusCode ?? 503 });
      }
      return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
    }
  });
}
