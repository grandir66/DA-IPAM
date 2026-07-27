/**
 * Acknowledge di un evento alert Wazuh.
 *
 *   POST → marca l'evento come preso in carico. Un alert successivo con la
 *          stessa coppia (agent, regola) aprira' un evento NUOVO, cosi' un
 *          problema che si ripresenta torna visibile invece di restare
 *          nascosto sotto un ack vecchio.
 */
import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import {
  acknowledgeAlertEvent,
  ensureWazuhAlertSchema,
  tenantDb,
} from "@/lib/integrations/wazuh-alerts-db";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withTenantFromSession(async () => {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    const { id } = await params;
    const eventId = Number.parseInt(id, 10);
    if (!Number.isInteger(eventId) || eventId <= 0) {
      return NextResponse.json({ error: "ID evento non valido" }, { status: 400 });
    }

    const by =
      (adminCheck as { user?: { email?: string; name?: string } }).user?.email ??
      (adminCheck as { user?: { name?: string } }).user?.name ??
      "admin";

    const db = tenantDb();
    ensureWazuhAlertSchema(db);
    const ok = acknowledgeAlertEvent(db, eventId, by);
    if (!ok) {
      return NextResponse.json(
        { error: "Evento non trovato o gia' preso in carico" },
        { status: 404 },
      );
    }
    return NextResponse.json({ acknowledged: true, id: eventId });
  });
}
