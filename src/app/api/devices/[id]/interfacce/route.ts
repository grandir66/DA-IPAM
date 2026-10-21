/**
 * Interfacce dell'apparato per la scheda router e firewall (tab Interfacce e Panoramica).
 * GET /api/devices/[id]/interfacce[?ultima=1] → { interfacce, fonte: "device_interfaces", aggiornato, collegato }
 * `?ultima=1`: solo le righe dell'ultima lettura (liste MikroTik). Lettura: network_devices.physical_device_id → device_interfaces + device_interface_addresses.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { interfacceDellApparato } from "@/lib/devices/interfacce-scheda";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;
  const { id } = await params;
  const deviceId = Number(id);
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    return NextResponse.json({ error: "ID non valido" }, { status: 400 });
  }
  return withTenantFromSession(() => {
    const r = interfacceDellApparato(deviceId, { soloUltimaLettura: request.nextUrl.searchParams.get("ultima") === "1" });
    if (!r) return NextResponse.json({ error: "Dispositivo non trovato" }, { status: 404 });
    return NextResponse.json(r);
  });
}
