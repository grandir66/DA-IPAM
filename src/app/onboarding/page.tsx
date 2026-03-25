import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getSetting } from "@/lib/db-hub";
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
    const hasData = withTenant(tenantCode, () => {
      try {
        const { getNetworks, getNetworkDevices } = require("@/lib/db-tenant");
        return getNetworks().length > 0 || getNetworkDevices().length > 0;
      } catch {
        return false;
      }
    });
    if (hasData) {
      redirect("/");
    }
  }
  return <OnboardingWizard />;
}
