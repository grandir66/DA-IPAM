import { NextResponse } from "next/server";
import { requireAdminOrOnboarding, isAuthError, getTenantCodeFromSession } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { modificaRouterDelWizard } from "@/lib/onboarding/router-store";

/**
 * Modifica del router già registrato dal wizard di prima configurazione
 * (tappa 4 credenziali, revisione del 15/10).
 *
 * PUT `{ device_id, name?, host?, vendor?, protocol?, credential_id?, snmp_credential_id? }`:
 * colonne, porta della voce e binding delle credenziali insieme, in una
 * transazione. Il PUT dell'apparato scrive solo le colonne, e il sistema
 * avrebbe continuato a usare i binding e la porta di prima. Restituisce il
 * router come lo rilegge il wizard.
 */
export async function PUT(request: Request) {
  const sessione = await requireAdminOrOnboarding();
  if (isAuthError(sessione)) return sessione;
  const tenantCode = getTenantCodeFromSession(sessione);
  if (!tenantCode || tenantCode === "__ALL__") {
    return NextResponse.json(
      { error: "Seleziona un cliente: la configurazione guidata vale per un cliente alla volta" },
      { status: 400 },
    );
  }
  const corpo: unknown = await request.json().catch(() => null);
  return withTenantFromSession(async () => {
    try {
      const esito = modificaRouterDelWizard(corpo);
      if (!esito.ok) return NextResponse.json({ error: esito.error }, { status: esito.status });
      return NextResponse.json(esito.router);
    } catch (e) {
      console.error("[onboarding/router] modifica:", e);
      return NextResponse.json({ error: "Impossibile aggiornare il router" }, { status: 500 });
    }
  });
}
