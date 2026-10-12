import { getIntegrationConfig } from "@/lib/integrations/config";
import {
  getLibreNMSWebSession,
  librenmsHostHeaderFromUiUrl,
} from "@/lib/integrations/librenms-web-session";
import { isInternalIntegrationUrl } from "@/lib/integrations/public-url";
import { scegliUrlOperatoreLibreNMS } from "@/lib/integrations/librenms-accesso";

const DEFAULT_USERNAME = "admin";

/** Header Host per upstream loopback quando APP_URL include porta LAN. */
export function librenmsProxyHostHeader(): string | undefined {
  const cfg = getIntegrationConfig("librenms");
  return (
    librenmsHostHeaderFromUiUrl(cfg.uiUrl) ??
    librenmsHostHeaderFromUiUrl(process.env.LIBRENMS_UI_URL) ??
    undefined
  );
}

/**
 * Origin per autologin web: deve essere l'URL HTTPS pubblico (APP_URL / ui_url).
 * Login su http://127.0.0.1:8000 produce cookie Laravel non validi anche con Host header.
 */
export function librenmsAutologinUpstreamOrigin(): string | null {
  const cfg = getIntegrationConfig("librenms");
  const ui =
    cfg.uiUrl?.trim() ||
    process.env.LIBRENMS_UI_URL?.trim() ||
    "";
  if (ui && !isInternalIntegrationUrl(ui)) {
    return ui.replace(/\/+$/, "");
  }
  const api = cfg.url?.trim() ?? "";
  if (api && !isInternalIntegrationUrl(api)) {
    return api.replace(/\/+$/, "");
  }
  return null;
}

/** Cookie sessione LibreNMS se adminPassword configurata e autologin attivo. */
export async function librenmsAutologinCookieHeader(): Promise<string | null> {
  const cfg = getIntegrationConfig("librenms");
  const password = cfg.adminPassword?.trim();
  const loginOrigin = librenmsAutologinUpstreamOrigin();
  if (!password || cfg.mode === "disabled" || !cfg.url || !loginOrigin) return null;

  try {
    const { cookieHeader } = await getLibreNMSWebSession({
      upstreamOrigin: loginOrigin,
      hostHeader: librenmsHostHeaderFromUiUrl(loginOrigin),
      username: DEFAULT_USERNAME,
      password,
      insecureTls: true,
    });
    return cookieHeader;
  } catch (e) {
    console.warn(
      "[librenms-sso] autologin fallito:",
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }
}

export function librenmsAutologinEnabled(): boolean {
  const cfg = getIntegrationConfig("librenms");
  return (
    cfg.mode !== "disabled" &&
    !!cfg.url &&
    !!cfg.adminPassword?.trim() &&
    !!librenmsAutologinUpstreamOrigin()
  );
}

/**
 * URL da usare in Launchpad e nei link verso LibreNMS. Il ruolo è obbligatorio:
 * l'accesso automatico (che entra con la password admin) solo per chi è almeno
 * admin; per gli altri, e per un ruolo sconosciuto, l'URL diretto (T3-26).
 */
export function resolveLibreNMSOperatorUrl(browserUrl: string, ruolo: unknown): string {
  return scegliUrlOperatoreLibreNMS(browserUrl, ruolo, librenmsAutologinEnabled);
}

/** Cookie da impostare nel browser (Path = proxy base). */
export function buildBrowserSetCookies(cookieHeader: string, basePath: string): string[] {
  return buildLibreNMSSetCookies(cookieHeader, basePath.replace(/\/+$/, "") || "/");
}

/** Cookie sessione LibreNMS per accesso diretto nginx :7443 (Path=/, stesso host). */
export function buildDirectLibreNMSSetCookies(cookieHeader: string): string[] {
  return buildLibreNMSSetCookies(cookieHeader, "/");
}

function buildLibreNMSSetCookies(cookieHeader: string, path: string): string[] {
  const out: string[] = [];
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!name || !value) continue;
    const common = `Path=${path}; Secure; SameSite=Lax`;
    if (name === "laravel_session") {
      out.push(`${name}=${value}; ${common}; HttpOnly`);
    } else {
      out.push(`${name}=${value}; ${common}`);
    }
  }
  return out;
}

/** Propaga sessione LibreNMS al browser (iframe / navigazione proxy). */
export async function attachLibreNMSCookiesToResponse(
  resp: Response,
  cookieHeader: string,
  basePath: string,
): Promise<Response> {
  const headers = new Headers(resp.headers);
  for (const sc of buildBrowserSetCookies(cookieHeader, basePath)) {
    headers.append("set-cookie", sc);
  }
  const body = await resp.arrayBuffer();
  return new Response(body, { status: resp.status, headers });
}
