import { NextResponse } from "next/server";
import { getAssetAssignees, createAssetAssignee } from "@/lib/db";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

export async function GET() {
  try {
    const assignees = getAssetAssignees();
    return NextResponse.json(assignees);
  } catch (error) {
    console.error("Error fetching asset assignees:", error);
    return NextResponse.json({ error: "Errore nel recupero degli assegnatari" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const body = await request.json();
    const { name, email, phone, note } = body;
    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Nome richiesto" }, { status: 400 });
    }
    const assignee = createAssetAssignee({
      name: name.trim(),
      email: email?.trim() || null,
      phone: phone?.trim() || null,
      note: note?.trim() || null,
    });
    return NextResponse.json(assignee);
  } catch (error) {
    console.error("Error creating asset assignee:", error);
    return NextResponse.json({ error: "Errore nella creazione dell'assegnatario" }, { status: 500 });
  }
}
