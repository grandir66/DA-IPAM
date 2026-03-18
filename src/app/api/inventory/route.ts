import { NextResponse } from "next/server";
import {
  getInventoryAssets,
  createInventoryAsset,
  getHostById,
} from "@/lib/db";
import { InventoryAssetSchema } from "@/lib/validators";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const networkDeviceId = searchParams.get("network_device_id");
    const hostId = searchParams.get("host_id");
    const stato = searchParams.get("stato");
    const categoria = searchParams.get("categoria");
    const q = searchParams.get("q");
    const limit = searchParams.get("limit");

    const assets = getInventoryAssets({
      ...(networkDeviceId && { network_device_id: Number(networkDeviceId) }),
      ...(hostId && { host_id: Number(hostId) }),
      ...(stato && { stato }),
      ...(categoria && { categoria }),
      ...(q && { q }),
      ...(limit && { limit: Math.min(Number(limit) || 500, 1000) }),
    });
    return NextResponse.json(assets, { headers: NO_CACHE_HEADERS });
  } catch (error) {
    console.error("Error fetching inventory:", error);
    return NextResponse.json({ error: "Errore nel recupero dell'inventario" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const body = await request.json();
    const parsed = InventoryAssetSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Dati non validi" },
        { status: 400 }
      );
    }
    let data = parsed.data;
    if (data.host_id && !data.modello && !data.serial_number) {
      const host = getHostById(data.host_id);
      if (host?.model || host?.serial_number) {
        data = {
          ...data,
          modello: data.modello ?? host.model ?? null,
          serial_number: data.serial_number ?? host.serial_number ?? null,
        };
      }
    }
    const asset = createInventoryAsset(data);
    return NextResponse.json(asset, { status: 201 });
  } catch (error) {
    console.error("Error creating inventory asset:", error);
    return NextResponse.json({ error: "Errore nella creazione dell'asset" }, { status: 500 });
  }
}
