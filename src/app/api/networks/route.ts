import { NextResponse } from "next/server";
import { getNetworks, getNetworksPaginated, createNetwork, setNetworkRouter } from "@/lib/db";
import { NetworkSchema } from "@/lib/validators";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const pageParam = searchParams.get("page");
    const search = searchParams.get("search") || undefined;

    if (pageParam) {
      const page = Math.max(1, parseInt(pageParam, 10) || 1);
      const pageSize = Math.max(1, Math.min(100, parseInt(searchParams.get("pageSize") || "25", 10)));
      const { data, total } = getNetworksPaginated(page, pageSize, search);
      const totalPages = Math.ceil(total / pageSize);
      return NextResponse.json({ data, total, page, pageSize, totalPages });
    }

    const networks = getNetworks();
    return NextResponse.json(networks);
  } catch (error) {
    console.error("Error fetching networks:", error);
    return NextResponse.json({ error: "Errore nel recupero delle reti" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const body = await request.json();
    const parsed = NetworkSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { router_id, ...networkData } = parsed.data;
    const network = createNetwork(networkData);
    if (router_id) {
      setNetworkRouter(network.id, router_id);
    }
    return NextResponse.json(network, { status: 201 });
  } catch (error) {
    if (error instanceof Error && (error.message.includes("UNIQUE") || error.message.includes("sovrappone"))) {
      return NextResponse.json({ error: error.message.includes("sovrappone") ? error.message : "Rete già esistente con questo CIDR" }, { status: 409 });
    }
    console.error("Error creating network:", error);
    return NextResponse.json({ error: "Errore nella creazione della rete" }, { status: 500 });
  }
}
