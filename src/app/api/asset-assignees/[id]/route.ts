import { NextResponse } from "next/server";
import { getAssetAssigneeById, updateAssetAssignee, deleteAssetAssignee } from "@/lib/db";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const assignee = getAssetAssigneeById(Number(id));
    if (!assignee) {
      return NextResponse.json({ error: "Assegnatario non trovato" }, { status: 404 });
    }
    return NextResponse.json(assignee);
  } catch (error) {
    console.error("Error fetching asset assignee:", error);
    return NextResponse.json({ error: "Errore nel recupero dell'assegnatario" }, { status: 500 });
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
    const { name, email, phone, note } = body;
    const updated = updateAssetAssignee(Number(id), {
      name: name?.trim(),
      email: email !== undefined ? (email?.trim() || null) : undefined,
      phone: phone !== undefined ? (phone?.trim() || null) : undefined,
      note: note !== undefined ? (note?.trim() || null) : undefined,
    });
    if (!updated) {
      return NextResponse.json({ error: "Assegnatario non trovato" }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating asset assignee:", error);
    return NextResponse.json({ error: "Errore nell'aggiornamento dell'assegnatario" }, { status: 500 });
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
    const deleted = deleteAssetAssignee(Number(id));
    if (!deleted) {
      return NextResponse.json({ error: "Assegnatario non trovato" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting asset assignee:", error);
    return NextResponse.json({ error: "Errore nell'eliminazione dell'assegnatario" }, { status: 500 });
  }
}
