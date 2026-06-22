/**
 * URL browser-reachable per integrazioni — helper client-safe (no DB/fs).
 * Funzioni server con DB: public-url-server.ts
 */

import type { IntegrationComponent } from "./types";

const DEFAULT_UI_PORTS: Partial<Record<IntegrationComponent, number>> = {
  librenms: 7443,
  graylog: 9000,
  loki: 3100,
};

/** Hostname/API URL non raggiungibile dal browser dell'operatore. */
export function isInternalIntegrationUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) return false;
  try {
    const u = new URL(url.trim());
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") {
      return true;
    }
    if (host.endsWith(".internal")) return true;
    if (/^(librenms|graylog|loki|host\.docker\.internal|appliance-)/i.test(host)) {
      return true;
    }
    if (/^10\.255\.255\./.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
    return false;
  } catch {
    return false;
  }
}

function publicHostFromEnv(): string | null {
  const raw =
    process.env.LIBRENMS_PUBLIC_HOST?.trim() ||
    process.env.DA_INVENT_PUBLIC_HOST?.trim() ||
    process.env.APPLIANCE_PUBLIC_HOST?.trim() ||
    process.env.APPLIANCE_LAN_IP?.trim() ||
    process.env.APPLIANCE_HOST?.trim() ||
    "";
  if (!raw || raw === "127.0.0.1" || raw === "localhost") return null;
  return raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

/**
 * URL dashboard di default (nginx LAN / env) quando l'API è loopback o Docker-internal.
 */
export function deriveDefaultIntegrationUiUrl(kind: IntegrationComponent): string | null {
  const envUi =
    kind === "librenms"
      ? process.env.LIBRENMS_UI_URL?.trim()
      : kind === "graylog"
        ? process.env.GRAYLOG_UI_URL?.trim()
        : process.env.LOKI_UI_URL?.trim();
  if (envUi) return envUi.replace(/\/+$/, "");

  const pubHost = publicHostFromEnv();
  const port = DEFAULT_UI_PORTS[kind];
  if (pubHost && port) return `https://${pubHost}:${port}`;

  return null;
}

/** Path relativo o assoluto alla pagina device LibreNMS (client-safe, no DB). */
export function librenmsDevicePath(browserBase: string, deviceId: number | string): string {
  const path = `/device/device=${deviceId}/`;
  if (!browserBase) return path;
  const base = browserBase.replace(/\/+$/, "");
  return `${base}${path}`;
}
