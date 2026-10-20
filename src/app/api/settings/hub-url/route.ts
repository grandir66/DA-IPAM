import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { urlHubConfigurato } from "@/lib/inventory-agent/public-url";

/**
 * GET /api/settings/hub-url
 *
 * Restituisce l'URL pubblico dell'hub usato dai consumer (wizard install agent,
 * callback URL futuri, email templates) per riferirsi a questo hub da fuori la
 * rete dove risiede.
 *
 * Logica di scelta (`urlHubConfigurato`):
 *   1. Se `settings.public_hub_url` è valorizzato → effective_url = quel valore
 *      (schema://host[:port]).
 *   2. Altrimenti effective_url = null → il chiamante decide il fallback
 *      (es. `window.location.origin` sul wizard, con avviso visivo).
 *
 * Auth: requireAuth() — qualsiasi utente loggato può leggere. Non è un segreto.
 * La scrittura passa per `PUT /api/settings` standard (requireAdminOrOnboarding).
 */
export async function GET() {
  try {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;
    return NextResponse.json(urlHubConfigurato());
  } catch (e) {
    console.error("Errore GET /api/settings/hub-url:", e);
    return NextResponse.json({ error: "Errore" }, { status: 500 });
  }
}
