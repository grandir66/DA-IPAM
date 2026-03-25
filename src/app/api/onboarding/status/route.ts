import { NextResponse } from "next/server";
import { isTenantOnboardingCompleted, getSetting } from "@/lib/db-hub";
import { auth } from "@/lib/auth";
import { withTenant } from "@/lib/db-tenant";

/**
 * Stato configurazione guidata per il tenant corrente.
 * Per-tenant: se il flag esplicito esiste, lo rispetta.
 * Se non esiste, controlla se il tenant ha già dati (reti/device).
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
  // Flag esplicito per-tenant (settato dal wizard o dal reset)
  const explicit = getSetting(`onboarding_completed:${tenantCode}`);
  if (explicit !== null) {
    return NextResponse.json({ completed: explicit === "1" });
  }
  // Nessun flag esplicito: il tenant ha già dati? Se sì, wizard non necessario
  const hasData = withTenant(tenantCode, () => {
    try {
      const { getNetworks, getNetworkDevices } = require("@/lib/db-tenant");
      const nets = getNetworks();
      const devs = getNetworkDevices();
      return nets.length > 0 || devs.length > 0;
    } catch {
      return false;
    }
  });
  return NextResponse.json({ completed: hasData });
}
