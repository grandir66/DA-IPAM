import { NextResponse } from "next/server";
import { requireAdmin, isAuthError, getTenantCodeFromSession } from "@/lib/api-auth";
import { setTenantOnboardingCompleted, setSetting } from "@/lib/db-hub";

/**
 * Segna l'onboarding come completato per il tenant corrente (mutazione → admin, G6).
 */
export async function POST() {
  const session = await requireAdmin();
  if (isAuthError(session)) return session;
  const tenantCode = getTenantCodeFromSession(session);
  if (!tenantCode || tenantCode === "__ALL__") {
    return NextResponse.json({ error: "Nessun tenant selezionato" }, { status: 400 });
  }
  try {
    setTenantOnboardingCompleted(tenantCode, true);
    // Mantieni anche il flag globale per backward-compat
    setSetting("onboarding_completed", "1");
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[onboarding/complete]", e);
    return NextResponse.json({ error: "Errore nel completamento wizard" }, { status: 500 });
  }
}
