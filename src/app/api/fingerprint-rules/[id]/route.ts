import { NextResponse } from "next/server";
import { updateDeviceFingerprintRule, deleteDeviceFingerprintRule } from "@/lib/db";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const body = await request.json();
    const updated = updateDeviceFingerprintRule(Number(id), body);
    if (!updated) return NextResponse.json({ error: "Regola non trovata" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore";
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ error: "Esiste già una regola con questo nome" }, { status: 409 });
    }
    console.error("Error updating fingerprint rule:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const deleted = deleteDeviceFingerprintRule(Number(id));
    if (!deleted) return NextResponse.json({ error: "Regola non trovata" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("Error deleting fingerprint rule:", e);
    return NextResponse.json({ error: "Errore nell'eliminazione" }, { status: 500 });
  }
}
