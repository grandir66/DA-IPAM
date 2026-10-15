import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { setTopologyRole } from "@/lib/db-tenant";
import { parseNodeRoleBody } from "@/lib/topology/api-input";
import { readJson } from "@/lib/controllers/route-helpers";

/** PATCH /api/topology/nodes/role — «Ruolo nella mappa» di un apparato (T1b, spec §13.8.2): '', 'rete' o 'attaccato'. */
export async function PATCH(req: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    const body = parseNodeRoleBody(await readJson(req));
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
    try {
      const esito = setTopologyRole(body.data.deviceId, body.data.role);
      return esito.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: esito.error }, { status: 404 });
    } catch (error) {
      console.error("[topology] ruolo nella mappa:", error);
      return NextResponse.json({ error: "Errore nel salvataggio" }, { status: 500 });
    }
  });
}
