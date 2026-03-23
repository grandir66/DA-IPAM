import { NextResponse } from "next/server";
import { isOnboardingCompleted } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/api-auth";

/**
 * Stato configurazione guidata iniziale (solo sessione autenticata).
 */
export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  return NextResponse.json({ completed: isOnboardingCompleted() });
}
