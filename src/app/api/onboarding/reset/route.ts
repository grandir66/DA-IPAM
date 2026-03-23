import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { setSetting } from "@/lib/db";

/**
 * Reimposta il flag di completamento wizard così l'utente può tornare a /onboarding.
 * Solo amministratori (dopo la prima configurazione la sessione ha sempre ruolo admin).
 */
export async function POST() {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  try {
    setSetting("onboarding_completed", "0");
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[onboarding/reset]", e);
    return NextResponse.json({ error: "Impossibile reimpostare il wizard" }, { status: 500 });
  }
}
