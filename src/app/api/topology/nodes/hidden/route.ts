import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { setNodeHidden } from "@/lib/db-tenant";
import { parseHiddenBody } from "@/lib/topology/api-input";
import { readJson } from "@/lib/controllers/route-helpers";

/** PUT /api/topology/nodes/hidden — nasconde (o rimostra) un apparato dalla topologia. */
export async function PUT(req: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    const body = parseHiddenBody(await readJson(req));
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
    try {
      const esito = setNodeHidden(body.data.deviceId, body.data.hidden);
      return esito.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: esito.error }, { status: 404 });
    } catch (error) {
      console.error("[topology] nascondi:", error);
      return NextResponse.json({ error: "Errore nel salvataggio" }, { status: 500 });
    }
  });
}
