import { NextResponse } from "next/server";
import { getHostsByNetwork, upsertHost } from "@/lib/db";
import { HostSchema } from "@/lib/validators";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const networkId = searchParams.get("network_id");
    if (!networkId) {
      return NextResponse.json({ error: "network_id richiesto" }, { status: 400 });
    }
    const hosts = getHostsByNetwork(Number(networkId));
    return NextResponse.json(hosts);
  } catch (error) {
    console.error("Error fetching hosts:", error);
    return NextResponse.json({ error: "Errore nel recupero degli host" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = HostSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const host = upsertHost(parsed.data);
    return NextResponse.json(host, { status: 201 });
  } catch (error) {
    console.error("Error creating host:", error);
    return NextResponse.json({ error: "Errore nella creazione dell'host" }, { status: 500 });
  }
}
