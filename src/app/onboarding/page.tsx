import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getSetting, setTenantOnboardingCompleted } from "@/lib/db-hub";
import { withTenant } from "@/lib/db-tenant";
import { OnboardingWizard } from "./onboarding-wizard";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await auth();
  if (!session) {
    redirect("/login");
  }
  const tenantCode = (session.user as Record<string, unknown>)?.tenantCode as string | null;
  if (!tenantCode || tenantCode === "__ALL__") {
    redirect("/");
  }
  // Flag esplicito per-tenant
  const explicit = getSetting(`onboarding_completed:${tenantCode}`);
  if (explicit === "1") {
    redirect("/");
  }
  // Se nessun flag esplicito, verifica se ha già dati
  if (explicit === null) {
    // null = non so (lettura fallita): si mostra il wizard ma il flag non si scrive.
    const hasData = withTenant(tenantCode, (): boolean | null => {
      try {
        const { getNetworks, getNetworkDevices } = require("@/lib/db-tenant");
        return getNetworks().length > 0 || getNetworkDevices().length > 0;
      } catch (e) {
        console.error(`[onboarding] ${tenantCode}: lettura reti/apparati fallita:`, e);
        return null;
      }
    });
    if (hasData) {
      redirect("/");
    }
    // Tenant vuoto: il flag «da configurare» si scrive all'apertura (tappa 1).
    // Prima restava assente, il router creato al primo passo diventava «dati
    // presenti» e una ricarica faceva sparire il wizard a metà.
    if (hasData === false) {
      setTenantOnboardingCompleted(tenantCode, false);
    }
  }
  return <OnboardingWizard />;
}
