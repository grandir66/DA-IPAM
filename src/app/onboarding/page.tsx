import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isOnboardingCompleted } from "@/lib/db";
import { OnboardingWizard } from "./onboarding-wizard";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await auth();
  if (!session) {
    redirect("/login");
  }
  if (isOnboardingCompleted()) {
    redirect("/");
  }
  return <OnboardingWizard />;
}
