/**
 * Tab VLAN degli switch (piano 2026-10-22 accorpamento, Task 11): GET /api/devices/[id]/vlan-switch → RispostaVlanSwitch.
 * Sola lettura con la sessione; 404 apparato assente.
 */
import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { rispostaVlanSwitch } from "@/lib/devices/vlan-switch-rotta";

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
    const r = rispostaVlanSwitch(deviceId);
    return NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
  });
}
