import { NextResponse } from "next/server";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { checkControllerInput, createController, listControllerViews } from "@/lib/controllers/service";
import { NO_STORE, readJson, reloadSchedulerForCurrentTenant } from "@/lib/controllers/route-helpers";

/**
 * GET /api/controllers — i controller di rete del tenant (ADR 0007), senza
 * segreti: per ognuno solo se password o chiave ci sono.
 */
export async function GET() {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;
  return withTenantFromSession(() => NextResponse.json({ controllers: listControllerViews() }, { headers: NO_STORE }));
}

/**
 * POST /api/controllers — aggiunge un controller. Admin: salva credenziali
 * del controller del cliente. Non lancia nessuna lettura.
 */
export async function POST(req: Request) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  const body = await readJson(req);
  return withTenantFromSession(() => {
    const check = checkControllerInput(body);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
    const controller = createController(check.value);
    const warning = reloadSchedulerForCurrentTenant();
    return NextResponse.json({ controller, warning }, { status: 201, headers: NO_STORE });
  });
}
