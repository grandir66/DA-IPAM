import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { syncController } from "@/lib/controllers/service";
import { actorOf, NO_STORE, notFound, parseControllerId } from "@/lib/controllers/route-helpers";

/**
 * POST /api/controllers/[id]/sync — «Sincronizza ora». Legge il controller in
 * sola lettura e scrive nel DB del tenant (apparati, porte, vicini LLDP): è
 * una scrittura, quindi admin. Risponde sempre col resoconto; `ok` è false
 * quando non si è letto o scritto niente. Il giro finisce nello storico.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  const id = parseControllerId((await ctx.params).id);
  if (id === null) return notFound();
  return withTenantFromSession(async () => {
    const result = await syncController(id, "manual", actorOf(adminCheck));
    if (result.failure === "Controller non trovato") return notFound();
    return NextResponse.json(result, { headers: NO_STORE });
  });
}
