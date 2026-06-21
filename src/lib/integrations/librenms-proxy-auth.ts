import { getIntegrationConfig } from "@/lib/integrations/config";
import {
  getLibreNMSWebSession,
  librenmsHostHeaderFromUiUrl,
  requestHasLibreNMSSession,
} from "@/lib/integrations/librenms-web-session";

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

/** Cookie sessione LibreNMS se adminPassword configurata e autologin attivo. */
export async function librenmsAutologinCookieHeader(): Promise<string | null> {
  const cfg = getIntegrationConfig("librenms");
  const password = cfg.adminPassword?.trim();
  if (!password || cfg.mode === "disabled" || !cfg.url) return null;

  try {
    const { cookieHeader } = await getLibreNMSWebSession({
      upstreamOrigin: cfg.url.replace(/\/+$/, ""),
      hostHeader: librenmsProxyHostHeader(),
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

export function mergeCookieHeaders(a: string | null | undefined, b: string | null | undefined): string {
  const parts = [a, b].filter((x) => x?.trim());
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]}; ${parts[1]}`;
}

export function stripLibreNMSCookies(cookieHeader: string | null | undefined): string {
  if (!cookieHeader?.trim()) return "";
  return cookieHeader
    .split(";")
    .map((s) => s.trim())
    .filter((p) => p && !/^laravel_session=/i.test(p) && !/^XSRF-TOKEN=/i.test(p))
    .join("; ");
}

export async function withLibreNMSAutologin(
  req: Request,
  sessionCookie?: string | null,
): Promise<Request> {
  const auto = sessionCookie ?? (await librenmsAutologinCookieHeader());
  if (!auto) return req;

  const headers = new Headers(req.headers);
  const cleaned = stripLibreNMSCookies(req.headers.get("cookie"));
  headers.set("cookie", mergeCookieHeaders(cleaned, auto));

  const init: RequestInit = { method: req.method, headers };
  if (req.body) {
    init.body = req.body;
    (init as RequestInit & { duplex?: string }).duplex = "half";
  }
  return new Request(req.url, init);
}

export function librenmsAutologinEnabled(): boolean {
  const cfg = getIntegrationConfig("librenms");
  return cfg.mode !== "disabled" && !!cfg.url && !!cfg.adminPassword?.trim();
}

/** Cookie da impostare nel browser (Path = proxy base). */
export function buildBrowserSetCookies(cookieHeader: string, basePath: string): string[] {
  const path = basePath.replace(/\/+$/, "") || "/";
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
