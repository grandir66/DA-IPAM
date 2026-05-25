import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { setFeatureEnabled, invalidateFeatureCache } from "@/lib/patch/feature";
// F1 — applyPatchModuleMigrations sarà importato qui:
// import { applyPatchModuleMigrations } from "@/lib/patch/schema";

/**
 * Feature key whitelistate. Le route /api/features/[key]/* accettano solo
 * questi valori: una key sconosciuta ritorna 404 senza toccare il DB.
 */
const ALLOWED_FEATURES = new Set<string>(["patch_management"]);

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

interface InstallResponse {
  status: "installed";
  feature: string;
  tablesCreated: string[];
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
      // F1 farà:
      //   const db = getTenantDb(tenantCode);
      //   applyPatchModuleMigrations(db);
      // In F0 non tocchiamo lo schema tenant.
      const tablesCreated: string[] = [];

      setFeatureEnabled(tenantCode, key, safeUserId);
      invalidateFeatureCache(tenantCode, key);

      const payload: InstallResponse = {
        status: "installed",
        feature: key,
        tablesCreated,
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
