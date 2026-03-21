import { NextResponse } from "next/server";
import { updateFingerprintClassificationMapRow, deleteFingerprintClassificationMapRow } from "@/lib/db";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { FingerprintClassificationMapUpdateSchema } from "@/lib/validators";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isFinite(id) || id < 1) {
      return NextResponse.json({ error: "ID non valido" }, { status: 400 });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
    }
    const parsed = FingerprintClassificationMapUpdateSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Dati non validi";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    if (Object.keys(parsed.data).length === 0) {
      return NextResponse.json({ error: "Nessun campo da aggiornare" }, { status: 400 });
    }
    const row = updateFingerprintClassificationMapRow(id, parsed.data);
    if (!row) {
      return NextResponse.json({ error: "Regola non trovata" }, { status: 404 });
    }
    return NextResponse.json(row);
  } catch (error) {
    if (error instanceof Error && /UNIQUE|constraint/i.test(error.message)) {
      return NextResponse.json(
        { error: "Esiste già una regola con lo stesso tipo di match e pattern" },
        { status: 409 }
      );
    }
    console.error("fingerprint-classification-map PUT:", error);
    return NextResponse.json({ error: "Errore nell'aggiornamento" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isFinite(id) || id < 1) {
      return NextResponse.json({ error: "ID non valido" }, { status: 400 });
    }
    const deleted = deleteFingerprintClassificationMapRow(id);
    if (!deleted) {
      return NextResponse.json({ error: "Regola non trovata" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("fingerprint-classification-map DELETE:", error);
    return NextResponse.json({ error: "Errore nell'eliminazione" }, { status: 500 });
  }
}
