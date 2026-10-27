import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { actorOf, NO_STORE, readJson, reloadSchedulerForCurrentTenant } from "@/lib/controllers/route-helpers";
import { cambiaSchedulazione } from "@/lib/schedulazioni/cambio";

/**
 * PUT /api/schedulazioni/[id] — `{ acceso }`. Solo un admin; le regole (404, 409 per Edge e timer, passaggio da Opzioni,
 * ricarica dello scheduler, registro) stanno in lib/schedulazioni/cambio.ts.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    const { id } = await params;
    const r = await cambiaSchedulazione(
      id,
      await readJson(req),
      { ruolo: s.user.role, chi: actorOf(s) ?? "amministratore", idUtente: s.user.id ?? null },
      reloadSchedulerForCurrentTenant,
    );
    return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
  });
}
