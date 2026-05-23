/**
 * Reverse proxy verso LibreNMS.
 *
 * Espone l'UI LibreNMS sotto `/api/integrations/proxy/librenms/*` rimuovendo
 * `X-Frame-Options` e `Content-Security-Policy`, così che l'iframe della
 * pagina "Integrazioni" possa caricarla anche quando LibreNMS la blocca
 * tramite la sua configurazione di default (`frame_options = "DENY"`).
 *
 * Autenticazione: usiamo le credenziali sessione che LibreNMS già accetta
 * (cookie). Per le richieste API che richiedono `X-Auth-Token` il client
 * dovrebbe usarle direttamente; qui non iniettiamo token globali per non
 * disturbare il flusso di login web.
 */
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getIntegrationConfig } from "@/lib/integrations/config";
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

  return proxyRequest(req, {
    upstreamOrigin: cfg.url.replace(/\/+$/, ""),
    basePath: BASE_PATH,
    // LibreNMS è solitamente HTTP locale; lasciamo che la lib gestisca
    // automaticamente il flag in base allo schema. Se l'utente ha messo
    // https self-signed nel campo URL, lo accettiamo comunque.
    insecureTls: true,
    timeoutMs: 30_000,
  });
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as HEAD, handle as OPTIONS };
