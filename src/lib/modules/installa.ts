/**
 * Installa e disinstalla i moduli per cliente (patch_management, inventory_agent, meshcentral). Prima la logica stava
 * dentro le rotte /api/features/[key]/install e /uninstall; ora la chiamano loro e la pagina Opzioni (22/10), così le due
 * strade fanno la stessa cosa. Da chiamare nel contesto del tenant (`installMeshFeature` lo legge da lì).
 */
import { getTenantDb } from "@/lib/db-tenant";
import { invalidateFeatureCache, setFeatureDisabled, setFeatureEnabled } from "@/lib/patch/feature";
import { applyPatchModuleMigrations } from "@/lib/patch/schema";
import { runFullSyncMatch } from "@/lib/patch/matcher";
import { applyInventoryAgentMigrations } from "@/lib/inventory-agent/schema";
import { installInventoryAgentFeature, uninstallInventoryAgentFeature } from "@/lib/inventory-agent/feature";
import { installMeshFeature } from "@/lib/integrations/meshcentral/feature";
import { MC_TABLES } from "@/lib/integrations/meshcentral/schema";
import { dropFeatureData } from "./uninstall-data";
import type { UninstallableFeature } from "./uninstall-copy";

export interface EsitoInstallazione {
  tablesCreated: string[];
  initialMatching?: { softwareWithChoco: number; cveTargetsWritten: number; durationMs: number };
}

export function installaModulo(key: UninstallableFeature, tenantCode: string, userId: number | null): EsitoInstallazione {
  const tenantDb = getTenantDb(tenantCode);
  let tablesCreated: string[] = [];
  if (key === "patch_management") {
    tablesCreated = applyPatchModuleMigrations(tenantDb).tablesCreated;
    setFeatureEnabled(tenantCode, key, userId);
  } else if (key === "inventory_agent") {
    tablesCreated = applyInventoryAgentMigrations(tenantDb).tablesCreated;
    installInventoryAgentFeature(tenantCode, userId);
  } else {
    // installMeshFeature applica lo schema mc_* e accende il flag (usa il contesto tenant).
    installMeshFeature();
    tablesCreated = [...MC_TABLES];
  }
  invalidateFeatureCache(tenantCode, key);

  // Il primo abbinamento del software popola patch_software_meta e patch_cve_target. Se fallisce l'installazione resta
  // valida: si rifà dal pulsante del modulo.
  let initialMatching: EsitoInstallazione["initialMatching"];
  if (key === "patch_management") {
    try {
      initialMatching = runFullSyncMatch(tenantDb);
    } catch (matchErr) {
      console.error(`[features/${key}/install] initial matching failed (non-blocking):`, matchErr);
    }
  }
  return { tablesCreated, initialMatching };
}

export function disinstallaModulo(key: UninstallableFeature, tenantCode: string, dropData: boolean): { dataDropped: boolean } {
  const dataDropped = dropData ? dropFeatureData(getTenantDb(tenantCode), key) : false;
  if (key === "inventory_agent") uninstallInventoryAgentFeature(tenantCode);
  else setFeatureDisabled(tenantCode, key);
  invalidateFeatureCache(tenantCode, key);
  return { dataDropped };
}
