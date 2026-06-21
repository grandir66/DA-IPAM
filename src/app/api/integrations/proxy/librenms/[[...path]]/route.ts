/**
 * Reverse proxy verso LibreNMS con SSO DA-IPAM.
 *
 * Se `integration_librenms_admin_password` è configurata, effettua login
 * server-side e inietta i cookie Laravel — l'operatore già autenticato in
 * DA-IPAM accede all'UI senza seconda password.
 */
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getIntegrationConfig } from "@/lib/integrations/config";
import {
  librenmsAutologinEnabled,
  librenmsProxyHostHeader,
  withLibreNMSAutologin,
} from "@/lib/integrations/librenms-proxy-auth";
import { proxyRequest } from "@/lib/integrations/reverse-proxy";

const BASE_PATH = "/api/integrations/proxy/librenms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(req: Request): Promise<Response> {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;

  const cfg = getIntegrationConfig("librenms");
  if (cfg.mode === "disabled" || !cfg.url) {
    return new Response("LibreNMS non configurato", { status: 404 });
  }

  const proxiedReq = librenmsAutologinEnabled() ? await withLibreNMSAutologin(req) : req;
  const hostHeader = librenmsProxyHostHeader();

  return proxyRequest(proxiedReq, {
    upstreamOrigin: cfg.url.replace(/\/+$/, ""),
    basePath: BASE_PATH,
    insecureTls: true,
    timeoutMs: 30_000,
    extraRequestHeaders: hostHeader ? { Host: hostHeader } : undefined,
  });
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as HEAD, handle as OPTIONS };
