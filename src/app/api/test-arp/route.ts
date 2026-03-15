import { NextResponse } from "next/server";
import { getNetworkDeviceById, getRouters } from "@/lib/db";
import { createRouterClient } from "@/lib/devices/router-client";

/**
 * Test ARP table retrieval from a router device.
 * GET /api/test-arp?device_id=1
 * GET /api/test-arp?device_id=DA_RTR  (cerca per nome)
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const deviceId = searchParams.get("device_id");

  if (!deviceId) {
    return NextResponse.json({ error: "Parametro device_id richiesto (ID numerico o nome dispositivo)" }, { status: 400 });
  }

  const numericId = Number(deviceId);
  let device = !Number.isNaN(numericId) ? getNetworkDeviceById(numericId) : undefined;
  if (!device) {
    const routers = getRouters();
    device = routers.find((r) => r.name.toLowerCase() === deviceId.toLowerCase());
  }
  if (!device) {
    return NextResponse.json({ error: "Dispositivo non trovato" }, { status: 404 });
  }

  if (device.device_type !== "router") {
    return NextResponse.json({ error: "Il dispositivo deve essere un router" }, { status: 400 });
  }

  try {
    const client = await createRouterClient(device);
    const entries = await client.getArpTable();

    return NextResponse.json({
      success: true,
      device: device.name,
      host: device.host,
      protocol: device.protocol,
      entries_count: entries.length,
      entries: entries.slice(0, 50).map((e) => ({ ip: e.ip, mac: e.mac, interface: e.interface_name })),
      truncated: entries.length > 50,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Errore nel recupero ARP",
    }, { status: 200 });
  }
}
