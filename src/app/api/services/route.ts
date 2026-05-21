import { NextResponse } from "next/server";
import { getServices, createService } from "@/lib/db-tenant";
import { ServiceSchema } from "@/lib/validators";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";

const NO_CACHE = { "Cache-Control": "no-store, no-cache, must-revalidate" };

export async function GET(request: Request) {
  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;
    const { searchParams } = new URL(request.url);
    const inScopeNis2 = searchParams.get("in_scope_nis2");
    const stato = searchParams.get("stato");
    const q = searchParams.get("q");
    return NextResponse.json(getServices({
      ...(inScopeNis2 === "1" && { in_scope_nis2: 1 }),
      ...(inScopeNis2 === "0" && { in_scope_nis2: 0 }),
      ...(stato && { stato }),
      ...(q && { q }),
      limit: 500,
    }), { headers: NO_CACHE });
  });
}

export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    const authCheck = await requireAdmin();
    if (isAuthError(authCheck)) return authCheck;
    let body: unknown;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 }); }
    const parsed = ServiceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Body non valido" }, { status: 400 });
    }
    try {
      const svc = createService(parsed.data);
      return NextResponse.json(svc, { status: 201 });
    } catch (e) {
      console.error("[services] create error:", e);
      const msg = e instanceof Error ? e.message : "errore";
      const isConstraint = msg.includes("UNIQUE constraint failed");
      return NextResponse.json({ error: isConstraint ? "Esiste già un servizio con questo nome" : "Errore nella creazione" }, { status: isConstraint ? 409 : 500 });
    }
  });
}
