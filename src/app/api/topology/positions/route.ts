import { NextResponse } from "next/server";
import { clearTopologyTweaks, renameTopologyNodes, saveTopologyTweaks } from "@/lib/db-tenant";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { parsePositionsBody } from "@/lib/topology/api-input";
import { readJson } from "@/lib/controllers/route-helpers";

/**
 * PUT /api/topology/positions — `{ view, orientation, tweaks }` salva i ritocchi con la firma, nell'orientamento in cui
 * sono fatti (spec §12.2); `{ view, clear: true, orientation? }` è «Riordina» (con l'orientamento, solo i suoi ritocchi);
 * `{ view, rename }` riscrive sugli id canonici gli oggetti promossi o fusi (lo manda la pagina alla prima modifica).
 */
export async function PUT(request: Request) {
  return withTenantFromSession(async () => {
    const authCheck = await requireAdmin();
    if (isAuthError(authCheck)) return authCheck;
    const body = parsePositionsBody(await readJson(request));
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
    try {
      renameTopologyNodes(body.data.view, body.data.rename);
      const { orientation } = body.data;
      if (body.data.clear) clearTopologyTweaks(body.data.view, orientation ?? undefined);
      else if (body.data.tweaks.length > 0 && orientation !== null) saveTopologyTweaks(body.data.view, body.data.tweaks, orientation);
      return NextResponse.json({ ok: true });
    } catch (error) {
      console.error("[topology] ritocchi:", error);
      return NextResponse.json({ error: "Errore nel salvataggio dei ritocchi" }, { status: 500 });
    }
  });
}
