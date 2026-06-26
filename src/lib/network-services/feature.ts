/**
 * Network Services feature module — install / config / uninstall.
 *
 * Pattern mutuato dal Patch Management (vedi src/lib/patch/feature.ts):
 * - hub.tenant_features riga con feature_key='network_services'
 * - config_json (TEXT) cifrato AES-GCM contiene {apiUrl, apiToken}
 * - Quando la feature è OFF, getNetServicesConfig() ritorna enabled=false
 *   e la UI /network-services mostra il setup wizard.
 *
 * IMPORTANTE: il token è secret + va cifrato at-rest. Riusiamo encrypt() di
 * src/lib/crypto.ts (AES-GCM con ENCRYPTION_KEY env).
 */
import { encrypt, safeDecrypt } from "@/lib/crypto";
import { getHubDb } from "@/lib/db-hub";
import {
  getFeatureStatus,
  invalidateFeatureCache,
  isFeatureEnabled,
} from "@/lib/patch/feature";

export const NET_SERVICES_FEATURE_KEY = "network_services";

export interface NetServicesStoredConfig {
  apiUrl: string;
  apiToken: string;
}

export interface NetServicesConfigState {
  enabled: boolean;
  configured: boolean;
  apiUrl: string;
  apiToken: string;
  enabledAt: string | null;
  enabledBy: number | null;
}

/**
 * Shortcut: feature installata per il tenant?
 */
export async function isNetServicesEnabled(tenantCode: string): Promise<boolean> {
  return isFeatureEnabled(tenantCode, NET_SERVICES_FEATURE_KEY);
}

/**
 * Ritorna lo stato completo della feature + config decifrata (se presente).
 * Quando enabled=false → configured=false e api fields vuoti.
 */
export async function getNetServicesState(
  tenantCode: string,
): Promise<NetServicesConfigState> {
  const status = await getFeatureStatus(tenantCode, NET_SERVICES_FEATURE_KEY);

  // Backward-compat: se feature non in DB ma env var presenti → enabled
  // (così cluster pre-existing continua a funzionare durante la transizione).
  if (!status.enabled) {
    const envUrl = (process.env.NET_SERVICES_API_URL ?? "").trim();
    const envTok = (process.env.NET_SERVICES_API_TOKEN ?? "").trim();
    if (envUrl && envTok) {
      return {
        enabled: true,
        configured: true,
        apiUrl: envUrl,
        apiToken: envTok,
        enabledAt: null,
        enabledBy: null,
      };
    }
    return {
      enabled: false,
      configured: false,
      apiUrl: "",
      apiToken: "",
      enabledAt: null,
      enabledBy: null,
    };
  }

  if (!status.configJson) {
    return {
      enabled: true,
      configured: false,
      apiUrl: "",
      apiToken: "",
      enabledAt: status.enabledAt,
      enabledBy: status.enabledBy,
    };
  }

  try {
    const parsed = JSON.parse(status.configJson) as {
      apiUrl?: string;
      apiTokenEnc?: string;
    };
    const apiUrl = (parsed.apiUrl ?? "").trim();
    const apiTokenPlain = parsed.apiTokenEnc
      ? safeDecrypt(parsed.apiTokenEnc) ?? ""
      : "";
    return {
      enabled: true,
      configured: Boolean(apiUrl && apiTokenPlain),
      apiUrl,
      apiToken: apiTokenPlain,
      enabledAt: status.enabledAt,
      enabledBy: status.enabledBy,
    };
  } catch {
    return {
      enabled: true,
      configured: false,
      apiUrl: "",
      apiToken: "",
      enabledAt: status.enabledAt,
      enabledBy: status.enabledBy,
    };
  }
}

/**
 * Install + configura la feature in un solo step.
 * Cifra il token e salva in tenant_features.config_json.
 * Idempotente (UPSERT).
 */
export function installNetServices(
  tenantCode: string,
  userId: number | null,
  config: NetServicesStoredConfig,
): void {
  const cleanUrl = config.apiUrl.trim();
  const cleanToken = config.apiToken.trim();
  if (!cleanUrl || !cleanToken) {
    throw new Error("apiUrl e apiToken non possono essere vuoti");
  }
  const configJson = JSON.stringify({
    apiUrl: cleanUrl,
    apiTokenEnc: encrypt(cleanToken),
  });
  const now = new Date().toISOString();
  getHubDb()
    .prepare(
      `INSERT INTO tenant_features (tenant_code, feature_key, enabled, enabled_at, enabled_by, config_json)
       VALUES (?, ?, 1, ?, ?, ?)
       ON CONFLICT(tenant_code, feature_key)
       DO UPDATE SET
         enabled = 1,
         enabled_at = excluded.enabled_at,
         enabled_by = excluded.enabled_by,
         config_json = excluded.config_json`,
    )
    .run(tenantCode, NET_SERVICES_FEATURE_KEY, now, userId, configJson);
  invalidateFeatureCache(tenantCode, NET_SERVICES_FEATURE_KEY);
}

/**
 * Disabilita la feature (la riga resta per audit). Non rimuove le forward-zones
 * / adblock rules / DNS zones già configurate sul bridge — quello è responsabilità
 * del bridge VM 192.168.99.52 e va gestito separatamente.
 */
export function uninstallNetServices(tenantCode: string): void {
  getHubDb()
    .prepare(
      `UPDATE tenant_features
          SET enabled = 0,
              config_json = NULL
        WHERE tenant_code = ? AND feature_key = ?`,
    )
    .run(tenantCode, NET_SERVICES_FEATURE_KEY);
  invalidateFeatureCache(tenantCode, NET_SERVICES_FEATURE_KEY);
}
