/**
 * «Scarica JSON» (tavola C1, decisione 2: solo admin): GET /api/devices/[id]/acquisizione/snapshot/[sid]/scarica → lo
 * snapshot 1.0 decompresso e rivalidato, come allegato. Non contiene segreti (ripulito prima del salvataggio) ma contiene
 * l'inventario dell'apparato: per questo solo l'admin.
 */
import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getNetworkDeviceById } from "@/lib/db-tenant";
import { leggiPayload } from "@/lib/acquisizione-modulare/archivio";

type RouteParams = { params: Promise<{ id: string; sid: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  const { id, sid } = await params;
  const deviceId = Number(id), snapshotId = Number(sid);
  if (!Number.isInteger(deviceId) || deviceId <= 0 || !Number.isInteger(snapshotId) || snapshotId <= 0) {
    return NextResponse.json({ error: "ID non valido" }, { status: 400 });
  }
  return withTenantFromSession(() => {
    if (!getNetworkDeviceById(deviceId)) return NextResponse.json({ error: "Dispositivo non trovato" }, { status: 404 });
    const l = leggiPayload(deviceId, snapshotId);
    if (!l.ok) return NextResponse.json({ error: l.motivo }, { status: l.status });
    return new NextResponse(JSON.stringify(l.snapshot, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="snapshot-${l.riga.collector}-${deviceId}-${snapshotId}.json"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
