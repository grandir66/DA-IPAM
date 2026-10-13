import { NextResponse } from "next/server";
import { clearTopologyTweaks, saveTopologyTweaks } from "@/lib/db-tenant";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { parsePositionsBody } from "@/lib/topology/api-input";
import { readJson } from "@/lib/controllers/route-helpers";

/** PUT /api/topology/positions — `{ view, tweaks }` salva i ritocchi con la firma; `{ view, clear: true }` è «Riordina». */
export async function PUT(request: Request) {
  return withTenantFromSession(async () => {
    const authCheck = await requireAdmin();
    if (isAuthError(authCheck)) return authCheck;
    const body = parsePositionsBody(await readJson(request));
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
    try {
      if (body.data.clear) clearTopologyTweaks(body.data.view);
      else saveTopologyTweaks(body.data.view, body.data.tweaks);
      return NextResponse.json({ ok: true });
    } catch (error) {
      console.error("[topology] ritocchi:", error);
      return NextResponse.json({ error: "Errore nel salvataggio dei ritocchi" }, { status: 500 });
    }
  });
}
