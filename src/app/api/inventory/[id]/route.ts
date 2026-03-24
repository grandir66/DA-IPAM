import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getInventoryAssetById,
  updateInventoryAsset,
  deleteInventoryAsset,
} from "@/lib/db";
import { InventoryAssetSchema } from "@/lib/validators";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withTenantFromSession(async () => {
    try {
      const { id } = await params;
      const asset = getInventoryAssetById(Number(id));
      if (!asset) {
        return NextResponse.json({ error: "Asset non trovato" }, { status: 404 });
      }
      return NextResponse.json(asset, { headers: NO_CACHE_HEADERS });
    } catch (error) {
      console.error("Error fetching inventory asset:", error);
      return NextResponse.json({ error: "Errore nel recupero dell'asset" }, { status: 500 });
    }
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withTenantFromSession(async () => {
    try {
      const { id } = await params;
      const asset = getInventoryAssetById(Number(id));
      if (!asset) {
        return NextResponse.json({ error: "Asset non trovato" }, { status: 404 });
      }
      const body = await request.json();
      const parsed = InventoryAssetSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message ?? "Dati non validi" },
          { status: 400 }
        );
      }
      const session = await auth();
      const auditUserId = session?.user?.id ? Number(session.user.id) : null;
      const updated = updateInventoryAsset(Number(id), parsed.data, auditUserId);
      return NextResponse.json(updated);
    } catch (error) {
      console.error("Error updating inventory asset:", error);
      return NextResponse.json({ error: "Errore nell'aggiornamento dell'asset" }, { status: 500 });
    }
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;
      const { id } = await params;
      const session = await auth();
      const auditUserId = session?.user?.id ? Number(session.user.id) : null;
      const deleted = deleteInventoryAsset(Number(id), auditUserId);
      if (!deleted) {
        return NextResponse.json({ error: "Asset non trovato" }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    } catch (error) {
      console.error("Error deleting inventory asset:", error);
      return NextResponse.json({ error: "Errore nell'eliminazione dell'asset" }, { status: 500 });
    }
  });
}
