/**
 * URL browser-reachable per integrazioni — helper client-safe (no DB/fs).
 * Funzioni server con DB: public-url-server.ts
 */

import type { IntegrationComponent } from "./types";

/**
 * Porte con cui nginx dell'appliance pubblica le interfacce dei moduli sul nodo
 * di DA-IPAM (Deploy-Appliance `lib/urls.sh`, `lib/dashboard.sh`): un'unica
 * tabella per tutti i ripieghi. Graylog è sulla 9443 (prima si ripiegava sulla
 * 9000, dove nginx non ascolta: passo 4b, 16/10).
 */
export const PORTE_UI_APPLIANCE = {
  edge: 6443,
  librenms: 7443,
  wazuh: 8443,
  graylog: 9443,
  meshcentral: 4443,
} as const;

export const DEFAULT_UI_PORTS: Partial<Record<IntegrationComponent, number>> = {
  librenms: PORTE_UI_APPLIANCE.librenms,
  graylog: PORTE_UI_APPLIANCE.graylog,
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
    // 172.17–172.31: reti Docker/appliance. 172.16.x spesso è LAN cliente (es. cliente A).
    const pubHost = publicHostFromEnv()?.toLowerCase();
    if (pubHost && host === pubHost) return false;
    if (/^172\.(1[7-9]|2\d|3[01])\./.test(host)) return true;
    return false;
  } catch {
    return false;
  }
}

const ENV_HOST_PUBBLICO = [
  "LIBRENMS_PUBLIC_HOST",
  "DA_INVENT_PUBLIC_HOST",
  "APPLIANCE_PUBLIC_HOST",
  "APPLIANCE_LAN_IP",
  "APPLIANCE_HOST",
] as const;

function pulisciHost(raw: string | undefined): string | null {
  const v = raw?.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "") ?? "";
  if (!v || v === "127.0.0.1" || v === "localhost") return null;
  return v;
}

/** Host pubblico dell'appliance (variabili d'ambiente), il primo dichiarato. */
export function publicHostFromEnv(): string | null {
  for (const nome of ENV_HOST_PUBBLICO) {
    const h = pulisciHost(process.env[nome]);
    if (h) return h;
  }
  return null;
}

/**
 * Tutti i nomi (o IP) con cui l'appliance si dichiara raggiungibile, senza porta
 * e senza doppioni. Servono a dire «questo URL è servito da nginx dell'appliance».
 */
export function applianceHostPubblici(): string[] {
  const out = new Set<string>();
  for (const nome of ENV_HOST_PUBBLICO) {
    const h = pulisciHost(process.env[nome]);
    if (!h) continue;
    try {
      out.add(new URL(`https://${h}`).hostname.toLowerCase());
    } catch {
      /* valore non valido: ignorato */
    }
  }
  return [...out];
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
