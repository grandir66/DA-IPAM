/**
 * Reverse proxy verso la dashboard Wazuh (OpenSearch Dashboards).
 *
 * Risolve due problemi che impediscono di mostrare la UI Wazuh in un iframe
 * dentro DA-IPAM:
 *   1. il cert TLS della dashboard è self-signed (default Wazuh) → il browser
 *      blocca l'iframe finché l'utente non l'ha accettato manualmente.
 *   2. la dashboard imposta `X-Frame-Options` / `Content-Security-Policy:
 *      frame-ancestors` che rendono comunque impossibile l'embedding anche
 *      con cert valido.
 *
 * Connettendoci server-side con `rejectUnauthorized: false` e strippando
 * questi header, il browser vede solo il cert (trusted) di DA-IPAM e accetta
 * l'embedding.
 *
 * Caveat noti: chiamate JS che usano `window.location.origin` come prefisso
 * assoluto (`/api/...`) andranno comunque a DA-IPAM e potrebbero rompersi.
 * Per piena funzionalità interna della dashboard, configurare lato Wazuh
 * `server.basePath: "/api/integrations/proxy/wazuh"` +
 * `server.rewriteBasePath: true` in /etc/wazuh-dashboard/opensearch_dashboards.yml.
 * Senza quella config: navigazione base OK, alcune view dinamiche no.
 */
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getWazuhConfig } from "@/lib/integrations/wazuh-config";
import { proxyRequest } from "@/lib/integrations/reverse-proxy";

const BASE_PATH = "/api/integrations/proxy/wazuh";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(req: Request): Promise<Response> {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;

  const cfg = getWazuhConfig();
  if (!cfg.enabled || !cfg.url) {
    return new Response("Wazuh non configurato", { status: 404 });
  }

  // wazuh.url punta tipicamente al Manager API su :55000.
  // La dashboard vive sull'host senza porta esplicita (443).
  let dashUrl = cfg.url.replace(/:55000(\/.*)?$/, "");
  if (!/^https?:\/\//.test(dashUrl)) dashUrl = `https://${dashUrl}`;
  // rimuove eventuale path/slash finale
  dashUrl = dashUrl.replace(/\/+$/, "");
  try {
    const u = new URL(dashUrl);
    // tieni solo schema + host (+porta se diversa da 443)
    dashUrl = `${u.protocol}//${u.host}`;
  } catch {
    return new Response("URL Wazuh non valido", { status: 500 });
  }

  return proxyRequest(req, {
    upstreamOrigin: dashUrl,
    basePath: BASE_PATH,
    insecureTls: !cfg.verifyTls,
    timeoutMs: 30_000,
  });
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as HEAD, handle as OPTIONS };
