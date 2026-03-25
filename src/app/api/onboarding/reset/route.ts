import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { setTenantOnboardingCompleted } from "@/lib/db-hub";
import { auth } from "@/lib/auth";

/**
 * Reimposta il flag di completamento wizard per il tenant corrente.
 * Solo amministratori.
 */
export async function POST() {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  const session = await auth();
  const tenantCode = (session?.user as Record<string, unknown>)?.tenantCode as string | null;
  if (!tenantCode || tenantCode === "__ALL__") {
    return NextResponse.json({ error: "Seleziona un tenant specifico" }, { status: 400 });
  }
  try {
    setTenantOnboardingCompleted(tenantCode, false);
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[onboarding/reset]", e);
    return NextResponse.json({ error: "Impossibile reimpostare il wizard" }, { status: 500 });
  }
}
