import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { NO_STORE } from "@/lib/controllers/route-helpers";
import { conGuasto, rispostaEsiti } from "@/lib/apparati-scelti/rotte-server";

/**
 * GET /api/jobs/apparati-scelti/[id]/esiti (piano 2026-10-22 scansione automatica, Task 6): l'ultimo esito di ogni
 * apparato del job, il dettaglio di J3 nella pagina dei job (che è da admin). 404 su un job assente o d'altro tipo.
 */
export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const s = await requireAdmin();
  if (isAuthError(s)) return s;
  return withTenantFromSession(async () => {
    const { id } = await context.params;
    const r = conGuasto("esiti", () => rispostaEsiti(id));
    return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
  });
}
