/**
 * Reverse proxy verso LibreNMS con SSO DA-IPAM.
 */
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getIntegrationConfig } from "@/lib/integrations/config";
import {
  attachLibreNMSCookiesToResponse,
  librenmsAutologinEnabled,
  librenmsAutologinCookieHeader,
  librenmsProxyHostHeader,
  withLibreNMSAutologin,
} from "@/lib/integrations/librenms-proxy-auth";
import { proxyRequest, type ReverseProxyOptions } from "@/lib/integrations/reverse-proxy";
import type { ComponentConfig } from "@/lib/integrations/types";

const BASE_PATH = "/api/integrations/proxy/librenms";

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
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;

  const cfg = getIntegrationConfig("librenms");
  if (cfg.mode === "disabled" || !cfg.url) {
    return new Response("LibreNMS non configurato", { status: 404 });
  }

  const sso = librenmsAutologinEnabled();
  let autologinCookies: string | null = null;

  if (sso) {
    autologinCookies = await librenmsAutologinCookieHeader();
    if (!autologinCookies) {
      return new Response(
        "SSO LibreNMS non disponibile — verifica integration_librenms_admin_password",
        { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } },
      );
    }
  }

  const proxiedReq = autologinCookies
    ? await withLibreNMSAutologin(req, autologinCookies)
    : req;
  const hostHeader = librenmsProxyHostHeader();
  const proxyOpts = librenmsProxyOpts(cfg, hostHeader);

  let resp = await proxyRequest(proxiedReq, proxyOpts);

  // Login page dopo autologin → redirect alla home proxy con cookie impostati.
  const reqPath = new URL(req.url).pathname;
  if (
    autologinCookies &&
    (reqPath.endsWith("/login") || resp.headers.get("location")?.includes("/login"))
  ) {
    const overviewReq = new Request(
      new URL(`${BASE_PATH}/`, req.url),
      { method: "GET", headers: proxiedReq.headers },
    );
    resp = await proxyRequest(overviewReq, proxyOpts);
  }

  if (autologinCookies) {
    return attachLibreNMSCookiesToResponse(resp, autologinCookies, BASE_PATH);
  }

  return resp;
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as HEAD, handle as OPTIONS };
