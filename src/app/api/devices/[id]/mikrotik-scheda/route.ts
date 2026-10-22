/**
 * Scheda MikroTik, tab Bridge e VLAN (21/10, Task 9): GET /api/devices/[id]/mikrotik-scheda → RispostaSchedaMikrotik.
 * Sola lettura con la sessione; 404 apparato assente, 400 se non è un MikroTik.
 */
import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { rispostaSchedaMikrotik } from "@/lib/devices/scheda-mikrotik-rotta";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;
  const { id } = await params;
  const deviceId = Number(id);
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    return NextResponse.json({ error: "ID non valido" }, { status: 400 });
  }
  return withTenantFromSession(() => {
    const r = rispostaSchedaMikrotik(deviceId);
    return NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
  });
}
