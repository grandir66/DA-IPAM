/**
 * GET /api/patch/operations/[id]
 *
 * Dettaglio di una singola operation. Ritorna lo stato corrente più i
 * metadati associati. La UI usa questo endpoint dopo POST /api/patch/operations
 * (fire-and-forget) per il primo render della pagina log.
 */
import { NextResponse } from "next/server";
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { withTenantFromSession } from "@/lib/api-tenant";
import { isAuthError } from "@/lib/api-auth";
import { patchModuleGuard } from "@/lib/patch/route-guard";
import { mapOperationRow, type PatchOperationDbRow } from "@/lib/patch/types";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withTenantFromSession(async () => {
    const guard = await patchModuleGuard();
    if (isAuthError(guard)) return guard;

    const { id } = await params;
    const operationId = Number(id);
    if (!Number.isFinite(operationId) || operationId <= 0) {
      return NextResponse.json(
        { error: "operation id non valido" },
        { status: 400 }
      );
    }

    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) {
      return NextResponse.json(
        { error: "Tenant context non disponibile" },
        { status: 500 }
      );
    }
    const db = getTenantDb(tenantCode);

    try {
      const row = db
        .prepare(
          `SELECT id, host_id, user_id, cve_id, package_manager,
                  package_id, package_version_before, package_version_target,
                  package_version_after, action, status, exit_code,
                  started_at, finished_at, reboot_required,
                  log_file_path, log_offset, error_message
             FROM patch_operations
            WHERE id = ?`
        )
        .get(operationId) as PatchOperationDbRow | undefined;

      if (!row) {
        return NextResponse.json(
          { error: "Operation non trovata" },
          { status: 404 }
        );
      }

      return NextResponse.json(mapOperationRow(row), {
        headers: NO_CACHE_HEADERS,
      });
    } catch (error) {
      console.error("[patch/operations/:id GET] errore:", error);
      return NextResponse.json(
        { error: "Errore nel recupero dell'operation" },
        { status: 500 }
      );
    }
  });
}
