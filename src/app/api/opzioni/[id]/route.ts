import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { actorOf, NO_STORE, readJson, reloadSchedulerForCurrentTenant } from "@/lib/controllers/route-helpers";
import { cambiaOpzione } from "@/lib/opzioni/cambio";

/**
 * PUT /api/opzioni/[id] — `{ acceso?, valore? }`: accende, spegne o sceglie (spec pagina Opzioni §3.3). Solo un admin;
 * le regole (404, 405 per le voci da file, 409, ricarica dello scheduler, registro) stanno in lib/opzioni/cambio.ts.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    const { id } = await params;
    const r = await cambiaOpzione(
      id,
      await readJson(req),
      { ruolo: s.user.role, chi: actorOf(s) ?? "amministratore", idUtente: s.user.id ?? null },
      reloadSchedulerForCurrentTenant,
    );
    return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
  });
}
