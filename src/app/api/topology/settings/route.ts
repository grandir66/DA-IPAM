import { NextResponse } from "next/server";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getLinkStaleDays, setLinkStaleDays } from "@/lib/topology/settings";
import { parseStaleDaysBody } from "@/lib/topology/api-input";
import { NO_STORE, readJson } from "@/lib/controllers/route-helpers";

/** GET /api/topology/settings — la soglia in giorni oltre cui un collegamento è «non visto». */
export async function GET() {
  return withTenantFromSession(async () => {
    const s = await requireAuth();
    if (isAuthError(s)) return s;
    try {
      return NextResponse.json({ staleDays: getLinkStaleDays() }, { headers: NO_STORE });
    } catch (error) {
      console.error("[topology] soglia:", error);
      return NextResponse.json({ error: "Errore nella lettura della soglia" }, { status: 500 });
    }
  });
}

/** PUT /api/topology/settings — `{ staleDays }`, intero nei limiti di settings.ts. */
export async function PUT(req: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    const body = parseStaleDaysBody(await readJson(req));
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
    try {
      setLinkStaleDays(body.data);
      return NextResponse.json({ staleDays: getLinkStaleDays() }, { headers: NO_STORE });
    } catch (error) {
      console.error("[topology] soglia, scrittura:", error);
      return NextResponse.json({ error: "Errore nel salvataggio della soglia" }, { status: 500 });
    }
  });
}
