import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { isUninstallableFeature } from "@/lib/modules/uninstall-copy";
import { disinstallaModulo } from "@/lib/modules/installa";

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
  // Auth prima di tutto (regola del repo): prima rispondeva 404/400 anche a
  // chi non era autenticato.
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;

  const { key } = await params;
  if (!isUninstallableFeature(key)) {
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
    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) {
      return NextResponse.json(
        { error: "Tenant non risolto" },
        { status: 400 }
      );
    }

    try {
      // dropData=true cancella le tabelle del modulo dal DB tenant. La
      // conferma in UI dice quali (UNINSTALL_COPY in lib/modules/uninstall-copy,
      // MOD-19): le prove confrontano i due.
      const { dataDropped } = disinstallaModulo(key, tenantCode, dropData);

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
