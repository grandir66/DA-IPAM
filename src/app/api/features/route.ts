import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { getFeatureStatus } from "@/lib/patch/feature";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

interface FeatureCatalogEntry {
  key: string;
  title: string;
  description: string;
  status: "installed" | "not_installed";
  enabledAt: string | null;
  enabledBy: number | null;
}

/**
 * Catalogo statico dei moduli opzionali. In F0 c'è solo patch_management.
 * In futuro: questo array vive nel codice (no DB) per renderizzare la UI;
 * lo "stato" reale per tenant viene poi enricheato per tenant da hub.tenant_features.
 */
const FEATURE_CATALOG: ReadonlyArray<{
  key: string;
  title: string;
  description: string;
}> = [
  {
    key: "patch_management",
    title: "Patch Management CVE-driven",
    description:
      "Lancia upgrade Chocolatey via WinRM guidati dalle vulnerabilità rilevate. Solo Windows, modalità interattiva.",
  },
  {
    key: "inventory_agent",
    title: "Inventory Agent (GLPI push)",
    description:
      "Riceve inventario software push da GLPI Agent (Windows/Linux/macOS) via JSON. Nessun server GLPI né Wazuh.",
  },
] as const;

export async function GET() {
  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;

    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) {
      return NextResponse.json(
        { error: "Tenant non risolto" },
        { status: 400 }
      );
    }

    const items: FeatureCatalogEntry[] = await Promise.all(
      FEATURE_CATALOG.map(async (entry) => {
        const status = await getFeatureStatus(tenantCode, entry.key);
        return {
          key: entry.key,
          title: entry.title,
          description: entry.description,
          status: status.enabled ? "installed" : "not_installed",
          enabledAt: status.enabled ? status.enabledAt : null,
          enabledBy: status.enabled ? status.enabledBy : null,
        };
      })
    );

    return NextResponse.json({ features: items }, { headers: NO_CACHE_HEADERS });
  });
}
