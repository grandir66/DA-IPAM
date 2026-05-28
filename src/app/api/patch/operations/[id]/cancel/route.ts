/**
 * POST /api/patch/operations/[id]/cancel
 *
 * Cancella una operation in stato `queued`. Per design NON interrompe operations
 * già `running` (il comando WinRM è in flight e va lasciato terminare) né tocca
 * operations terminali. Idempotente: una seconda chiamata ritorna 409 con il
 * vecchio status.
 *
 * Auth: requireAdmin + patchModuleGuard. Audit NIS2: lo user_id originale resta
 * invariato; l'evento di cancel viene loggato in console (no tabella audit
 * dedicata in F4, vedi backlog).
 *
 * Body: nessuno.
 *
 * Risposta 200:
 *   { operationId, status: 'cancelled', cancelledAt: ISO8601 }
 *
 * Errori:
 *   - 404 operation non trovata
 *   - 409 status non cancellabile (running/success/failed/...)
 */
import { NextResponse } from "next/server";
import { withTenantFromSession } from "@/lib/api-tenant";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { patchModuleGuard } from "@/lib/patch/route-guard";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withTenantFromSession(async () => {
    const guard = await patchModuleGuard();
    if (isAuthError(guard)) return guard;

    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

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
        .prepare("SELECT id, status FROM patch_operations WHERE id = ?")
        .get(operationId) as { id: number; status: string } | undefined;

      if (!row) {
        return NextResponse.json(
          { error: "Operation non trovata" },
          { status: 404 }
        );
      }

      if (row.status !== "queued") {
        return NextResponse.json(
          {
            error: "Operation non cancellabile",
            details: `status corrente: ${row.status} (cancellabili solo le 'queued')`,
            currentStatus: row.status,
          },
          { status: 409 }
        );
      }

      const nowIso = new Date().toISOString();
      const result = db
        .prepare(
          `UPDATE patch_operations
              SET status = 'cancelled',
                  finished_at = ?,
                  error_message = COALESCE(error_message, 'Cancellata da operatore')
            WHERE id = ? AND status = 'queued'`
        )
        .run(nowIso, operationId);

      if (result.changes === 0) {
        // Race: qualcun altro l'ha presa tra SELECT e UPDATE
        const refreshed = db
          .prepare("SELECT status FROM patch_operations WHERE id = ?")
          .get(operationId) as { status: string } | undefined;
        return NextResponse.json(
          {
            error: "Operation cambiata di stato durante il cancel",
            currentStatus: refreshed?.status ?? "unknown",
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        {
          operationId,
          status: "cancelled" as const,
          cancelledAt: nowIso,
        },
        { headers: NO_CACHE_HEADERS }
      );
    } catch (error) {
      console.error("[patch/operations/:id/cancel POST] errore:", error);
      return NextResponse.json(
        { error: "Errore durante la cancellazione" },
        { status: 500 }
      );
    }
  });
}
