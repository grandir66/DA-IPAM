/**
 * Reverse proxy verso LibreNMS. Accesso automatico solo per chi è almeno admin;
 * per gli altri inoltra senza i cookie di LibreNMS (T3-26, SEC-6 parte viewer).
 * La decisione sta in `gestisciProxyLibreNMS`, con le dipendenze iniettate.
 */
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getIntegrationConfig } from "@/lib/integrations/config";
import {
  attachLibreNMSCookiesToResponse,
  librenmsAutologinCookieHeader,
  librenmsAutologinEnabled,
  librenmsProxyHostHeader,
  librenmsSvuotaSessioniAccesso,
} from "@/lib/integrations/librenms-proxy-auth";
import { gestisciProxyLibreNMS, LIBRENMS_PROXY_BASE } from "@/lib/integrations/librenms-accesso";
import { proxyRequest, type ReverseProxyOptions } from "@/lib/integrations/reverse-proxy";
import type { ComponentConfig } from "@/lib/integrations/types";

const BASE_PATH = LIBRENMS_PROXY_BASE;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function librenmsHtmlRewriteHosts(cfg: ComponentConfig): string[] {
  const hosts: string[] = [];
  for (const raw of [cfg.uiUrl, process.env.LIBRENMS_UI_URL]) {
    if (!raw?.trim()) continue;
    try {
      hosts.push(new URL(raw.trim()).host);
    } catch {
      /* skip */
    }
  }
  return hosts;
}

function librenmsProxyOpts(cfg: ComponentConfig, hostHeader?: string): ReverseProxyOptions {
  return {
    upstreamOrigin: cfg.url.replace(/\/+$/, ""),
    basePath: BASE_PATH,
    insecureTls: true,
    timeoutMs: 30_000,
    extraRequestHeaders: hostHeader ? { Host: hostHeader } : undefined,
    extraHtmlRewriteHosts: librenmsHtmlRewriteHosts(cfg),
  };
}

async function handle(req: Request): Promise<Response> {
  const session = await requireAuth();
  if (isAuthError(session)) return session;

  const cfg = getIntegrationConfig("librenms");
  if (cfg.mode === "disabled" || !cfg.url) {
    return new Response("LibreNMS non configurato", { status: 404 });
  }

  const proxyOpts = librenmsProxyOpts(cfg, librenmsProxyHostHeader());
  return gestisciProxyLibreNMS(req, session.user.role, {
    accessoAutomaticoAttivo: librenmsAutologinEnabled,
    cookieAccessoAutomatico: librenmsAutologinCookieHeader,
    inoltra: (r) => proxyRequest(r, proxyOpts),
    allegaCookie: (resp, cookie) => attachLibreNMSCookiesToResponse(resp, cookie, BASE_PATH),
    svuotaCache: librenmsSvuotaSessioniAccesso,
  });
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as HEAD, handle as OPTIONS };
