import { NextResponse } from "next/server";
import { getInventoryAssetById } from "@/lib/db";
import { getInventoryAuditLog } from "@/lib/db";

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
    const url = new URL(_request.url);
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));
    const log = getInventoryAuditLog(Number(id), limit);
    return NextResponse.json(log);
  } catch (error) {
    console.error("Error fetching inventory audit log:", error);
    return NextResponse.json({ error: "Errore nel recupero dello storico" }, { status: 500 });
  }
}
