import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { getFeatureStatus } from "@/lib/patch/feature";

const ALLOWED_FEATURES = new Set<string>(["patch_management"]);

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  if (!ALLOWED_FEATURES.has(key)) {
    return NextResponse.json({ error: "Feature sconosciuta" }, { status: 404 });
  }

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

    const status = await getFeatureStatus(tenantCode, key);
    return NextResponse.json(status, { headers: NO_CACHE_HEADERS });
  });
}
