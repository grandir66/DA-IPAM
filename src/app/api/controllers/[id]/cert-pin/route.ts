import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { acceptControllerCertPin } from "@/lib/controllers/service";
import { NO_STORE, notFound, parseControllerId, readJson } from "@/lib/controllers/route-helpers";

/**
 * POST /api/controllers/[id]/cert-pin — «Accetta il nuovo certificato».
 * Corpo `{ pin, replaces }`: `pin` è l'impronta nuova mostrata dall'errore,
 * `replaces` quella che l'amministratore ha visto fissata (null = nessuna).
 * Se nel frattempo è cambiata si rifiuta (409).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  const id = parseControllerId((await ctx.params).id);
  if (id === null) return notFound();
  const body = (await readJson(req)) as { pin?: unknown; replaces?: unknown } | null;
  const pin = typeof body?.pin === "string" ? body.pin : "";
  const replaces = typeof body?.replaces === "string" && body.replaces ? body.replaces : null;
  return withTenantFromSession(() => {
    const r = acceptControllerCertPin(id, pin, replaces);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json(r, { headers: NO_STORE });
  });
}
