// src/app/api/tenant/import/route.ts
import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";
import { getHubDb } from "@/lib/db-hub";
import { importTenant } from "@/lib/transfer/import";

export async function POST(req: Request) {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;

    let form: FormData;
    try { form = await req.formData(); } catch { return NextResponse.json({ error: "multipart/form-data atteso" }, { status: 400 }); }

    const file = form.get("bundle");
    const passphrase = form.get("passphrase");
    const wipe = form.get("wipe") === "true";
    if (!(file instanceof File)) return NextResponse.json({ error: "Campo 'bundle' mancante" }, { status: 400 });
    if (typeof passphrase !== "string" || passphrase.length < 8) {
      return NextResponse.json({ error: "Passphrase non valida" }, { status: 400 });
    }

    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) return NextResponse.json({ error: "Tenant non risolto" }, { status: 400 });

    const bundle = Buffer.from(await file.arrayBuffer());
    try {
      const res = importTenant({
        bundle, tenantDb: getTenantDb(tenantCode), hubDb: getHubDb(),
        options: { tenantCode, passphrase, wipe },
      });
      return NextResponse.json({ ok: true, result: res });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
  });
}
