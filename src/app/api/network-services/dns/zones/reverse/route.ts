import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { makeNetServicesClient, BridgeUnavailableError } from "@/lib/network-services/client";

const CidrSchema = z.object({
  cidr: z
    .string()
    .regex(
      /^\d{1,3}(\.\d{1,3}){3}\/(8|16|24)$/,
      "CIDR IPv4 /8, /16 o /24 (es. 192.168.99.0/24)",
    ),
});

export async function POST(req: Request) {
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
    const parsed = CidrSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    try {
      const client = await makeNetServicesClient(tenantCode);
      return NextResponse.json(await client.addReverseZone(parsed.data.cidr));
    } catch (e) {
      if (e instanceof BridgeUnavailableError) {
        return NextResponse.json({ error: e.message }, { status: e.statusCode ?? 503 });
      }
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  });
}
