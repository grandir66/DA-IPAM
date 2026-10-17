/**
 * Accesso automatico a LibreNMS sull'interfaccia diretta (nginx :7443): per chi
 * è almeno admin fa il login lato server e rimanda coi cookie laravel_session
 * (Path=/); per gli altri rimanda all'URL diretto, dove LibreNMS chiede il suo
 * login (T3-26, SEC-6 parte viewer).
 *
 * Passo 4b (16/10): la sessione in cache si controlla prima di usarla (finisce
 * sul login → cache svuotata e login nuovo) e il 302 porta a LibreNMS sullo
 * stesso nome con cui il browser ha aperto DA-IPAM, dove sono finiti i cookie.
 */
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getIntegrationConfig } from "@/lib/integrations/config";
import { resolveIntegrationBrowserUrl } from "@/lib/integrations/public-url-server";
import {
  buildDirectLibreNMSSetCookies,
  librenmsAutologinCookieHeader,
  librenmsAutologinEnabled,
  librenmsHostAllineabili,
  librenmsSessioneAccessoValida,
  librenmsSvuotaSessioniAccesso,
} from "@/lib/integrations/librenms-proxy-auth";
import { gestisciAccessoAutomaticoLibreNMS, hostDellaRichiesta } from "@/lib/integrations/librenms-accesso";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await requireAuth();
  if (isAuthError(session)) return session;

  const cfg = getIntegrationConfig("librenms");
  if (cfg.mode === "disabled" || !cfg.url) {
    return new Response("LibreNMS non configurato", { status: 404 });
  }

  const target = `${resolveIntegrationBrowserUrl("librenms", cfg.url).replace(/\/+$/, "")}/`;
  return gestisciAccessoAutomaticoLibreNMS(
    target,
    session.user.role,
    {
      accessoAutomaticoAttivo: librenmsAutologinEnabled,
      cookieAccessoAutomatico: librenmsAutologinCookieHeader,
      setCookieDiretti: buildDirectLibreNMSSetCookies,
      sessioneValida: librenmsSessioneAccessoValida,
      svuotaCache: librenmsSvuotaSessioniAccesso,
    },
    { hostRichiesta: hostDellaRichiesta(req.headers), hostAllineabili: librenmsHostAllineabili() },
  );
}
