import { NextResponse } from "next/server";
import { getServiceById, getServiceAssetDependencies, updateService, deleteService } from "@/lib/db-tenant";
import { ServiceSchema } from "@/lib/validators";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;
    const { id } = await params;
    const svc = getServiceById(Number(id));
    if (!svc) return NextResponse.json({ error: "Servizio non trovato" }, { status: 404 });
    const dependencies = getServiceAssetDependencies(Number(id));
    return NextResponse.json({ ...svc, dependencies });
  });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    const authCheck = await requireAdmin();
    if (isAuthError(authCheck)) return authCheck;
    const { id } = await params;
    let body: unknown;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 }); }
    const parsed = ServiceSchema.partial().safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Body non valido" }, { status: 400 });
    }
    const updated = updateService(Number(id), parsed.data);
    if (!updated) return NextResponse.json({ error: "Servizio non trovato" }, { status: 404 });
    return NextResponse.json(updated);
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    const authCheck = await requireAdmin();
    if (isAuthError(authCheck)) return authCheck;
    const { id } = await params;
    const ok = deleteService(Number(id));
    if (!ok) return NextResponse.json({ error: "Servizio non trovato" }, { status: 404 });
    return NextResponse.json({ success: true });
  });
}
