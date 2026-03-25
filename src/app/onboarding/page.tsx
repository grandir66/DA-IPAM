import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isTenantOnboardingCompleted, isOnboardingCompleted } from "@/lib/db-hub";
import { OnboardingWizard } from "./onboarding-wizard";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await auth();
  if (!session) {
    redirect("/login");
  }
  const tenantCode = (session.user as Record<string, unknown>)?.tenantCode as string | null;
  // Superadmin aggregato: no wizard
  if (!tenantCode || tenantCode === "__ALL__") {
    redirect("/");
  }
  // Check per-tenant first, fallback to global
  if (isTenantOnboardingCompleted(tenantCode) || isOnboardingCompleted()) {
    redirect("/");
  }
  return <OnboardingWizard />;
}
