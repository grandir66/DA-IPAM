import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { auth } from "@/lib/auth";
import { resetLabNetworkConfig } from "@/lib/lab-config-reset";

/**
 * POST — azzera dati rete/discovery del tenant corrente e riapre onboarding.
 * Preserva integrazioni appliance, admin e vault credenziali.
 */
export async function POST() {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;

  const session = await auth();
  const tenantCode = (session?.user as Record<string, unknown>)?.tenantCode as string | null;
  if (!tenantCode || tenantCode === "__ALL__") {
    return NextResponse.json(
      { error: "Seleziona un tenant specifico prima del reset lab" },
      { status: 400 },
    );
  }

  try {
    const result = resetLabNetworkConfig(tenantCode);
    return NextResponse.json({
      success: true,
      ...result,
      message:
        "Configurazione di rete azzerata. Integrazioni appliance e account admin preservati.",
    });
  } catch (e) {
    console.error("[lab-config/reset]", e);
    return NextResponse.json(
      { error: "Impossibile azzerare la configurazione di rete" },
      { status: 500 },
    );
  }
}
