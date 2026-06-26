/**
 * Risoluzione URL integrazioni con accesso DB — solo server-side.
 * Per helper client-safe vedi public-url.ts.
 */

import { getSetting, setSetting } from "../db-hub";
import { listCredentials } from "../credentials-vault";
import type { IntegrationComponent } from "./types";
import {
  deriveDefaultIntegrationUiUrl,
  isInternalIntegrationUrl,
  librenmsDevicePath,
} from "./public-url";

const DEFAULT_UI_PORTS: Partial<Record<IntegrationComponent, number>> = {
  librenms: 7443,
  graylog: 9000,
  loki: 3100,
};

function dashboardFromVault(kind: IntegrationComponent): string | null {
  try {
    const creds = listCredentials();
    const match = creds.find(
      (c) =>
        c.kind === kind &&
        c.url &&
        /^https?:\/\//.test(c.url) &&
        !isInternalIntegrationUrl(c.url) &&
        /dashboard/i.test(c.label),
    );
    return match?.url?.replace(/\/+$/, "") ?? null;
  } catch {
    return null;
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
 * Backfill idempotente: se API interna e ui_url vuoto, persiste URL browser derivato.
 */
export function ensureIntegrationUiUrl(kind: IntegrationComponent, apiUrl?: string | null): void {
  const api = (apiUrl ?? getSetting(`integration_${kind}_url`) ?? "").trim();
  if (!api || !isInternalIntegrationUrl(api)) return;

  const existing = getSetting(`integration_${kind}_ui_url`)?.trim();
  if (existing && !isInternalIntegrationUrl(existing)) return;

  const derived = deriveDefaultIntegrationUiUrl(kind);
  if (!derived) return;

  setSetting(`integration_${kind}_ui_url`, derived);
}

/** Backfill tutte le integrazioni hub (librenms/graylog/loki). */
export function backfillAllIntegrationUiUrls(): void {
  (["librenms", "graylog", "loki"] as const).forEach((k) => ensureIntegrationUiUrl(k));
}

/**
 * Base URL da usare nei link browser (Apri dashboard, device LibreNMS, …).
 * Preferisce sempre l'URL LAN diretto (:7443 nginx) — il proxy same-origin
 * rompe CSS/asset LibreNMS in appliance consolidated (2026-06-22).
 */
export function resolveIntegrationBrowserUrl(
  kind: IntegrationComponent,
  apiUrl?: string | null,
): string {
  const explicit = getSetting(`integration_${kind}_ui_url`)?.trim();
  if (explicit && !isInternalIntegrationUrl(explicit)) {
    return explicit.replace(/\/+$/, "");
  }

  const envUi =
    kind === "librenms"
      ? process.env.LIBRENMS_UI_URL?.trim()
      : kind === "graylog"
        ? process.env.GRAYLOG_UI_URL?.trim()
        : process.env.LOKI_UI_URL?.trim();
  if (envUi) return envUi.replace(/\/+$/, "");

  const vault = dashboardFromVault(kind);
  if (vault) return vault;

  const pubHost = publicHostFromEnv();
  const port = DEFAULT_UI_PORTS[kind];
  if (pubHost && port) {
    return `https://${pubHost}:${port}`;
  }

  const derived = deriveDefaultIntegrationUiUrl(kind);
  if (derived && !isInternalIntegrationUrl(derived)) {
    return derived.replace(/\/+$/, "");
  }

  const api = (apiUrl ?? getSetting(`integration_${kind}_url`) ?? "").trim();
  if (api && !isInternalIntegrationUrl(api)) {
    return api.replace(/\/+$/, "");
  }

  return "";
}

export function librenmsDeviceUrl(deviceId: number | string, apiUrl?: string | null): string {
  return librenmsDevicePath(resolveIntegrationBrowserUrl("librenms", apiUrl), deviceId);
}
