import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import {
  setFeatureDisabled,
  invalidateFeatureCache,
} from "@/lib/patch/feature";
import {
  dropPatchModuleSchema,
  patchModuleTablesExist,
} from "@/lib/patch/schema";
import {
  dropInventoryAgentSchema,
  INVENTORY_AGENT_TABLES,
} from "@/lib/inventory-agent/schema";
import { uninstallInventoryAgentFeature } from "@/lib/inventory-agent/feature";
import { dropMcSchema } from "@/lib/integrations/meshcentral/schema";

const ALLOWED_FEATURES = new Set<string>(["patch_management", "inventory_agent", "meshcentral"]);

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

interface UninstallResponse {
  status: "uninstalled";
  feature: string;
  dataDropped: boolean;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  if (!ALLOWED_FEATURES.has(key)) {
    return NextResponse.json({ error: "Feature sconosciuta" }, { status: 404 });
  }

  // Body è opzionale: se assente o non JSON, defaultiamo dropData=false.
  let dropData = false;
  try {
    const text = await request.text();
    if (text && text.trim().length > 0) {
      const parsed = JSON.parse(text) as { dropData?: unknown };
      dropData = parsed?.dropData === true;
    }
  } catch {
    return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
  }

  return withTenantFromSession(async () => {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) {
      return NextResponse.json(
        { error: "Tenant non risolto" },
        { status: 400 }
      );
    }

    try {
      // F1: se dropData=true droppa le tabelle del modulo dal DB tenant.
      // Hardcoded patch_management (unica feature whitelistata). Quando
      // aggiungeremo altri moduli demultiplexeremo qui per feature key.
      let dataDropped = false;
      if (dropData) {
        const tenantDb = getTenantDb(tenantCode);
        if (key === "patch_management" && patchModuleTablesExist(tenantDb)) {
          const dropResult = dropPatchModuleSchema(tenantDb);
          dataDropped = dropResult.tablesDropped.length > 0;
        } else if (key === "inventory_agent") {
          dropInventoryAgentSchema(tenantDb);
          dataDropped = INVENTORY_AGENT_TABLES.length > 0;
        } else if (key === "meshcentral") {
          dropMcSchema(tenantDb);
          dataDropped = true;
        }
      }

      if (key === "inventory_agent") {
        uninstallInventoryAgentFeature(tenantCode);
      } else {
        setFeatureDisabled(tenantCode, key);
      }
      invalidateFeatureCache(tenantCode, key);

      const payload: UninstallResponse = {
        status: "uninstalled",
        feature: key,
        dataDropped,
      };
      return NextResponse.json(payload, { headers: NO_CACHE_HEADERS });
    } catch (error) {
      console.error(`[features/${key}/uninstall] errore:`, error);
      return NextResponse.json(
        { error: "Errore durante la disinstallazione del modulo" },
        { status: 500 }
      );
    }
  });
}
