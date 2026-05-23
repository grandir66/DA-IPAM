import { withTenantFromSession } from "@/lib/api-tenant";
import { NextResponse } from "next/server";
import { getNetworkDeviceById, getMultihomedStatusByDeviceId } from "@/lib/db";
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

    // Multihomed dedup: se è secondary, skip a meno di ?force=1.
    const force = new URL(_request.url).searchParams.get("force") === "1";
    const mh = getMultihomedStatusByDeviceId(Number(id));
    if (mh && !mh.is_primary && !force) {
      return NextResponse.json({
        success: false,
        error: "scan_skipped_multihomed_secondary",
        message: `Device secondary di un gruppo multihomed (${mh.peers_count} IF). Test saltato: esegui sul primary (${mh.primary_ip}) o forza con ?force=1.`,
        multihomed: { group_id: mh.group_id, primary_host_id: mh.primary_host_id, primary_ip: mh.primary_ip, peers_count: mh.peers_count },
      }, { status: 409 });
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