import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { setTenantOnboardingCompleted, setSetting } from "@/lib/db-hub";

/**
 * Segna l'onboarding come completato per il tenant corrente.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }
  const tenantCode = (session.user as Record<string, unknown>).tenantCode as string | null;
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
