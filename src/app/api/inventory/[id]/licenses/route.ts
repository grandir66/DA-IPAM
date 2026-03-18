import { NextResponse } from "next/server";
import { getInventoryAssetById } from "@/lib/db";
import { getLicenseSeatsByAsset } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const asset = getInventoryAssetById(Number(id));
    if (!asset) {
      return NextResponse.json({ error: "Asset non trovato" }, { status: 404 });
    }
    const seats = getLicenseSeatsByAsset("inventory_asset", Number(id));
    return NextResponse.json(seats);
  } catch (error) {
    console.error("Error fetching asset licenses:", error);
    return NextResponse.json({ error: "Errore nel recupero delle licenze" }, { status: 500 });
  }
}
