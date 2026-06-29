import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { setFeatureEnabled, invalidateFeatureCache } from "@/lib/patch/feature";
import { applyPatchModuleMigrations } from "@/lib/patch/schema";
import { runFullSyncMatch } from "@/lib/patch/matcher";
import { applyInventoryAgentMigrations } from "@/lib/inventory-agent/schema";
import { installInventoryAgentFeature } from "@/lib/inventory-agent/feature";
import { installMeshFeature } from "@/lib/integrations/meshcentral/feature";
import { MC_TABLES } from "@/lib/integrations/meshcentral/schema";

/**
 * Feature key whitelistate. Le route /api/features/[key]/* accettano solo
 * questi valori: una key sconosciuta ritorna 404 senza toccare il DB.
 */
const ALLOWED_FEATURES = new Set<string>(["patch_management", "inventory_agent", "meshcentral"]);

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

interface InstallResponse {
  status: "installed";
  feature: string;
  tablesCreated: string[];
  initialMatching?: {
    softwareWithChoco: number;
    cveTargetsWritten: number;
    durationMs: number;
  };
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  if (!ALLOWED_FEATURES.has(key)) {
    return NextResponse.json({ error: "Feature sconosciuta" }, { status: 404 });
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

    const userId = adminCheck.user?.email
      ? null // placeholder, sotto sovrascriviamo da id stringa
      : null;
    // session.user.id è una stringa (vedi auth.ts: id: String(user.id))
    const rawId = (adminCheck.user as { id?: string }).id;
    const numericUserId = rawId ? Number(rawId) : null;
    const safeUserId = numericUserId !== null && Number.isFinite(numericUserId)
      ? numericUserId
      : userId;

    try {
      // F1: applica migration modulo (idempotente — IF NOT EXISTS).
      // Per ora solo patch_management è whitelistata: hardcoded sopra.
      // Quando aggiungeremo altri moduli demultiplexeremo qui per feature key.
      const tenantDb = getTenantDb(tenantCode);
      let tablesCreated: string[] = [];
      if (key === "patch_management") {
        const migration = applyPatchModuleMigrations(tenantDb);
        tablesCreated = migration.tablesCreated;
        setFeatureEnabled(tenantCode, key, safeUserId);
      } else if (key === "inventory_agent") {
        const migration = applyInventoryAgentMigrations(tenantDb);
        tablesCreated = migration.tablesCreated;
        installInventoryAgentFeature(tenantCode, safeUserId);
      } else if (key === "meshcentral") {
        // installMeshFeature applica mc_* schema + abilita il flag (usa il tenant context).
        installMeshFeature();
        tablesCreated = [...MC_TABLES];
      } else {
        setFeatureEnabled(tenantCode, key, safeUserId);
      }
      invalidateFeatureCache(tenantCode, key);

      // Auto-trigger matching iniziale per popolare patch_software_meta e patch_cve_target.
      // Non-blocking opzionale; qui awaited così la response include il summary.
      // Se fallisce, l'install rimane valida — l'utente potrà ri-eseguire dal bottone.
      let initialMatching: InstallResponse["initialMatching"];
      if (key === "patch_management") {
        try {
          initialMatching = runFullSyncMatch(tenantDb);
        } catch (matchErr) {
          console.error(
            `[features/${key}/install] initial matching failed (non-blocking):`,
            matchErr
          );
        }
      }

      const payload: InstallResponse = {
        status: "installed",
        feature: key,
        tablesCreated,
        initialMatching,
      };
      return NextResponse.json(payload, { headers: NO_CACHE_HEADERS });
    } catch (error) {
      console.error(`[features/${key}/install] errore:`, error);
      return NextResponse.json(
        { error: "Errore durante l'installazione del modulo" },
        { status: 500 }
      );
    }
  });
}
