import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { deleteLinkOverride, updateLinkOverride } from "@/lib/db-tenant";
import { parseLinkPatchBody } from "@/lib/topology/api-input";
import { parseControllerId, readJson } from "@/lib/controllers/route-helpers";

type Ctx = { params: Promise<{ id: string }> };

function notFound(): NextResponse {
  return NextResponse.json({ error: "Correzione non trovata" }, { status: 404 });
}

/**
 * PATCH /api/topology/links/[id] — modifica un collegamento aggiunto a mano (fase 2b,
 * «Modifica porte»): `{ a_port?, b_port?, medium?, note? }`, cambiano solo i campi
 * presenti. Risposta `{ ok: true }`; 404 se la correzione non c'è; 409 se è un «ignora».
 */
export async function PATCH(req: Request, ctx: Ctx) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    const id = parseControllerId((await ctx.params).id);
    if (id === null) return notFound();
    const body = parseLinkPatchBody(await readJson(req));
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
    try {
      const esito = updateLinkOverride(id, body.data);
      if (esito === "assente") return notFound();
      if (esito === "non_a_mano") {
        return NextResponse.json({ error: "Si modificano solo i collegamenti aggiunti a mano: un collegamento ignorato si toglie e si rifà" }, { status: 409 });
      }
      return NextResponse.json({ ok: true });
    } catch (error) {
      console.error("[topology] correzioni, modifica:", error);
      return NextResponse.json({ error: "Errore nella modifica del collegamento" }, { status: 500 });
    }
  });
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
