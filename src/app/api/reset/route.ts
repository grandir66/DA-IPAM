import { NextResponse } from "next/server";
import { resetConfiguration } from "@/lib/db";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

export async function POST() {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    resetConfiguration();
    return NextResponse.json({ success: true, message: "Configurazione resettata" });
  } catch (error) {
    console.error("Reset configuration error:", error);
    return NextResponse.json(
      { error: "Errore durante il reset della configurazione" },
      { status: 500 }
    );
  }
}
