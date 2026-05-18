import { NextResponse } from "next/server";
import { getSetting } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/api-auth";

/**
 * GET /api/settings/hub-url
 *
 * Restituisce l'URL pubblico dell'hub usato dai consumer (wizard install agent,
 * callback URL futuri, email templates) per riferirsi a questo hub da fuori la
 * rete dove risiede.
 *
 * Logica di scelta:
 *   1. Se `settings.public_hub_url` è valorizzato → effective_url = quel valore
 *      (è la verità più esplicita: schema://host[:port]).
 *   2. Altrimenti se `settings.hub_tailnet_hostname` è valorizzato →
 *      effective_url = `https://<hostname>` (MagicDNS Tailscale, raggiungibile
 *      da chiunque sia in tailnet, indipendentemente dall'IP CGNAT corrente).
 *   3. Altrimenti effective_url = null → il chiamante deciderà il fallback
 *      (es. `window.location.origin` sul wizard, con warning visivo).
 *
 * Il campo `source` è utile per UI: permette di mostrare un badge "tailnet
 * MagicDNS" vs "public URL" vs warning quando si ricade sul browser origin.
 *
 * Auth: requireAuth() — qualsiasi utente loggato può leggere. Non è un segreto.
 * La scrittura passa per `PUT /api/settings` standard (requireAdminOrOnboarding).
 */
export async function GET() {
  try {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;

    const publicHubUrl = (getSetting("public_hub_url") ?? "").trim();
    const tailnetHostname = (getSetting("hub_tailnet_hostname") ?? "").trim();

    let effectiveUrl: string | null = null;
    let source: "public_hub_url" | "tailnet_hostname" | "none" = "none";

    if (publicHubUrl) {
      effectiveUrl = publicHubUrl.replace(/\/+$/, ""); // strip trailing slash
      source = "public_hub_url";
    } else if (tailnetHostname) {
      effectiveUrl = `https://${tailnetHostname}`;
      source = "tailnet_hostname";
    }

    return NextResponse.json({
      public_hub_url: publicHubUrl,
      hub_tailnet_hostname: tailnetHostname,
      effective_url: effectiveUrl,
      source,
    });
  } catch (e) {
    console.error("Errore GET /api/settings/hub-url:", e);
    return NextResponse.json({ error: "Errore" }, { status: 500 });
  }
}
