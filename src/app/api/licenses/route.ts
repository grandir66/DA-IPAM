import { NextResponse } from "next/server";
import { getLicenses, createLicense } from "@/lib/db";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

export async function GET() {
  try {
    const authCheck = await requireAdmin();
    if (isAuthError(authCheck)) return authCheck;
    const licenses = getLicenses();
    return NextResponse.json(licenses);
  } catch (error) {
    console.error("Error fetching licenses:", error);
    return NextResponse.json({ error: "Errore nel recupero delle licenze" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const body = await request.json();
    const { name, serial, seats, category, expiration_date, purchase_cost, min_amt, fornitore, note } = body;
    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Nome richiesto" }, { status: 400 });
    }
    const license = createLicense({
      name: name.trim(),
      serial: serial?.trim() || null,
      seats: seats ?? 1,
      category: category?.trim() || null,
      expiration_date: expiration_date?.trim() || null,
      purchase_cost: purchase_cost ?? null,
      min_amt: min_amt ?? 0,
      fornitore: fornitore?.trim() || null,
      note: note?.trim() || null,
    });
    return NextResponse.json(license);
  } catch (error) {
    console.error("Error creating license:", error);
    return NextResponse.json({ error: "Errore nella creazione della licenza" }, { status: 500 });
  }
}
