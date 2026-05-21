import { NextResponse } from "next/server";
import { attachAssetToService, detachAssetFromService, getServiceAssetDependencies } from "@/lib/db-tenant";
import { ServiceAssetDependencySchema } from "@/lib/validators";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";

/** GET → lista asset linkati al servizio (con dati anagrafici). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;
    const { id } = await params;
    return NextResponse.json(getServiceAssetDependencies(Number(id)));
  });
}

/** POST → collega un asset al servizio (upsert su (service_id, asset_id)). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    const authCheck = await requireAdmin();
    if (isAuthError(authCheck)) return authCheck;
    const { id } = await params;
    let body: unknown;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 }); }
    const parsed = ServiceAssetDependencySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Body non valido" }, { status: 400 });
    }
    try {
      const dep = attachAssetToService(Number(id), parsed.data);
      return NextResponse.json(dep, { status: 201 });
    } catch (e) {
      console.error("[services/assets] attach error:", e);
      return NextResponse.json({ error: "Errore nel collegamento asset" }, { status: 500 });
    }
  });
}

/** DELETE ?asset_id=N → scollega l'asset dal servizio. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    const authCheck = await requireAdmin();
    if (isAuthError(authCheck)) return authCheck;
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const assetId = Number(searchParams.get("asset_id"));
    if (!Number.isFinite(assetId) || assetId <= 0) {
      return NextResponse.json({ error: "asset_id non valido" }, { status: 400 });
    }
    const ok = detachAssetFromService(Number(id), assetId);
    if (!ok) return NextResponse.json({ error: "Dipendenza non trovata" }, { status: 404 });
    return NextResponse.json({ success: true });
  });
}
