import { NextResponse } from "next/server";
import { getLocationById, updateLocation, deleteLocation } from "@/lib/db";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireAdmin();
    if (isAuthError(authCheck)) return authCheck;
    const { id } = await params;
    const location = getLocationById(Number(id));
    if (!location) {
      return NextResponse.json({ error: "Ubicazione non trovata" }, { status: 404 });
    }
    return NextResponse.json(location);
  } catch (error) {
    console.error("Error fetching location:", error);
    return NextResponse.json({ error: "Errore nel recupero dell'ubicazione" }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const body = await request.json();
    const { name, parent_id, address } = body;
    const updated = updateLocation(Number(id), {
      name: name?.trim(),
      parent_id: parent_id !== undefined ? parent_id : undefined,
      address: address !== undefined ? (address?.trim() || null) : undefined,
    });
    if (!updated) {
      return NextResponse.json({ error: "Ubicazione non trovata" }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating location:", error);
    return NextResponse.json({ error: "Errore nell'aggiornamento dell'ubicazione" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const deleted = deleteLocation(Number(id));
    if (!deleted) {
      return NextResponse.json({ error: "Ubicazione non trovata" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting location:", error);
    return NextResponse.json({ error: "Errore nell'eliminazione dell'ubicazione" }, { status: 500 });
  }
}
