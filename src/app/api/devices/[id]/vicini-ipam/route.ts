/**
 * Host di IPAM dei vicini LLDP/CDP/MNDP di un apparato (22/10, tab Interfacce MikroTik e «Vicini e MAC» dello switch):
 * GET /api/devices/[id]/vicini-ipam → { ip: { "<ip>": hostId }, mac: { "<12 cifre MAC>": hostId } }.
 * Stessa restrizione della tab «Dispositivi» (reti servite dall'apparato, o IP/MAC unico nel tenant). Sola lettura.
 */
import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getNetworkDeviceById, viciniConHost } from "@/lib/db-tenant";

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
    if (!getNetworkDeviceById(deviceId)) return NextResponse.json({ error: "Dispositivo non trovato" }, { status: 404 });
    return NextResponse.json(viciniConHost(deviceId));
  });
}
