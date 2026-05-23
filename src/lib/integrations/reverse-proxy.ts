/**
 * Generic reverse proxy used to expose integration dashboards (LibreNMS, Wazuh,
 * Graylog, …) from DA-IPAM's own origin.
 *
 * Solves two problems that prevent the dashboards from loading in an iframe:
 *   1. The upstream serves a self-signed cert that the browser hasn't accepted.
 *      We connect server-side with `rejectUnauthorized: false`, so the browser
 *      only ever sees DA-IPAM's (trusted) cert.
 *   2. The upstream sends `X-Frame-Options: DENY` / `Content-Security-Policy:
 *      frame-ancestors 'none'` which block embedding.  We strip those response
 *      headers before returning the body.
 *
 * Limitations:
 *   - WebSockets are NOT proxied (Next.js route handlers can't upgrade
 *     connections).  Most dashboard live-tail / SSE features will not work.
 *   - Apps that build absolute URLs from `window.location.origin` (e.g.
 *     OpenSearch Dashboards bootstrap) need `server.basePath` configured on the
 *     upstream to fully function under a sub-path proxy.  Static navigation
 *     still works.
 *   - Auth state lives in cookies set by the upstream; we rewrite `Domain=` and
 *     drop `Secure` so they're stored against DA-IPAM's host.
 */

import * as http from "node:http";
import * as https from "node:https";
import { URL } from "node:url";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

export interface ReverseProxyOptions {
  /** Upstream origin, e.g. `https://da-wazuh.domarc.it`. No trailing slash. */
  upstreamOrigin: string;
  /** Path prefix under DA-IPAM that the proxy is mounted on. Example:
   *  `/api/integrations/proxy/wazuh`. Used to strip the prefix before
   *  forwarding and to rewrite redirects. */
  basePath: string;
  /** When true, accept self-signed / invalid TLS on the upstream. */
  insecureTls: boolean;
  /** Optional extra request headers to inject (auth tokens, etc.). */
  extraRequestHeaders?: Record<string, string>;
  /** Optional list of response header names (lowercase) to drop. Defaults
   *  cover the common iframe-blocking and CORS ones. */
  stripResponseHeaders?: string[];
  /** Timeout for the upstream request, ms. */
  timeoutMs?: number;
  /** When true, leave the basePath prefix in the forwarded path. Required for
   *  upstreams like OpenSearch Dashboards (Wazuh) configured with
   *  `server.basePath` + `server.rewriteBasePath: true`: OSD strips the
   *  prefix itself, the proxy must NOT strip it. Default: false (strip). */
  preserveBasePath?: boolean;
}

const DEFAULT_STRIP_HEADERS = [
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "cross-origin-embedder-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
  // Connection-level / hop-by-hop headers that Node manages itself; passing
  // them through to the browser response can break HTTP/2 (e.g. `connection`).
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
];

/**
 * Build the upstream request URL from the incoming Next.js request and the
 * configured base path.
 */
function buildUpstreamUrl(reqUrl: string, opts: ReverseProxyOptions): URL {
  const incoming = new URL(reqUrl, "http://placeholder.local");
  let path = incoming.pathname;
  // Strip basePath dall'incoming, A MENO che opts.preserveBasePath sia true:
  // upstream tipo OpenSearch Dashboards con rewriteBasePath:true si aspetta
  // di ricevere il prefisso intatto perché lo gestisce internamente.
  if (!opts.preserveBasePath && path.startsWith(opts.basePath)) {
    path = path.slice(opts.basePath.length);
  }
  if (!path.startsWith("/")) path = "/" + path;
  // If the user navigated to the bare proxy root, normalise to "/" so the
  // upstream serves its index.
  if (path === "" || path === "/") path = "/";
  const upstream = new URL(opts.upstreamOrigin);
  const out = new URL(path + incoming.search, `${upstream.protocol}//${upstream.host}`);
  return out;
}

/** Rewrite a single Set-Cookie header so the browser stores it against the
 *  current host, not the upstream's. */
function rewriteSetCookie(cookie: string): string {
  return cookie
    // strip Domain=...; (we want browser default = current host)
    .replace(/;\s*Domain=[^;]*/gi, "")
    // SameSite=None requires Secure; rather than dropping Secure we leave it
    // up to the browser/origin combo, but if we proxied an http origin we'd
    // need to strip it. Leave as-is for now.
    .trim();
}

/** Rewrite a Location header so it stays inside the proxy when the upstream
 *  redirects to its own absolute URL. */
function rewriteLocation(loc: string, opts: ReverseProxyOptions): string {
  try {
    const up = new URL(opts.upstreamOrigin);
    const parsed = new URL(loc, opts.upstreamOrigin);
    if (parsed.host === up.host) {
      return opts.basePath + parsed.pathname + parsed.search + parsed.hash;
    }
    return loc;
  } catch {
    return loc;
  }
}

/**
 * Forward `req` to the upstream and return a Next.js-compatible Response.
 */
