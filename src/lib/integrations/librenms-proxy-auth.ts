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
  } catch {
    return null;
  }
}

export function mergeCookieHeaders(a: string | null | undefined, b: string | null | undefined): string {
  const parts = [a, b].filter((x) => x?.trim());
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]}; ${parts[1]}`;
}

export async function withLibreNMSAutologin(req: Request): Promise<Request> {
  const incoming = req.headers.get("cookie");
  if (requestHasLibreNMSSession(incoming)) return req;

  const auto = await librenmsAutologinCookieHeader();
  if (!auto) return req;

  const headers = new Headers(req.headers);
  headers.set("cookie", mergeCookieHeaders(incoming, auto));

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
