import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { probeUnifiController } from "@/lib/integrations/unifi-sync";

/**
 * POST /api/integrations/unifi/test-connection — prova il collegamento col
 * controller UniFi della configurazione salvata: login, lettura di
 * stat/device, logout.
 *
 * POST e non GET: la prova ha effetti (manda le credenziali al controller e
 * al primo uso fissa la fiducia nel certificato). Un GET partirebbe anche da
 * un link seguito con la sessione aperta (il cookie è SameSite=Lax) o da uno
 * strumento che apre gli indirizzi per controllarli.
 *
 * Admin, non solo autenticato: manda al controller le credenziali salvate e,
 * al primo collegamento riuscito, fissa l'impronta del certificato nella
 * configurazione (`integration_unifi_cert_pin`). Fissare la fiducia in un
 * certificato è una scelta dell'amministratore, come il PUT della
 * configurazione. Non tocca il DB del tenant, quindi niente contesto tenant.
 *
 * Risposta: `{ ok: true, devices, certPin, certPinRecorded }` oppure
 * `{ ok: false, reason, message, presentedPin?, expectedPin? }`. Mai segreti.
 */
export async function POST() {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;

  const result = await probeUnifiController();
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
