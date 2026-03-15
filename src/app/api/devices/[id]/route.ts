import { NextResponse } from "next/server";
import { getNetworkDeviceById, updateNetworkDevice, deleteNetworkDevice, getArpEntriesByDevice, getMacPortEntriesByDevice, getSwitchPortsByDevice } from "@/lib/db";
import { encrypt } from "@/lib/crypto";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const device = getNetworkDeviceById(Number(id));
    if (!device) {
      return NextResponse.json({ error: "Dispositivo non trovato" }, { status: 404 });
    }

    const arpEntries = device.device_type === "router" ? getArpEntriesByDevice(Number(id)) : [];
    const macPortEntries = device.device_type === "switch" ? getMacPortEntriesByDevice(Number(id)) : [];
    const switchPorts = getSwitchPortsByDevice(Number(id)); // router e switch

    return NextResponse.json({
      ...device,
      encrypted_password: device.encrypted_password ? "●●●●●●●●" : null,
      community_string: device.community_string ? "●●●●●●●●" : null,
      api_token: device.api_token ? "●●●●●●●●" : null,
      arp_entries: arpEntries,
      mac_port_entries: macPortEntries,
      switch_ports: switchPorts,
    });
  } catch (error) {
    console.error("Error fetching device:", error);
    return NextResponse.json({ error: "Errore nel recupero del dispositivo" }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.host !== undefined) updates.host = body.host;
    if (body.device_type !== undefined) updates.device_type = body.device_type;
    if (body.vendor !== undefined) updates.vendor = body.vendor;
    if (body.protocol !== undefined) updates.protocol = body.protocol;
    if (body.username !== undefined) updates.username = body.username;
    if (body.password) updates.encrypted_password = encrypt(body.password);
    if (body.community_string) updates.community_string = encrypt(body.community_string);
    if (body.api_token) updates.api_token = encrypt(body.api_token);
    if (body.api_url !== undefined) updates.api_url = body.api_url;
    if (body.port !== undefined) updates.port = body.port;
    if (body.enabled !== undefined) updates.enabled = body.enabled;

    const device = updateNetworkDevice(Number(id), updates as Partial<import("@/types").NetworkDevice>);
    if (!device) {
      return NextResponse.json({ error: "Dispositivo non trovato" }, { status: 404 });
    }

    return NextResponse.json({
      ...device,
      encrypted_password: device.encrypted_password ? "●●●●●●●●" : null,
      community_string: device.community_string ? "●●●●●●●●" : null,
      api_token: device.api_token ? "●●●●●●●●" : null,
    });
  } catch (error) {
    console.error("Error updating device:", error);
    return NextResponse.json({ error: "Errore nell'aggiornamento" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const deleted = deleteNetworkDevice(Number(id));
    if (!deleted) {
      return NextResponse.json({ error: "Dispositivo non trovato" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting device:", error);
    return NextResponse.json({ error: "Errore nell'eliminazione" }, { status: 500 });
  }
}
