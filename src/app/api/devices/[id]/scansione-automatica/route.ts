import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { NO_STORE } from "@/lib/controllers/route-helpers";
import { conGuasto, rispostaScansioneApparato } from "@/lib/apparati-scelti/rotte-server";

/**
 * GET /api/devices/[id]/scansione-automatica (piano 2026-10-22 scansione automatica, Task 6): la pastiglia J4 della
 * testata. Chiunque abbia la sessione (un viewer vede che l'apparato è in scansione): i job che contengono
 * l'apparato con frequenza, ultima e prossima, l'esito di questo apparato. Niente IP né nomi d'altri apparati.
 */
export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const s = await requireAuth();
  if (isAuthError(s)) return s;
  return withTenantFromSession(async () => {
    const { id } = await context.params;
    const r = conGuasto("testata", () => rispostaScansioneApparato(id));
    return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
  });
}
