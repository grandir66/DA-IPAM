import { NextResponse } from "next/server";
import {
  getAllFingerprintClassificationMapRows,
  createFingerprintClassificationMapRow,
} from "@/lib/db";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { FingerprintClassificationMapCreateSchema } from "@/lib/validators";

export async function GET() {
  try {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;
    const rows = getAllFingerprintClassificationMapRows();
    return NextResponse.json(rows);
  } catch (error) {
    console.error("fingerprint-classification-map GET:", error);
    return NextResponse.json({ error: "Errore nel recupero delle regole" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
    }
    const parsed = FingerprintClassificationMapCreateSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Dati non validi";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    const row = createFingerprintClassificationMapRow(parsed.data);
    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    if (error instanceof Error && /UNIQUE|constraint/i.test(error.message)) {
      return NextResponse.json(
        { error: "Esiste già una regola con lo stesso tipo di match e pattern" },
        { status: 409 }
      );
    }
    console.error("fingerprint-classification-map POST:", error);
    return NextResponse.json({ error: "Errore nella creazione" }, { status: 500 });
  }
}
