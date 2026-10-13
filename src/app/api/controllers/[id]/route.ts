import { NextResponse } from "next/server";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getNetworkController } from "@/lib/db-tenant";
import {
  checkControllerInput,
  getControllerView,
  listControllerRunViews,
  removeController,
  updateController,
} from "@/lib/controllers/service";
import {
  NO_STORE,
  notFound,
  parseControllerId,
  readJson,
  reloadSchedulerForCurrentTenant,
} from "@/lib/controllers/route-helpers";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/controllers/[id] — il controller e le sue ultime 10 letture. */
export async function GET(_req: Request, ctx: Ctx) {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;
  const id = parseControllerId((await ctx.params).id);
  if (id === null) return notFound();
  return withTenantFromSession(() => {
    const controller = getControllerView(id);
    if (!controller) return notFound();
    return NextResponse.json({ controller, runs: listControllerRunViews(id, 10) }, { headers: NO_STORE });
  });
}

/**
 * PUT /api/controllers/[id] — modifica. Segreti vuoti = non cambiare; un
 * indirizzo nuovo azzera impronta e segreti salvati (vedi `updateController`).
 */
export async function PUT(req: Request, ctx: Ctx) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  const id = parseControllerId((await ctx.params).id);
  if (id === null) return notFound();
  const body = await readJson(req);
  return withTenantFromSession(() => {
    const existing = getNetworkController(id);
    if (!existing) return notFound();
    const check = checkControllerInput(body, existing);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
    const controller = updateController(id, check.value);
    if (!controller) return notFound();
    const warning = reloadSchedulerForCurrentTenant();
    return NextResponse.json({ controller, warning }, { headers: NO_STORE });
  });
}

/**
 * DELETE /api/controllers/[id] — toglie il controller, il suo storico e la sua
 * pianificazione. Gli apparati, le porte e i vicini già letti restano.
 */
export async function DELETE(_req: Request, ctx: Ctx) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  const id = parseControllerId((await ctx.params).id);
  if (id === null) return notFound();
  return withTenantFromSession(() => {
    if (!removeController(id)) return notFound();
    const warning = reloadSchedulerForCurrentTenant();
    return NextResponse.json({ ok: true, warning }, { headers: NO_STORE });
  });
}
