/**
 * Risoluzione URL integrazioni con accesso DB — solo server-side.
 * Per helper client-safe vedi public-url.ts.
 */

import { getSetting, setSetting } from "../db-hub";
import { listCredentials } from "../credentials-vault";
import type { IntegrationComponent } from "./types";
import {
  DEFAULT_UI_PORTS,
  PORTE_UI_APPLIANCE,
  deriveDefaultIntegrationUiUrl,
  isInternalIntegrationUrl,
  librenmsDevicePath,
  publicHostFromEnv,
} from "./public-url";
import { deriveEdgeUiBase } from "./edge-ui-url";

interface VoceVault {
  kind: string;
  label: string;
  url: string | null;
}

function vociVault(): VoceVault[] {
  try {
    return listCredentials() as VoceVault[];
  } catch {
    return [];
  }
}

/**
 * URL per il browser preso dalle voci del vault (la Launchpad) di un tipo: solo
 * http(s), mai interni. Preferenza nell'ordine delle etichette date; senza
 * corrispondenza, la prima voce valida del tipo. Prima si accettava solo
 * l'etichetta «dashboard», e con «Wazuh SIEM» (l'etichetta dell'installatore)
 * il viewer ripiegava sull'host dell'API (passo 4b, 16/10).
 */
export function urlDalVault(
  kind: string,
  etichettePreferite: string[],
  scarta: (url: string) => boolean = () => false,
  voci: VoceVault[] = vociVault(),
): string | null {
  const valide = voci.filter(
    (c): c is VoceVault & { url: string } =>
      c.kind === kind &&
      !!c.url &&
      /^https?:\/\//.test(c.url) &&
      !isInternalIntegrationUrl(c.url) &&
      !scarta(c.url),
  );
  for (const et of etichettePreferite) {
    const m = valide.find((c) => c.label.toLowerCase().includes(et.toLowerCase()));
    if (m) return m.url.replace(/\/+$/, "");
  }
  return valide[0]?.url.replace(/\/+$/, "") ?? null;
}

function dashboardFromVault(kind: IntegrationComponent): string | null {
  return urlDalVault(kind, ["dashboard", kind]);
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

/** L'URL è quello dell'API del manager Wazuh (55000), non della dashboard. */
function eApiWazuh(url: string): boolean {
  try {
    return new URL(url).port === "55000";
  } catch {
    return false;
  }
}

/**
 * URL per il browser della dashboard Wazuh: la stessa fonte per Launchpad e
 * viewer (passo 4b, 16/10). Ordine: voce del vault (prima «Dashboard», poi
 * «Wazuh», mai l'API :55000), poi l'host pubblico dell'appliance sulla 8443
 * (nginx). Stringa vuota = nessun URL raggiungibile dal browser.
 */
export function resolveWazuhBrowserUrl(): string {
  const vault = urlDalVault("wazuh", ["dashboard", "wazuh"], eApiWazuh);
  if (vault) return vault;
  const pubHost = publicHostFromEnv();
  return pubHost ? `https://${pubHost}:${PORTE_UI_APPLIANCE.wazuh}` : "";
}

/**
 * URL per il browser dell'interfaccia dello Scanner-Edge.
 *
 * La 6443 la serve nginx sul nodo di DA-IPAM, in consolidated come in full: non
 * è l'host di `base_url` (in consolidated 127.0.0.1, in full l'IP dell'edge,
 * dove la 6443 non c'è). Ordine (passo 4b, 16/10):
 *  1. voce «edge» del vault, scritta dall'installatore col nodo che serve la 6443;
 *  2. host pubblico dell'appliance sulla 6443;
 *  3. ripiego storico, solo per un edge fuori dall'appliance: host di `base_url`.
 */
export function resolveEdgeBrowserUrl(baseUrl: string | null | undefined): string | null {
  const vault = urlDalVault("edge", []);
  if (vault) return vault;
  const pubHost = publicHostFromEnv();
  if (pubHost) return `https://${pubHost}:${PORTE_UI_APPLIANCE.edge}`;
  return baseUrl ? deriveEdgeUiBase(baseUrl) : null;
}
