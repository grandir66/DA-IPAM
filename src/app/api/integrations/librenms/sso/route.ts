/**
 * Accesso automatico a LibreNMS sull'interfaccia diretta (nginx :7443): per chi
 * è almeno admin fa il login lato server e rimanda coi cookie laravel_session
 * (Path=/); per gli altri rimanda all'URL diretto, dove LibreNMS chiede il suo
 * login (T3-26, SEC-6 parte viewer).
 */
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getIntegrationConfig } from "@/lib/integrations/config";
import { resolveIntegrationBrowserUrl } from "@/lib/integrations/public-url-server";
import {
  buildDirectLibreNMSSetCookies,
  librenmsAutologinCookieHeader,
  librenmsAutologinEnabled,
} from "@/lib/integrations/librenms-proxy-auth";
import { gestisciAccessoAutomaticoLibreNMS } from "@/lib/integrations/librenms-accesso";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await requireAuth();
  if (isAuthError(session)) return session;

  const cfg = getIntegrationConfig("librenms");
  if (cfg.mode === "disabled" || !cfg.url) {
    return new Response("LibreNMS non configurato", { status: 404 });
  }

  const target = `${resolveIntegrationBrowserUrl("librenms", cfg.url).replace(/\/+$/, "")}/`;
  return gestisciAccessoAutomaticoLibreNMS(target, session.user.role, {
    accessoAutomaticoAttivo: librenmsAutologinEnabled,
    cookieAccessoAutomatico: librenmsAutologinCookieHeader,
    setCookieDiretti: buildDirectLibreNMSSetCookies,
  });
}
