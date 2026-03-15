import { NextResponse } from "next/server";
import { getAllSettings, setSetting } from "@/lib/db";

export async function GET() {
  try {
    const settings = getAllSettings();
    return NextResponse.json(settings);
  } catch (error) {
    console.error("Error fetching settings:", error);
    return NextResponse.json({ error: "Errore nel recupero impostazioni" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
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
