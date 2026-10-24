import { NextResponse } from "next/server";
import { requireAdminOrOnboarding, isAuthError, getTenantCodeFromSession } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { validaProgresso } from "@/lib/onboarding/progresso";
import { leggiRiepilogoWizard, salvaProgresso } from "@/lib/onboarding/progresso-store";
import { leggiReteAppliance } from "@/lib/onboarding/rete-appliance-server";

/**
 * Punto raggiunto nel wizard di prima configurazione (tappa 4 credenziali, 15/10).
 *
 * GET: il punto salvato per il cliente della sessione, ripulito degli oggetti
 * che non ci sono più, con i dati di router, rete e integrazione AD già creati.
 * PUT: salva `{ passo, router_device_id, network_id, ad_integration_id }`.
 * Il wizard lo aggiorna a ogni passo, così «Esci» e una riapertura da
 * Impostazioni ripartono da lì invece di ricreare router e rete.
 * La GET porta anche `rete_appliance`: la rete su cui è installata l'appliance,
 * che il wizard propone come prima subnet (24/10).
 */
const NO_CACHE = { "Cache-Control": "no-store" };

const SENZA_CLIENTE = "Seleziona un cliente: la configurazione guidata vale per un cliente alla volta";

export async function GET() {
  const sessione = await requireAdminOrOnboarding();
  if (isAuthError(sessione)) return sessione;
  const tenantCode = getTenantCodeFromSession(sessione);
  if (!tenantCode || tenantCode === "__ALL__") {
    return NextResponse.json({ error: SENZA_CLIENTE }, { status: 400 });
  }
  return withTenantFromSession(async () => {
    try {
      return NextResponse.json({ ...leggiRiepilogoWizard(tenantCode), rete_appliance: leggiReteAppliance() }, { headers: NO_CACHE });
    } catch (e) {
      console.error("[onboarding/progresso] lettura:", e);
      return NextResponse.json({ error: "Impossibile leggere il punto raggiunto nel wizard" }, { status: 500 });
    }
  });
}

export async function PUT(request: Request) {
  const sessione = await requireAdminOrOnboarding();
  if (isAuthError(sessione)) return sessione;
  const tenantCode = getTenantCodeFromSession(sessione);
  if (!tenantCode || tenantCode === "__ALL__") {
    return NextResponse.json({ error: SENZA_CLIENTE }, { status: 400 });
  }
  const body: unknown = await request.json().catch(() => null);
  const esito = validaProgresso(body);
  if (!esito.ok) {
    return NextResponse.json({ error: esito.errore }, { status: 400 });
  }
  try {
    salvaProgresso(tenantCode, esito.progresso);
    return NextResponse.json({ success: true, progresso: esito.progresso });
  } catch (e) {
    console.error("[onboarding/progresso] salvataggio:", e);
    return NextResponse.json({ error: "Impossibile salvare il punto raggiunto nel wizard" }, { status: 500 });
  }
}
