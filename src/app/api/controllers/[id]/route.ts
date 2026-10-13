import { NextResponse } from "next/server";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getNetworkController } from "@/lib/db-tenant";
import {
  checkControllerInput,
  getControllerView,
  listControllerRunViews,
  parseControllerPatch,
  removeController,
  setClientScheduleFor,
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
 * PATCH /api/controllers/[id] — `{ client_schedule: boolean }`: accende o spegne
 * la lettura dei client collegati ogni ora dalle 7 alle 20 (topologia fase 2).
 * Il resto del controller si cambia col PUT.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  const id = parseControllerId((await ctx.params).id);
  if (id === null) return notFound();
  const body = parseControllerPatch(await readJson(req));
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
  return withTenantFromSession(() => {
    const r = setClientScheduleFor(id, body.value.clientSchedule);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    const warning = reloadSchedulerForCurrentTenant();
    return NextResponse.json({ controller: r.controller, warning }, { headers: NO_STORE });
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
