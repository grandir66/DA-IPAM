import { NextResponse } from "next/server";
import { getNetworks, createNetwork } from "@/lib/db";
import { NetworkSchema } from "@/lib/validators";

export async function GET() {
  try {
    const networks = getNetworks();
    return NextResponse.json(networks);
  } catch (error) {
    console.error("Error fetching networks:", error);
    return NextResponse.json({ error: "Errore nel recupero delle reti" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = NetworkSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const network = createNetwork(parsed.data);
    return NextResponse.json(network, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      return NextResponse.json({ error: "Rete già esistente con questo CIDR" }, { status: 409 });
    }
    console.error("Error creating network:", error);
    return NextResponse.json({ error: "Errore nella creazione della rete" }, { status: 500 });
  }
}
