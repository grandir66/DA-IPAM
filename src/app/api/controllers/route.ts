import { NextResponse } from "next/server";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { checkControllerInput, createController, listControllerViews, unifiOsWarningFor } from "@/lib/controllers/service";
import { SegretiNonSalvati } from "@/lib/credentials/archivio";
import { CredenzialeControllerNonValida } from "@/lib/controllers/credenziale";
import { NO_STORE, readJson, reloadSchedulerForCurrentTenant } from "@/lib/controllers/route-helpers";

/**
 * GET /api/controllers — i controller di rete del tenant (ADR 0007), senza
 * segreti: per ognuno la voce dell'archivio (id, nome, metodo) e se password
 * o chiave ci sono.
 */
export async function GET() {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;
  return withTenantFromSession(() => NextResponse.json({ controllers: listControllerViews() }, { headers: NO_STORE }));
}

/**
 * POST /api/controllers — aggiunge un controller. Admin. La credenziale è una
 * voce dell'archivio (`credentialId`) oppure segreti nuovi, che diventano la
 * voce «UniFi · <nome>» (tappa 2f, T23). Non lancia nessuna lettura; per un
 * self-hosted chiede in forma anonima se l'indirizzo è una console UniFi OS
 * (avviso).
 */
export async function POST(req: Request) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  const body = await readJson(req);
  return withTenantFromSession(async () => {
    const check = checkControllerInput(body);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
    let controller;
    try {
      controller = createController(check.value);
    } catch (e) {
      if (e instanceof CredenzialeControllerNonValida) return NextResponse.json({ error: e.message }, { status: 400 });
      if (e instanceof SegretiNonSalvati) return NextResponse.json({ error: e.message }, { status: 503 });
      throw e;
    }
    const warnings = [reloadSchedulerForCurrentTenant(), await unifiOsWarningFor(check.value)];
    const warning = warnings.filter(Boolean).join(" · ") || null;
    return NextResponse.json({ controller, warning }, { status: 201, headers: NO_STORE });
  });
}
