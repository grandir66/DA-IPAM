/**
 * Risoluzione URL pubblico hub (ingest client, script install).
 * Evita origin errati tipo https://0.0.0.0:3001 quando l'app ascolta in bind-all.
 */
import { getSetting } from "@/lib/db-hub";

export type PublicHubUrlSource =
  | "da_ipam_public_url"
  | "public_hub_url"
  | "tailnet_hostname"
  | "env_host"
  | "nextauth_url"
  | "forwarded"
  | "host_header"
  | "request_url"
  | "none";

const BAD_HOSTS = new Set(["0.0.0.0", "127.0.0.1", "localhost", "[::1]", "::1"]);

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function isUnusablePublicHost(host: string | null | undefined): boolean {
  if (!host?.trim()) return true;
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (BAD_HOSTS.has(h)) return true;
  if (h.endsWith(".internal")) return true;
  if (/^host\.docker\.internal$/i.test(h)) return true;
  return false;
}

function publicHostFromEnv(): string | null {
  const raw =
    process.env.DA_INVENT_PUBLIC_HOST?.trim() ||
    process.env.APPLIANCE_PUBLIC_HOST?.trim() ||
    process.env.APPLIANCE_LAN_IP?.trim() ||
    process.env.APPLIANCE_HOST?.trim() ||
    "";
  if (!raw) return null;
  const host = raw.replace(/^https?:\/\//i, "").replace(/\/+$/, "").split("/")[0]?.split(":")[0] ?? "";
  if (isUnusablePublicHost(host)) return null;
  return host;
}

function originFromHostPort(hostHeader: string, proto = "https"): string | null {
  const host = hostHeader.trim();
  if (!host || isUnusablePublicHost(host.split(":")[0])) return null;

  if (host.includes(":") && !host.startsWith("[")) {
    const [h, port] = host.split(":");
    if (isUnusablePublicHost(h)) return null;
    if (proto === "https" && port === "443") return `https://${h}`;
    if (proto === "http" && port === "80") return `http://${h}`;
    return `${proto}://${host}`;
  }

  if (isUnusablePublicHost(host)) return null;
  return `${proto}://${host}`;
}

function sanitizeRequestOrigin(origin: string): string | null {
  try {
    const u = new URL(origin);
    if (isUnusablePublicHost(u.hostname)) return null;

    // Bind-all dev/proxy interno :3001 → URL browser su HTTPS standard
    if (u.port === "3001" && /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) {
      return `https://${u.hostname}`;
    }
    if (u.port === "3001" && !isUnusablePublicHost(u.hostname) && u.hostname !== "localhost") {
      const envHost = publicHostFromEnv();
      if (envHost) return `https://${envHost}`;
    }

    if ((u.protocol === "https:" && u.port === "443") || (u.protocol === "http:" && u.port === "80")) {
      return `${u.protocol}//${u.hostname}`;
    }
    if (u.port) return `${u.protocol}//${u.host}`;
    return `${u.protocol}//${u.hostname}`;
  } catch {
    return null;
  }
}

/**
 * Origin pubblico del hub (schema + host[:port]) per link/script client.
 */
export function resolvePublicHubOrigin(request: Request): {
  origin: string;
  source: PublicHubUrlSource;
} {
  const daIpam = process.env.DA_IPAM_PUBLIC_URL?.trim();
  if (daIpam) {
    return { origin: stripTrailingSlash(daIpam), source: "da_ipam_public_url" };
  }

  const publicHubUrl = (getSetting("public_hub_url") ?? "").trim();
  if (publicHubUrl) {
    return { origin: stripTrailingSlash(publicHubUrl), source: "public_hub_url" };
  }

  const tailnet = (getSetting("hub_tailnet_hostname") ?? "").trim();
  if (tailnet) {
    const host = tailnet.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    return { origin: `https://${host}`, source: "tailnet_hostname" };
  }

  const envHost = publicHostFromEnv();
  if (envHost) {
    return { origin: `https://${envHost}`, source: "env_host" };
  }

  const nextAuth = process.env.NEXTAUTH_URL?.trim();
  if (nextAuth) {
    const o = sanitizeRequestOrigin(nextAuth);
    if (o) return { origin: o, source: "nextauth_url" };
  }

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "https";
  if (forwardedHost) {
    const o = originFromHostPort(forwardedHost, forwardedProto);
    if (o) return { origin: o, source: "forwarded" };
  }

  const hostHeader = request.headers.get("host")?.trim();
  if (hostHeader) {
    const proto =
      request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
      (hostHeader.includes(":443") ? "https" : "https");
    const o = originFromHostPort(hostHeader, proto);
    if (o) return { origin: o, source: "host_header" };
  }

  try {
    const o = sanitizeRequestOrigin(new URL(request.url).origin);
    if (o) return { origin: o, source: "request_url" };
  } catch {
    /* ignore */
  }

  return { origin: "", source: "none" };
}

/** URL POST ingest per GLPI Agent push. */
export function publicIngestUrl(request: Request): string {
  const { origin } = resolvePublicHubOrigin(request);
  if (origin) return `${origin}/api/inventory/ingest`;
  return "/api/inventory/ingest";
}

/** Origin hub (senza path) per script curl/irm. */
export function publicHubOrigin(request: Request): string {
  return resolvePublicHubOrigin(request).origin;
}

export function publicHubUrlSource(request: Request): PublicHubUrlSource {
  return resolvePublicHubOrigin(request).source;
}
