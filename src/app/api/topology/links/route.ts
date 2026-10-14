import { NextResponse } from "next/server";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { addLinkOverride, listLinkOverrides } from "@/lib/db-tenant";
import { parseLinkOverrideBody } from "@/lib/topology/api-input";
import { NO_STORE, actorOf, readJson } from "@/lib/controllers/route-helpers";

/** GET /api/topology/links — le correzioni ai collegamenti decise da un admin. */
export async function GET() {
  return withTenantFromSession(async () => {
    const s = await requireAuth();
    if (isAuthError(s)) return s;
    try {
      return NextResponse.json(listLinkOverrides(), { headers: NO_STORE });
    } catch (error) {
      console.error("[topology] correzioni:", error);
      return NextResponse.json({ error: "Errore nella lettura delle correzioni" }, { status: 500 });
    }
  });
}

/**
 * POST /api/topology/links — aggiunge un collegamento («add», con le porte e il tipo
 * `medium`: cavo, fibra, wireless o null) o ne nasconde uno visto («ignore», senza tipo).
 * Nodi `dev:N` o `host:N`: una VM non censita (`vm:N:M`) si rifiuta con 400. Risposta 201 `{ id }`.
 */
export async function POST(req: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    const body = parseLinkOverrideBody(await readJson(req));
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
    try {
      const id = addLinkOverride(body.data, actorOf(s) ?? "sconosciuto");
      return NextResponse.json({ id }, { status: 201 });
    } catch (error) {
      console.error("[topology] correzioni, scrittura:", error);
      return NextResponse.json({ error: "Errore nel salvataggio della correzione" }, { status: 500 });
    }
  });
}
