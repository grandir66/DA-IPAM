import { NextResponse } from "next/server";
import { getNetworkDevices, getRouters, getSwitches, createNetworkDevice } from "@/lib/db";
import { NetworkDeviceSchema } from "@/lib/validators";
import { encrypt } from "@/lib/crypto";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") as "router" | "switch" | null;
    const devices = type === "router" ? getRouters() : type === "switch" ? getSwitches() : getNetworkDevices();
    // Mask sensitive fields
    const masked = devices.map((d) => ({
      ...d,
      encrypted_password: d.encrypted_password ? "●●●●●●●●" : null,
      community_string: d.community_string ? "●●●●●●●●" : null,
      api_token: d.api_token ? "●●●●●●●●" : null,
    }));
    return NextResponse.json(masked);
  } catch (error) {
    console.error("Error fetching devices:", error);
    return NextResponse.json({ error: "Errore nel recupero dei dispositivi" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = NetworkDeviceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const data = parsed.data;
    const device = createNetworkDevice({
      name: data.name,
      host: data.host,
      device_type: data.device_type,
      vendor: data.vendor,
      protocol: data.protocol,
      username: data.username || null,
      encrypted_password: data.password ? encrypt(data.password) : null,
      community_string: data.community_string ? encrypt(data.community_string) : null,
      api_token: data.api_token ? encrypt(data.api_token) : null,
      api_url: data.api_url || null,
      port: data.port || (data.protocol === "ssh" ? 22 : data.protocol === "api" ? 443 : 161),
      enabled: 1,
    });

    return NextResponse.json({
      ...device,
      encrypted_password: device.encrypted_password ? "●●●●●●●●" : null,
      community_string: device.community_string ? "●●●●●●●●" : null,
      api_token: device.api_token ? "●●●●●●●●" : null,
    }, { status: 201 });
  } catch (error) {
    console.error("Error creating device:", error);
    return NextResponse.json({ error: "Errore nella creazione del dispositivo" }, { status: 500 });
  }
}
