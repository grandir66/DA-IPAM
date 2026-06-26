// src/app/api/tenant/export/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";
import { getHubDb } from "@/lib/db-hub";
import { exportTenant } from "@/lib/transfer/export";
import type { Tier } from "@/lib/transfer/types";
import pkg from "../../../../../package.json";

const schema = z.object({
  passphrase: z.string().min(8, "Passphrase di almeno 8 caratteri"),
  tiers: z.array(z.enum(["config", "asset", "history", "mirror"])).default(["asset", "mirror"]),
  includeVault: z.boolean().default(false),
});

export async function POST(req: Request) {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) return NextResponse.json({ error: "Tenant non risolto" }, { status: 400 });

    const exportedAt = new Date().toISOString();
    const bundle = exportTenant({
      tenantDb: getTenantDb(tenantCode),
      hubDb: getHubDb(),
      options: {
        tenantCode,
        tiers: parsed.data.tiers as Tier[],
        includeVault: parsed.data.includeVault,
        passphrase: parsed.data.passphrase,
        exportedAt,
        appVersion: (pkg as { version: string }).version,
      },
    });

    const fname = `${tenantCode}-${exportedAt.replace(/[:.]/g, "-")}.dab`;
    return new NextResponse(new Uint8Array(bundle), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${fname}"`,
      },
    });
  });
}
