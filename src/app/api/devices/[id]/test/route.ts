import { withTenantFromSession } from "@/lib/api-tenant";
import { NextResponse } from "next/server";
import { getNetworkDeviceById } from "@/lib/db";
import {
  runDeviceConnectionTest,
  isWindowsDevice,
  getWindowsHint,
} from "@/lib/devices/device-connection-test";
import { requireAuth, isAuthError } from "@/lib/api-auth";

/**
 * Testa la connessione a un dispositivo (router, switch o Proxmox).
 * GET /api/devices/[id]/test
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withTenantFromSession(async () => {
  const { id } = await params;
  try {
    const device = getNetworkDeviceById(Number(id));
    if (!device) {
      return NextResponse.json({ error: "Dispositivo non trovato" }, { status: 404 });
    }

    const result = await runDeviceConnectionTest(device);
    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Errore nel test di connessione";
    const device = getNetworkDeviceById(Number(id));
    const isWin = device && isWindowsDevice(device);
    const hint = isWin ? getWindowsHint(msg) : "";
    return NextResponse.json(
      {
        success: false,
        error: msg + hint,
      },
      { status: 200 }
    );
  }
});
}