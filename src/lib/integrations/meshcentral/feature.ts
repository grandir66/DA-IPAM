/**
 * Lifecycle feature MeshCentral (RMM). Pattern inventory-agent/feature.ts.
 * Tenant risolto dal contesto corrente (firma contract senza arg).
 *
 * Sorgente di verità del flag: hub tenant_features (feature_key='meshcentral').
 * install  → applyMcSchemaMigrations (idempotente) + setFeatureEnabled.
 * uninstall→ dropMcSchema + setFeatureDisabled (riga resta per audit).
 *
 * NB: mc_config NON viene toccata da uninstall — i secret restano per evitare
 * di perderli a un toggle UI; la rimozione avviene dalla settings page.
 *
 * Self-check del codec (loginTokenSelfCheck) è agganciato nella config POST route
 * (soft warning, C3), non qui: install applica solo schema + flag.
 */
import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";
import { getHubDb } from "@/lib/db-hub";
import {
  setFeatureEnabled,
  setFeatureDisabled,
  invalidateFeatureCache,
} from "@/lib/patch/feature";
import {
  applyMcSchemaMigrations,
  dropMcSchema,
} from "@/lib/integrations/meshcentral/schema";

export const MESH_FEATURE_KEY = "meshcentral";

function currentTenant(): string {
  const c = getCurrentTenantCode();
  if (!c) throw new Error("mesh-feature: no tenant context");
  return c;
}

/**
 * Legge direttamente la riga hub in modo sincrono (better-sqlite3 è sync).
 * getFeatureStatus da @/lib/patch/feature è dichiarata async; per onorare
 * il contract sincrono di getMeshState() usiamo una query diretta analoga.
 */
function readInstalledFromHub(tenantCode: string): boolean {
  const row = getHubDb()
    .prepare(
      "SELECT enabled FROM tenant_features WHERE tenant_code = ? AND feature_key = ?",
    )
    .get(tenantCode, MESH_FEATURE_KEY) as { enabled: number } | undefined;
  return row?.enabled === 1;
}

/** Stato installazione del modulo per il tenant corrente. */
export function getMeshState(): { installed: boolean } {
  return { installed: readInstalledFromHub(currentTenant()) };
}

/** Installa il modulo: crea le tabelle (idempotente) + flag enabled in hub. */
export function installMeshFeature(): void {
  const code = currentTenant();
  applyMcSchemaMigrations(getTenantDb(code));
  setFeatureEnabled(code, MESH_FEATURE_KEY, null);
  invalidateFeatureCache(code, MESH_FEATURE_KEY);
}

/** Disinstalla: droppa le tabelle modulo (FK reverse) + flag disabled in hub. */
export function uninstallMeshFeature(): void {
  const code = currentTenant();
  dropMcSchema(getTenantDb(code));
  setFeatureDisabled(code, MESH_FEATURE_KEY);
  invalidateFeatureCache(code, MESH_FEATURE_KEY);
}
