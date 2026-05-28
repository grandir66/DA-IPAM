/**
 * Feature flag system per moduli opzionali (es. patch_management).
 *
 * Sorgente di verità: tabella hub `tenant_features` (vedi db-hub-schema.ts).
 * Cache in-memory con TTL 60s per evitare di tartassare il DB ad ogni guard:
 * il flag cambia solo in risposta a install/uninstall espliciti, ma viene
 * comunque invalidato esplicitamente quando questo accade.
 *
 * IMPORTANTE: questo modulo NON deve causare effetti collaterali sul tenant DB.
 * Le migration delle tabelle modulo vivono in src/lib/patch/schema.ts (F1).
 */
import { getHubDb } from "@/lib/db-hub";

const TTL_MS = 60_000;

interface FeatureCacheEntry {
  value: boolean;
  expiresAt: number;
}

const cache = new Map<string, FeatureCacheEntry>();

function cacheKey(tenantCode: string, featureKey: string): string {
  return `${tenantCode}::${featureKey}`;
}

/**
 * Shortcut per il modulo patch management.
 * Equivalente a isFeatureEnabled(tenantCode, 'patch_management').
 */
export async function isPatchEnabled(tenantCode: string): Promise<boolean> {
  return isFeatureEnabled(tenantCode, "patch_management");
}

/**
 * Ritorna true se il flag (tenantCode, featureKey) esiste in hub con enabled=1.
 * Default: false (nessuna riga in tabella = feature non installata).
 */
export async function isFeatureEnabled(
  tenantCode: string,
  featureKey: string
): Promise<boolean> {
  if (!tenantCode || !featureKey) return false;
  const key = cacheKey(tenantCode, featureKey);
  const cached = cache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const row = getHubDb()
    .prepare(
      "SELECT enabled FROM tenant_features WHERE tenant_code = ? AND feature_key = ?"
    )
    .get(tenantCode, featureKey) as { enabled: number } | undefined;

  const enabled = row?.enabled === 1;
  cache.set(key, { value: enabled, expiresAt: now + TTL_MS });
  return enabled;
}

/**
 * Invalida la cache per una coppia (tenantCode, featureKey).
 * Da chiamare IMMEDIATAMENTE dopo ogni install/uninstall.
 */
export function invalidateFeatureCache(
  tenantCode: string,
  featureKey: string
): void {
  cache.delete(cacheKey(tenantCode, featureKey));
}

/**
 * Pulisce l'intera cache (utility per test / restart manuali).
 */
export function clearFeatureCache(): void {
  cache.clear();
}

export interface FeatureRow {
  tenantCode: string;
  featureKey: string;
  enabled: boolean;
  enabledAt: string | null;
  enabledBy: number | null;
  configJson: string | null;
}

/**
 * Ritorna tutte le feature note per il tenant (enabled o disabled esplicitamente).
 * NB: se una feature non è mai stata toccata per il tenant, NON è in questa lista.
 * Per gli stati "non installato" la UI deve mostrarli come default OFF.
 */
export async function getInstalledFeatures(
  tenantCode: string
): Promise<FeatureRow[]> {
  if (!tenantCode) return [];
  const rows = getHubDb()
    .prepare(
      `SELECT tenant_code, feature_key, enabled, enabled_at, enabled_by, config_json
         FROM tenant_features
        WHERE tenant_code = ?
        ORDER BY feature_key`
    )
    .all(tenantCode) as Array<{
      tenant_code: string;
      feature_key: string;
      enabled: number;
      enabled_at: string | null;
      enabled_by: number | null;
      config_json: string | null;
    }>;
  return rows.map((r) => ({
    tenantCode: r.tenant_code,
    featureKey: r.feature_key,
    enabled: r.enabled === 1,
    enabledAt: r.enabled_at,
    enabledBy: r.enabled_by,
    configJson: r.config_json,
  }));
}

/**
 * Ritorna lo stato di una singola feature (anche quando non è mai stata installata).
 * Utile per la pagina /settings/features per mostrare "NON INSTALLATO" come default.
 */
export async function getFeatureStatus(
  tenantCode: string,
  featureKey: string
): Promise<FeatureRow> {
  const row = getHubDb()
    .prepare(
      `SELECT tenant_code, feature_key, enabled, enabled_at, enabled_by, config_json
         FROM tenant_features
        WHERE tenant_code = ? AND feature_key = ?`
    )
    .get(tenantCode, featureKey) as
      | {
          tenant_code: string;
          feature_key: string;
          enabled: number;
          enabled_at: string | null;
          enabled_by: number | null;
          config_json: string | null;
        }
      | undefined;
  if (!row) {
    return {
      tenantCode,
      featureKey,
      enabled: false,
      enabledAt: null,
      enabledBy: null,
      configJson: null,
    };
  }
  return {
    tenantCode: row.tenant_code,
    featureKey: row.feature_key,
    enabled: row.enabled === 1,
    enabledAt: row.enabled_at,
    enabledBy: row.enabled_by,
    configJson: row.config_json,
  };
}

/**
 * UPSERT enabled=1 in hub.tenant_features.
 * Invalida la cache per il caller. Le migration delle tabelle modulo NON sono
 * applicate qui: questo modulo si occupa solo del flag (F1 collegherà schema).
 */
export function setFeatureEnabled(
  tenantCode: string,
  featureKey: string,
  userId: number | null
): void {
  const now = new Date().toISOString();
  getHubDb()
    .prepare(
      `INSERT INTO tenant_features (tenant_code, feature_key, enabled, enabled_at, enabled_by, config_json)
       VALUES (?, ?, 1, ?, ?, NULL)
       ON CONFLICT(tenant_code, feature_key)
       DO UPDATE SET enabled = 1, enabled_at = excluded.enabled_at, enabled_by = excluded.enabled_by`
    )
    .run(tenantCode, featureKey, now, userId);
  invalidateFeatureCache(tenantCode, featureKey);
}

/**
 * Setta enabled=0 (la riga resta per audit).
 * Il drop dei dati lo gestisce F1 (dropPatchModuleSchema) in modo separato.
 */
export function setFeatureDisabled(
  tenantCode: string,
  featureKey: string
): void {
  getHubDb()
    .prepare(
      `UPDATE tenant_features
          SET enabled = 0
        WHERE tenant_code = ? AND feature_key = ?`
    )
    .run(tenantCode, featureKey);
  invalidateFeatureCache(tenantCode, featureKey);
}