export async function proxyRequest(
  req: Request,
  opts: ReverseProxyOptions,
): Promise<Response> {
  const target = buildUpstreamUrl(req.url, opts);
  const isHttps = target.protocol === "https:";
  const client = isHttps ? https : http;

  // Headers to forward.  We drop `host` (will be set to upstream automatically
  // by node's http module via `hostname`+`port`), and a few that Node manages.
  const outHeaders: Record<string, string | string[]> = {};
  req.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === "host" || k === "connection" || k === "content-length") return;
    outHeaders[k] = value;
  });
  // Rewrite Referer/Origin to look like an upstream-internal request so apps
  // that compare these don't reject the call.
  if (outHeaders.referer) {
    outHeaders.referer = String(outHeaders.referer).replace(
      /^[^?#]*?\/\/[^/]+/,
      `${target.protocol}//${target.host}`,
    );
  }
  if (outHeaders.origin) {
    outHeaders.origin = `${target.protocol}//${target.host}`;
  }
  // Forziamo `identity` perché il rewrite HTML opera su testo plain. Se
  // l'upstream ci risponde con gzip/br/deflate, il toString("utf8") sui
  // byte compressi produce gibberish: il regex non matcha nulla e il
  // browser tenta di decomprimere garbage → "Content Encoding Error".
  // Strippiamo qualsiasi `accept-encoding` ereditato dal client e ne
  // mettiamo uno esplicito `identity`. Il prezzo (banda) è accettabile:
  // il proxy serve solo navigazione interna dello staff.
  outHeaders["accept-encoding"] = "identity";

  if (opts.extraRequestHeaders) {
    for (const [k, v] of Object.entries(opts.extraRequestHeaders)) {
      outHeaders[k.toLowerCase()] = v;
    }
  }

  const agentOpts = isHttps
    ? { rejectUnauthorized: !opts.insecureTls, keepAlive: true }
    : { keepAlive: true };
  const agent = isHttps
    ? new https.Agent(agentOpts as https.AgentOptions)
    : new http.Agent(agentOpts as http.AgentOptions);

  const requestOptions: http.RequestOptions = {
    method: req.method,
    hostname: target.hostname,
    port: target.port || (isHttps ? 443 : 80),
    path: target.pathname + target.search,
    headers: outHeaders,
    agent,
    timeout: opts.timeoutMs ?? 30_000,
  };

  // Body: only present for non-GET/HEAD requests.
  const hasBody = !["GET", "HEAD"].includes(req.method.toUpperCase());

  const upstreamPromise = new Promise<http.IncomingMessage>((resolve, reject) => {
    const upstreamReq = client.request(requestOptions, (res) => resolve(res));
    upstreamReq.on("error", reject);
    upstreamReq.on("timeout", () => {
      upstreamReq.destroy(new Error("Upstream timeout"));
    });
    if (hasBody && req.body) {
      // Convert Web ReadableStream → Node Readable
      const nodeReadable = Readable.fromWeb(req.body as unknown as WebReadableStream);
      nodeReadable.pipe(upstreamReq);
      nodeReadable.on("error", (err) => upstreamReq.destroy(err));
    } else {
      upstreamReq.end();
    }
  });

  let upstreamRes: http.IncomingMessage;
  try {
    upstreamRes = await upstreamPromise;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      `Reverse proxy error contacting ${target.host}: ${msg}`,
      { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  const status = upstreamRes.statusCode ?? 502;
  const strip = new Set([
    ...DEFAULT_STRIP_HEADERS,
    ...(opts.stripResponseHeaders ?? []).map((h) => h.toLowerCase()),
  ]);

  const respHeaders = new Headers();
  for (const [name, value] of Object.entries(upstreamRes.headers)) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();
    if (strip.has(lower)) continue;

    if (lower === "set-cookie") {
      const cookies = Array.isArray(value) ? value : [value];
      for (const c of cookies) {
        respHeaders.append("set-cookie", rewriteSetCookie(c));
      }
      continue;
    }

    if (lower === "location") {
      respHeaders.set("location", rewriteLocation(String(value), opts));
      continue;
    }

    if (Array.isArray(value)) {
      for (const v of value) respHeaders.append(name, v);
    } else {
      respHeaders.set(name, String(value));
    }
  }

  // Stream body back.  `Readable.toWeb` returns a ReadableStream Next.js can
  // consume.  For HEAD / 204 / 304 there's nothing to stream.
  const noBody = req.method.toUpperCase() === "HEAD" || status === 204 || status === 304;
  if (noBody) {
    return new Response(null, { status, headers: respHeaders });
  }

  // HTML rewrite: asset/link assoluti `/...` vengono prefissati con `basePath`
  // così il browser li chiede al proxy invece che alla root di DA-IPAM. Senza
  // questo il dashboard upstream (Wazuh OpenSearch Dashboards / LibreNMS) emette
  // path tipo `/ui/logos/...`, `/bootstrap.js`, `/app/login` che il browser cerca
  // su DA-IPAM origin → 404 a cascata.
  const contentType = respHeaders.get("content-type") ?? "";
  const isHtml = /\b(text\/html|application\/xhtml\+xml)\b/i.test(contentType);
  if (isHtml) {
    const chunks: Buffer[] = [];
    for await (const chunk of upstreamRes) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    const rewritten = rewriteHtmlAbsolutePaths(raw, opts.basePath, opts.upstreamOrigin);
    // Strippiamo `content-encoding` perché abbiamo riscritto plain text;
    // se l'upstream avesse ignorato `Accept-Encoding: identity` lasciare
    // l'header farebbe tentare al browser una decompressione su garbage.
    respHeaders.delete("content-length");
    respHeaders.delete("content-encoding");
    return new Response(rewritten, { status, headers: respHeaders });
  }

  const body = Readable.toWeb(upstreamRes) as unknown as ReadableStream;
  return new Response(body, { status, headers: respHeaders });
}

/**
 * Riscrive nei body HTML/XHTML:
 *   - path assoluti `/...` → prefissati con `basePath`
 *   - URL assoluti `http(s)://upstreamHost(:port)/...` → trasformati in path
 *     relativi sotto `basePath` (eliminando scheme+host) per evitare mixed
 *     content blocked + asset 404 quando l'upstream è raggiungibile solo
 *     dalla LAN del server (es. LibreNMS in container Docker su 192.168.x).
 */
function rewriteHtmlAbsolutePaths(html: string, basePath: string, upstreamOrigin: string): string {
  const prefix = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  const shouldRewrite = (path: string): boolean => !(path.startsWith(prefix + "/") || path === prefix);

  // ─── PASS 0: URL assoluti che puntano all'upstream → path-only sul proxy ──
  // Estraiamo host+porta dell'upstream da upstreamOrigin (es. http://192.168.4.8:8090
  // → upstreamHostPattern "192\\.168\\.4\\.8:8090").
  let upstreamHost = "";
  try {
    const u = new URL(upstreamOrigin);
    upstreamHost = u.host; // include porta se presente
  } catch { /* upstreamOrigin malformato: skip pass 0 */ }

  let out = html;
  if (upstreamHost) {
    // Match URL completo http(s)://<host>[:port]<path?query?fragment?>
    // dentro attributi DOM o stringhe contenute in quote singole/doppie.
    const escHost = upstreamHost.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const upstreamUrlRe = new RegExp(
      `(["'(])https?:\\/\\/${escHost}([\\/"'? )#]|$)`,
      "gi",
    );
    out = out.replace(upstreamUrlRe, (_m, lead: string, follow: string) => {
      // lead è il delimitatore prima (`"`, `'`, `(`); follow è il carattere
      // immediatamente dopo l'host (`/`, `"`, `'`, ` `, `?`, `#`, `)`).
      // Sostituiamo con `<lead><prefix><follow>` per ottenere `"<prefix>/..."`.
      // Caso `follow=""` (fine stringa o virgola): aggiungiamo solo prefix.
      return `${lead}${prefix}${follow}`;
    });
  }

  // ─── PASS 1: attributi DOM con path assoluto ──────────────────────────────
  out = out.replace(
    /(\s(?:src|href|action|formaction|poster|manifest|cite|ping|data-href|data-src)\s*=\s*)(["'])(\/)(?!\/)([^"']*)\2/gi,
    (_m, attr: string, quote: string, _slash: string, rest: string) => {
      const path = "/" + rest;
      if (!shouldRewrite(path)) return `${attr}${quote}${path}${quote}`;
      return `${attr}${quote}${prefix}${path}${quote}`;
    },
  );

  // ─── PASS 2: <base href="/..."> ───────────────────────────────────────────
  out = out.replace(
    /(<base\s+href=)(["'])(\/)(?!\/)([^"']*)\2/gi,
    (_m, attr: string, quote: string, _slash: string, rest: string) => {
      const path = "/" + rest;
      if (!shouldRewrite(path)) return `${attr}${quote}${path}${quote}`;
      return `${attr}${quote}${prefix}${path}${quote}`;
    },
  );

  // ─── PASS 3: <meta http-equiv="refresh" content="0;url=/..."> ─────────────
  out = out.replace(
    /(<meta\s+http-equiv=["']refresh["']\s+content=["'][^"']*url=)(\/)(?!\/)([^"']*)/gi,
    (_m, head: string, _slash: string, rest: string) => {
      const path = "/" + rest;
      if (!shouldRewrite(path)) return `${head}${path}`;
      return `${head}${prefix}${path}`;
    },
  );

  // ─── PASS 4: url(/...) in CSS inline ──────────────────────────────────────
  out = out.replace(
    /url\(\s*(["']?)(\/)(?!\/)([^"')]*)\1\s*\)/g,
    (_m, quote: string, _slash: string, rest: string) => {
      const path = "/" + rest;
      if (!shouldRewrite(path)) return `url(${quote}${path}${quote})`;
      return `url(${quote}${prefix}${path}${quote})`;
    },
  );

  return out;
}
