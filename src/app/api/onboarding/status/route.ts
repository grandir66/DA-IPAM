import { NextResponse } from "next/server";
import { isTenantOnboardingCompleted, isOnboardingCompleted } from "@/lib/db-hub";
import { auth } from "@/lib/auth";

/**
 * Stato configurazione guidata per il tenant corrente.
 * Usa flag per-tenant; se non esiste, fallback al flag globale.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }
  const tenantCode = (session.user as Record<string, unknown>).tenantCode as string | null;
  // __ALL__ (superadmin aggregato): onboarding non serve
  if (!tenantCode || tenantCode === "__ALL__") {
    return NextResponse.json({ completed: true });
  }
  // Check per-tenant first, fallback to global
  const perTenant = isTenantOnboardingCompleted(tenantCode);
  const completed = perTenant || isOnboardingCompleted();
  return NextResponse.json({ completed });
}
