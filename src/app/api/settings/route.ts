import { NextResponse } from "next/server";
import { getAllSettings, setSetting } from "@/lib/db";
import { requireAuth, requireAdminOrOnboarding, isAuthError } from "@/lib/api-auth";
import { impostazioniPerRuolo, puoVedereSegreti } from "@/lib/permessi/politica";

export async function GET() {
  try {
    const session = await requireAuth();
    if (isAuthError(session)) return session;
    // Chi non è admin non riceve le chiavi dei segreti (SEC-5): la tabella
    // dell'hub contiene password e token delle integrazioni.
    return NextResponse.json(impostazioniPerRuolo(getAllSettings(), puoVedereSegreti(session.user.role)));
  } catch (error) {
    console.error("Error fetching settings:", error);
    return NextResponse.json({ error: "Errore nel recupero impostazioni" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const adminCheck = await requireAdminOrOnboarding();
    if (isAuthError(adminCheck)) return adminCheck;
    const body = await request.json();
    const { key, value } = body;

    if (!key || value === undefined) {
      return NextResponse.json({ error: "Chiave e valore richiesti" }, { status: 400 });
    }

    setSetting(key, String(value));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving setting:", error);
    return NextResponse.json({ error: "Errore nel salvataggio" }, { status: 500 });
  }
}
