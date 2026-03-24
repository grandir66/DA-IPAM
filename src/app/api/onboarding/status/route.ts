import { NextResponse } from "next/server";
import { isOnboardingCompleted } from "@/lib/db";
import { withTenantFromSession } from "@/lib/api-tenant";

/**
 * Stato configurazione guidata iniziale (solo sessione autenticata).
 */
export async function GET() {
  return withTenantFromSession(async () => {
    return NextResponse.json({ completed: isOnboardingCompleted() });
  });
}
