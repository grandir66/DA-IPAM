import { getIntegrationConfig } from "@/lib/integrations/config";
import {
  clearLibreNMSWebSessionCache,
  getLibreNMSWebSession,
  librenmsHostHeaderFromUiUrl,
  verificaSessioneLibreNMS,
  type LibreNMSWebSessionOptions,
} from "@/lib/integrations/librenms-web-session";
import { applianceHostPubblici, isInternalIntegrationUrl } from "@/lib/integrations/public-url";
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

/**
 * Opzioni del login web automatico, o null se l'accesso automatico non è
 * configurato.
 *
 * `insecureTls: true` è VOLUTO e resta (passo 4b, 16/10): LibreNMS dell'appliance
 * sta dietro il certificato autofirmato di nginx, che il server DA-IPAM non conosce.
 * L'esito però è esplicito: la verifica «apertura per il browser» di LibreNMS
 * mostra il certificato e la sua impronta (`modules/apertura-bersagli.ts`).
 */
function opzioniAccessoAutomatico(): LibreNMSWebSessionOptions | null {
  const cfg = getIntegrationConfig("librenms");
  const password = cfg.adminPassword?.trim();
  const loginOrigin = librenmsAutologinUpstreamOrigin();
  if (!password || cfg.mode === "disabled" || !cfg.url || !loginOrigin) return null;
  return {
    upstreamOrigin: loginOrigin,
    hostHeader: librenmsHostHeaderFromUiUrl(loginOrigin),
    username: DEFAULT_USERNAME,
    password,
    insecureTls: true,
  };
}

/** Cookie sessione LibreNMS se adminPassword configurata e autologin attivo. */
export async function librenmsAutologinCookieHeader(): Promise<string | null> {
  const opts = opzioniAccessoAutomatico();
  if (!opts) return null;
  try {
    const { cookieHeader } = await getLibreNMSWebSession(opts);
    return cookieHeader;
  } catch (e) {
    console.warn(
      "[librenms-sso] autologin fallito:",
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }
}

/**
 * La sessione dell'accesso automatico apre ancora LibreNMS, o finisce sul login?
 * In caso di errore di rete risponde `true`: non si butta una sessione buona per
 * un intoppo, e sarà l'apertura a dire cosa non va.
 */
export async function librenmsSessioneAccessoValida(cookieHeader: string): Promise<boolean> {
  const opts = opzioniAccessoAutomatico();
  if (!opts) return false;
  try {
    return await verificaSessioneLibreNMS(opts, cookieHeader);
  } catch {
    return true;
  }
}

/** Svuota la cache delle sessioni: la prossima apertura rifà il login. */
export function librenmsSvuotaSessioniAccesso(): void {
  clearLibreNMSWebSessionCache();
}

/**
 * Nomi con cui il browser raggiunge l'appliance che serve LibreNMS (nginx :7443):
 * se l'URL di LibreNMS usa uno di questi, l'accesso automatico può rimandare il
 * browser sullo stesso nome con cui ha aperto DA-IPAM (i cookie seguono il nome).
 */
export function librenmsHostAllineabili(): string[] {
  return applianceHostPubblici();
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
