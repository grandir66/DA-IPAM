import { NextResponse } from "next/server";
import { getNetworkById, updateNetwork, deleteNetwork, setNetworkRouter, deleteNetworkRouter, getNetworkRouterId } from "@/lib/db";
import { getHostsByNetwork } from "@/lib/db";
import { NetworkSchema } from "@/lib/validators";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const network = getNetworkById(Number(id));
    if (!network) {
      return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });
    }
    const hosts = getHostsByNetwork(Number(id));
    const router_id = getNetworkRouterId(Number(id));
    return NextResponse.json({ ...network, hosts, router_id });
  } catch (error) {
    console.error("Error fetching network:", error);
    return NextResponse.json({ error: "Errore nel recupero della rete" }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const networkId = Number(id);
    const body = await request.json();
    const parsed = NetworkSchema.partial().safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { router_id, ...networkData } = parsed.data;
    const network = updateNetwork(networkId, networkData);
    if (!network) {
      return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });
    }
    if (router_id !== undefined) {
      if (router_id) {
        setNetworkRouter(networkId, router_id);
      } else {
        deleteNetworkRouter(networkId);
      }
    }
    const updated = getNetworkById(networkId);
    const currentRouterId = getNetworkRouterId(networkId);
    return NextResponse.json({ ...updated, router_id: currentRouterId });
  } catch (error) {
    console.error("Error updating network:", error);
    return NextResponse.json({ error: "Errore nell'aggiornamento della rete" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const deleted = deleteNetwork(Number(id));
    if (!deleted) {
      return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting network:", error);
    return NextResponse.json({ error: "Errore nell'eliminazione della rete" }, { status: 500 });
  }
}
