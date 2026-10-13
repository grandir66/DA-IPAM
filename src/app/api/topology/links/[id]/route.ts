import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { deleteLinkOverride } from "@/lib/db-tenant";
import { parseControllerId } from "@/lib/controllers/route-helpers";

type Ctx = { params: Promise<{ id: string }> };

function notFound(): NextResponse {
  return NextResponse.json({ error: "Correzione non trovata" }, { status: 404 });
}

/** DELETE /api/topology/links/[id] — toglie una correzione: il collegamento torna come lo vedono le fonti. */
export async function DELETE(_req: Request, ctx: Ctx) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    const id = parseControllerId((await ctx.params).id);
    if (id === null) return notFound();
    try {
      return deleteLinkOverride(id) ? NextResponse.json({ ok: true }) : notFound();
    } catch (error) {
      console.error("[topology] correzioni, cancellazione:", error);
      return NextResponse.json({ error: "Errore nella cancellazione della correzione" }, { status: 500 });
    }
  });
}
