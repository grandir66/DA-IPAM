/**
 * Sessione web LibreNMS per reverse proxy DA-IPAM (SSO operatore).
 * Effettua login form Laravel e cache cookie server-side.
 */
import * as http from "node:http";
import * as https from "node:https";
import { URL } from "node:url";

export interface LibreNMSWebSessionOptions {
  upstreamOrigin: string;
  /** Host header richiesto da APP_URL (es. 192.168.99.50:7443). */
  hostHeader?: string;
  username: string;
  password: string;
  insecureTls?: boolean;
  timeoutMs?: number;
}

interface CookieJar {
  cookieHeader: string;
  expiresAt: number;
}

const cache = new Map<string, CookieJar>();
const TTL_MS = 45 * 60 * 1000;

function cacheKey(opts: LibreNMSWebSessionOptions): string {
  return `${opts.upstreamOrigin}|${opts.hostHeader ?? ""}|${opts.username}`;
}

function parseSetCookies(headers: http.IncomingHttpHeaders): string[] {
  const raw = headers["set-cookie"];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function mergeCookieHeader(existing: string, setCookies: string[]): string {
  const jar = new Map<string, string>();
  for (const part of existing.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    jar.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  for (const sc of setCookies) {
    const pair = sc.split(";")[0]?.trim();
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function httpRequest(
  url: URL,
  opts: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    insecureTls?: boolean;
    timeoutMs?: number;
  },
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const isHttps = url.protocol === "https:";
  const client = isHttps ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(
      {
        method: opts.method ?? "GET",
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        headers: opts.headers,
        rejectUnauthorized: opts.insecureTls ? false : undefined,
        timeout: opts.timeoutMs ?? 15_000,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function extractCsrfToken(html: string): string | null {
  const m = html.match(/name="_token"\s+value="([^"]+)"/);
  if (m?.[1]) return m[1];
  const meta = html.match(/name="csrf-token"\s+content="([^"]+)"/);
  return meta?.[1] ?? null;
}

function xsrfFromCookieHeader(cookieHeader: string): string | null {
  const m = cookieHeader.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

export function requestHasLibreNMSSession(cookieHeader: string | null | undefined): boolean {
  return !!cookieHeader && /(?:^|;\s*)laravel_session=/.test(cookieHeader);
}

/** Ottiene cookie laravel_session validi (cache in-memory per processo). */
export async function getLibreNMSWebSession(
  opts: LibreNMSWebSessionOptions,
): Promise<{ cookieHeader: string }> {
  const key = cacheKey(opts);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return { cookieHeader: hit.cookieHeader };
  }

  const origin = opts.upstreamOrigin.replace(/\/+$/, "");
  const loginUrl = new URL("/login", `${origin}/`);
  const host = opts.hostHeader;
  const referer = host
    ? `${loginUrl.protocol}//${host}/login`
    : loginUrl.toString();

  const getHeaders: Record<string, string> = { Accept: "text/html" };
  if (host) getHeaders.host = host;

  const loginPage = await httpRequest(loginUrl, {
    headers: getHeaders,
    insecureTls: opts.insecureTls,
    timeoutMs: opts.timeoutMs,
  });

  const token = extractCsrfToken(loginPage.body);
  if (!token) {
    throw new Error("LibreNMS login: CSRF token non trovato");
  }

  let cookies = mergeCookieHeader("", parseSetCookies(loginPage.headers));
  const xsrf = xsrfFromCookieHeader(cookies);

  const form = new URLSearchParams({
    _token: token,
    username: opts.username,
    password: opts.password,
  }).toString();

  const postHeaders: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "text/html",
    Referer: referer,
    Cookie: cookies,
  };
  if (host) postHeaders.host = host;
  if (xsrf) postHeaders["X-XSRF-TOKEN"] = xsrf;

  const post = await httpRequest(loginUrl, {
    method: "POST",
    headers: postHeaders,
    body: form,
    insecureTls: opts.insecureTls,
    timeoutMs: opts.timeoutMs,
  });

  cookies = mergeCookieHeader(cookies, parseSetCookies(post.headers));

  if (!requestHasLibreNMSSession(cookies)) {
    throw new Error(`LibreNMS login fallito (HTTP ${post.status})`);
  }

  cache.set(key, { cookieHeader: cookies, expiresAt: Date.now() + TTL_MS });
  return { cookieHeader: cookies };
}

export function librenmsHostHeaderFromUiUrl(uiUrl: string | undefined | null): string | undefined {
  if (!uiUrl?.trim()) return undefined;
  try {
    return new URL(uiUrl).host;
  } catch {
    return undefined;
  }
}

export function clearLibreNMSWebSessionCache(): void {
  cache.clear();
}
