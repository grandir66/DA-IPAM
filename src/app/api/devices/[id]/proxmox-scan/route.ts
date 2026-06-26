import { withTenantFromSession } from "@/lib/api-tenant";
import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { runProxmoxDeviceScan } from "@/lib/proxmox/run-proxmox-device-scan";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withTenantFromSession(async () => {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const deviceId = parseInt(id, 10);
    if (isNaN(deviceId)) {
      return NextResponse.json({ error: "ID non valido" }, { status: 400 });
    }

    const result = await runProxmoxDeviceScan(deviceId);
    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Errore durante lo scan";
    console.error("Proxmox scan error:", error);
    const status = msg === "Dispositivo non trovato" ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
});
}
